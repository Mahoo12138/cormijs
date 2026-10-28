# 请求

cormi 的请求层由一个可配置的 `RequestClient` 和 `useRequest` 系列 Hook 组成。它不依赖 axios，也不接管服务端缓存；需要完整的查询缓存和失效策略时，可以挂载可选的 React Query 集成。

## 启用

同时启用 app 运行时与 `requestPlugin`：

```ts
import { appRuntimePlugin, requestPlugin } from '@cormijs/plugin-react'

plugins: [
  { id: 'app-runtime', plugin: appRuntimePlugin },
  { id: 'request', plugin: requestPlugin, options: { id: 'application:request' } },
]
```

```tsx
// src/app.tsx
export default defineApp({
  request: {
    baseURL: '/api',
    headers: { 'x-application': 'cormi' },
    timeout: 5000,
    cacheLimit: 100,
  },
})
```

| 配置 | 说明 |
| --- | --- |
| `baseURL` | 请求前缀，与路径拼接 |
| `headers` | 默认请求头，可被单次请求覆盖 |
| `timeout` | 毫秒超时；通过 `AbortSignal.timeout` 实现 |
| `cacheLimit` | GET 缓存最多保留多少条，默认 100 |
| `cachePersist` | `session` / `local`，跨刷新持久化 GET 缓存 |
| `cachePersistKey` | 存储 key，默认 `cormi:request-cache` |

## 直接使用客户端

```tsx
import { useRequestClient } from '@cormijs/runtime'

function Health() {
  const client = useRequestClient()
  return <button onClick={() => void client.get('/health')}>检查</button>
}
```

`RequestClient` 提供 `request`、`get`、`post`、`put`、`delete`、`invalidateCache`、`activate`、`dispose`。

响应处理：

- `content-type` 包含 `json` 时解析 JSON，否则返回文本。
- `204` 返回空字符串。
- 非 2xx 抛出 `RequestError`，包含 `status` 与已解析的 `data`。
- 对象 body 自动 JSON 序列化并设置 `content-type: application/json`。

## useRequest

```tsx
import { useRequest } from '@cormijs/runtime'

function Hello() {
  const { data, loading, error, run, refresh, cancel } = useRequest(
    (client, signal) => client.get<{ message: string }>('/hello', {
      signal,
      params: { q: 'one' },
    }),
  )

  if (loading) return <p>加载中…</p>
  if (error) return <button onClick={() => void refresh()}>重试</button>
  return <p>{data?.message}</p>
}
```

首次挂载自动执行；`manual: true` 时只由 `run()` / `refresh()` 触发。

```ts
interface UseRequestResult<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  run(): Promise<T | undefined>
  refresh(): Promise<T | undefined>
  cancel(): void
}
```

### 竞态与取消

重复执行会中止旧请求，并通过 generation 保证最后一次结果生效。`cancel()` 中止在途请求、清除 loading，不写入 error。卸载时同样清理。

### 重试与轮询

```ts
useRequest(service, {
  retry: 3,
  retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000),
  pollingInterval: 5000,
  pollingWhenHidden: false,
})
```

| 选项 | 说明 |
| --- | --- |
| `retry` | 首次失败后的额外尝试次数，0–10 |
| `retryDelay` | 毫秒或 `(attempt, error) => ms`；attempt 从 1 开始 |
| `pollingInterval` | 成功后每隔多少毫秒重新执行 |
| `pollingWhenHidden` | 页面隐藏时是否继续轮询，默认 false |

manual 请求不会自动轮询；轮询绕过防抖/节流。取消和卸载会清理重试与轮询计时器。

### 依赖刷新

```ts
useRequest(service, { refreshDeps: [userId, filters] })
```

`refreshDeps` 必须是可 JSON 序列化的值。变化时重新执行；manual 请求忽略该选项。

### 防抖与节流

```ts
useRequest(service, {
  debounceWait: 300,
  debounceMaxWait: 1000,
  debounceLeading: false,
  debounceTrailing: true,
})
```

