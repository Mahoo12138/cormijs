# 生态集成

cormi 不内置 UI 组件库、图表库或第三方状态库。下面的包都是**可选集成**，按需安装和挂载；没有它们，默认 preset 仍可运行。

## Ant Design

```ts
import { antdPlugin } from '@cormijs/plugin-antd'
import { localePlugin } from '@cormijs/plugin-react'

plugins: [
  { id: 'locale', plugin: localePlugin, options: { id: 'app:locale' } },
  {
    id: 'antd',
    plugin: antdPlugin,
    options: {
      id: 'app:antd',
      theme: {
        token: { colorPrimary: '#0d9488' },
        dark: false,
      },
    },
  },
]
```

- 安装 `antd` 后，插件通过 runtime 贡献包裹 `ConfigProvider`。
- locale 由 cormi 的 UI locale 回退链选择包内官方 locale（含 `en` / `zh` 语言别名）。
- `direction` 来自 `localeDirection`，支持 RTL。
- 主题 token 与 `dark` 算法由插件校验后以 JSON 传入。
- `localePlugin` 必须先挂载，Antd Provider 才能读取当前语言。

### ProLayout

需要完整外壳时安装 `@ant-design/pro-layout`，挂载 `proLayoutPlugin`，并在 `src/layouts/index.tsx` 使用 `ProLayoutShell`。菜单、折叠持久化和 SPA 导航来自 `menuPlugin`。具体配置见[布局](/guide/layout#prolayout-外壳)。

```ts
import { antdPlugin, proLayoutPlugin } from '@cormijs/plugin-antd'
import { menuPlugin } from '@cormijs/plugin-react'

plugins: [
  { id: 'antd', plugin: antdPlugin, options: { id: 'app:antd' } },
  { id: 'menu', plugin: menuPlugin, options: { id: 'app:menu' } },
  { id: 'pro-layout', plugin: proLayoutPlugin },
]
```

ProLayout 7.22.7 仍声明 antd 4/5 peer；使用 antd 6 时严格 peer 安装需要对该可选集成关闭校验。

### 图标

菜单图标不绑定图标库：

```ts
meta: { title: '管理', icon: 'dashboard' }
```

```tsx
<ProLayoutShell icons={{ dashboard: <DashboardOutlined /> }}>
```

图标 key 由应用注册表解析；缺失时回退到路由 id。

## React Query

```ts
import { reactQueryPlugin } from '@cormijs/plugin-react-query'

plugins: [{
  id: 'react-query',
  plugin: reactQueryPlugin,
  options: {
    id: 'app:react-query',
    defaults: {
      staleTime: 30_000,
      gcTime: 300_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
}]
```

插件只提供 `QueryClientProvider` 与受校验的默认项。应用直接使用 `@tanstack/react-query`：

```tsx
import { useQuery } from '@tanstack/react-query'

function Users() {
  const query = useQuery({
    queryKey: ['users'],
    queryFn: () => fetch('/api/users').then(response => response.json()),
  })

  if (query.isPending) return <p>加载中…</p>
  return <ul>{query.data.map((user: { id: string }) => <li key={user.id}>{user.id}</li>)}</ul>
}
```

`defaults` 支持 `staleTime`、`gcTime`（0–86,400,000ms）、`retry`（0–10 或 false）、`refetchOnWindowFocus`。

不要同时用 `useRequest` 和 React Query 管理同一份服务端数据。

## Valtio

`@cormijs/valtio` 是 valtio 的显式再导出，不需要 Provider 或 Cordis 插件：

```tsx
import { proxy, useSnapshot } from '@cormijs/valtio'

const store = proxy({ count: 0 })

function Counter() {
  const snapshot = useSnapshot(store)
  return (
    <button onClick={() => { store.count++ }}>
      {snapshot.count}
    </button>
  )
}
```

导出包括 `proxy`、`ref`、`snapshot`、`subscribe`、`useSnapshot`，以及 valtio/utils 的 `proxyWithDevtools`、`proxyMap`、`proxySet`、`subscribeKey`、`useProxy`、`watch`。

这是纯再导出：没有持久化、SSR 注水、devtools UI 或跨 tab 同步。不要与 cormi 的 `modelPlugin` 管理同一份状态。

## Dva

### 显式 runtime

```ts
// src/models/counter.ts
export default {
  namespace: 'counter',
  state: { count: 0 },
  reducers: {
    increment(state: { count: number }) {
      return { ...state, count: state.count + 1 }
    },
  },
}
```

```tsx
// src/dva.tsx
import { createDvaRuntime } from '@cormijs/dva'
import counter from './models/counter'

export default createDvaRuntime([counter])
```

```ts
app: {
  runtime: [{
    id: 'dva',
    module: { specifier: './src/dva.tsx', exportName: 'default' },
  }],
}
```

```tsx
import { useDispatch, useSelector } from '@cormijs/dva'

const count = useSelector((state: any) => state.counter.count)
const dispatch = useDispatch()
```

### 自动发现

```ts
import { dvaPlugin } from '@cormijs/plugin-dva'

plugins: [{
  id: 'dva',
  plugin: dvaPlugin,
  options: { immer: true, loading: true },
}]
```

- 发现 `src/models/**/*.{ts,tsx}`，每个文件默认导出 model。
- `immer: true` 允许 reducer 直接修改 draft。
- `loading: true`（默认）注册 `loading` namespace，提供 `{ global, models, effects }`。
- 排除 `*.test.*`、`*.spec.*`、`*.d.ts`；空目录也允许。
- 自动发现固定 `src/models` 和 Vite；不支持自定义目录或 `extraModels`。

dva 与 cormi 的 `modelPlugin` 是两套状态系统，不要用同一 namespace 管理同一份状态。

## 图表

cormi 不提供图表插件，按 Umi 的生态方式由应用安装图表库：

```tsx
import { lazy, Suspense } from 'react'
import { ClientOnly } from '@cormijs/runtime'

const Chart = lazy(() => import('./Chart'))

export default function Dashboard() {
  return (
    <ClientOnly fallback={<div className="chart-placeholder" />}>
      <Suspense fallback={<p>图表加载中…</p>}>
        <Chart />
      </Suspense>
    </ClientOnly>
  )
}
```

- SSR 页面必须用 `<ClientOnly>` 隔离浏览器专用图表。
- lazy + Suspense 让图表不阻塞首屏。
- `@ant-design/plots` 已在 dev/build/preview 和安装包中验证，但版本由应用管理。

## Pageview 分析

```ts
import { analyticsPlugin } from '@cormijs/plugin-react'

plugins: [{
  id: 'analytics',
  plugin: analyticsPlugin,
  options: {
    id: 'app:analytics',
    measurementId: 'G-XXXXXXX',
    dispatch: true,
  },
}]
```

- 配置 `measurementId` 后维护 GA4 `dataLayer` / `gtag` 队列并发送 `page_view`。
- `page_path` 包含部署 base。
- `dispatch: true` 额外发出 `cormi:pageview`，detail 为 `{ path, search, hash, title, referrer }`，其中 `path` 不含 base。
- GA 脚本仍由应用通过 `htmlPlugin.headScripts` 引入。
- 首屏事件在 React 挂载前发出；宿主如需在 UI 中展示，请在模块作用域监听。
- 不处理 Cookie 同意。

```ts
window.addEventListener('cormi:pageview', event => {
  console.log((event as CustomEvent).detail)
})
```

## 选择建议

| 需求 | 建议 |
| --- | --- |
| 企业后台外壳 | Antd + ProLayout |
| 服务端数据缓存/mutation | React Query |
| 轻量客户端状态 | Valtio |
| Umi/dva 既有模型 | Dva |
| 图表 | 应用自选图表库 + ClientOnly |
| 跨页面共享 cormi 原生状态 | `modelPlugin` |

## 限制

- 所有 UI 集成包都只提供适配层，不包含组件库本身。
- ProLayout 与 antd 6 存在 peer 范围差异。
- Valtio 不提供持久化/SSR；Dva 不提供 SSR store 注水。
- 图表 SSR 仍需要 `<ClientOnly>` 和 lazy 拆分。
- 分析插件不负责 Cookie 同意或服务端事件。

下一步：[配置参考](/reference/config)。