```ts
useRequest(service, {
  throttleWait: 500,
  throttleLeading: true,
  throttleTrailing: false,
})
```

- `debounceWait` 合并窗口内的 `run` / `refresh`。
- `debounceMaxWait` 限制最长延迟，必须配合 `debounceWait`。
- `throttleWait` 与 `debounceWait` 互斥。
- `throttleLeading` 默认 true；`throttleTrailing` 默认 false，开启后窗口内被丢弃的调用会合并为一次尾调用。
- 轮询绕过防抖和节流。

## 分页

```tsx
import { usePagination } from '@cormijs/runtime'

interface Item { id: string; name: string }

function List() {
  const { data, page, hasMore, loading, error, loadMore, reload, cancel } =
    usePagination<Item>(
      (client, { page, pageSize, signal }) =>
        client.get('/items', { signal, params: { page, pageSize } }),
      { pageSize: 20 },
    )

  return (
    <>
      <ul>{data.map(item => <li key={item.id}>{item.name}</li>)}</ul>
      {hasMore && <button disabled={loading} onClick={() => void loadMore()}>加载更多</button>}
    </>
  )
}
```

服务返回：

```ts
{ list: Item[], total?: number, hasMore?: boolean }
```

- 默认挂载后请求第 1 页；`manual: true` 时由 `loadMore()` / `reload()` 触发。
- `loadMore()` 在首次调用时请求第 1 页，之后追加下一页；`reload()` 回到第 1 页替换列表。
- `hasMore` 优先使用响应值；否则按 `total` 或本页条数推断。
- 同一时刻只允许一个分页请求；加载中再次调用为 no-op。
- 失败保留已加载列表和页码，只写 error，不自动重试。
- `merge(previous, next)` 可自定义追加策略。

游标分页使用 `useCursorPagination`：

```tsx
const { data, nextCursor, hasMore, loadMore, reload } = useCursorPagination<Item>(
  (client, { cursor, signal }) => client.get('/items', { signal, params: { cursor } }),
)
```

服务返回 `{ list, nextCursor?, hasMore? }`；`nextCursor` 为空时停止。

## 缓存

GET 请求可以选择短期缓存：

```ts
client.get('/config', { cacheTime: 30_000 })
client.get('/config', { cacheTime: 30_000, cacheTags: ['config'] })
client.invalidateCache(['config'])
```

- `cacheTime` 为 0–3,600,000ms；0 表示不缓存。
- 相同 URL、headers 和参数的并发 GET 共享一个在途请求。
- `cacheBust: true` 跳过读取且不写入缓存。
- `cacheTags` 最多 16 个；`invalidateCache(tags?)` 按标签或全部失效。
- 缓存默认只在当前客户端实例内。

跨刷新持久化：

```tsx
export default defineApp({
  request: {
    cachePersist: 'local',
    cachePersistKey: 'app:request-cache',
  },
})
```

- 仅缓存可 JSON 序列化的 GET 响应。
- `local` 模式下，`invalidateCache` 会通过 `storage` 事件通知其他标签页清空缓存。
- 不要缓存包含敏感数据的响应；持久化不是加密存储。

## React Query

需要 mutation、查询键管理、失效与 devtools 时，使用可选的 `@cormijs/plugin-react-query`：

```ts
import { reactQueryPlugin } from '@cormijs/plugin-react-query'

plugins: [{
  id: 'react-query',
  plugin: reactQueryPlugin,
  options: {
    id: 'app:react-query',
    defaults: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
}]
```

插件只提供 `QueryClientProvider` 和受校验的默认项；应用直接使用 `@tanstack/react-query`。这时不要把同一份服务端数据再塞进 model。

## 限制

- `RequestClient` 没有拦截器、重试队列或请求优先级。
- `useRequest` 的缓存与 React Query 是两套独立机制，不要同时用于同一份数据。
- `usePagination` 不支持双向加载、虚拟列表或 SSR 注水。
- 服务端 loader 的缓存与失效不在请求层处理，见 [SSR](/guide/build#ssr)。

下一步：[国际化](/guide/i18n)。
