# U12-2：usePagination 分页与加载更多

日期：2026-10-22。本切片在请求自动化之外增加列表分页 Hook：`usePagination` 负责页码、pageSize、追加、`hasMore`、重载与取消，保留 generation 竞态保护。不是 ahooks/Umi `useRequest` 分页插件的等价实现。

## 1. 使用方式

```tsx
const { data, page, hasMore, loading, loadMore, reload, cancel } = usePagination<Item>(
  (client, { page, pageSize, signal }) =>
    client.get('/api/items', { signal, params: { page, pageSize } }),
  { pageSize: 20 },
);

return <>
  <ul>{data.map(item => <li key={item.id}>{item.name}</li>)}</ul>
  {hasMore && <button onClick={() => void loadMore()}>More</button>}
</>;
```

服务返回 `{ list, total?, hasMore? }`；`total` 与 `hasMore` 至少一个用于判断是否还有下一页，都没有时以 `list.length === pageSize` 推断。

## 2. 契约与语义

- **状态**：`data`（累积列表，已冻结数组）、`page`（最后成功页，初始 0）、`pageSize`、`loading`、`error`、`hasMore`（初始 true）。
- **首次加载**：默认挂载后请求第 1 页；`manual: true` 时由 `loadMore()` 或 `reload()` 触发。`loadMore` 在未加载时请求第 1 页，之后每次追加下一页。
- **追加**：默认 `[...previous, ...next]`；可用 `merge(previous, next)` 自定义去重/分组。`reload()` 从第 1 页替换列表。
- **hasMore**：优先使用响应 `hasMore`；否则有 `total` 时按 `page * pageSize < total`；否则按本页条数是否达到 pageSize。
- **并发**：同一时刻只允许一个分页请求；加载中再次 `loadMore`/`reload` 为 no-op。`cancel()` 中止在途请求、清除 loading，不写 error；卸载同样中止。
- **错误**：保留已加载列表与页码，只写 error；不自动重试。`onSuccess(data, page)` 在成功提交后调用，`onError` 在最终失败时调用。
- **校验**：`pageSize` 必须为 1–1000 的整数；`manual` 必须 boolean；`merge` 必须函数；服务返回缺少 `list`、非法 `total`/`hasMore` 以 `REQUEST_INVALID` 失败并写入 error。
- **baseURL/headers**：复用 `RequestClient`，与 `useRequest` 一致。

## 3. 边界

- 没有游标分页、双向加载、虚拟列表、缓存/去重、重试/轮询、依赖刷新或 SSR 数据注水。
- `page` 是成功页码而非“正在加载的页码”；请求失败时页码不变。
- 列表追加不做 key 去重；使用 `merge` 自行处理。
- 不支持多个并发分页请求；搜索条件变化应通过 `reload` 配合外部条件重建服务闭包。
- `usePagination` 与 `useRequest` 的 retry/polling 选项不共享。

## 4. 与 Umi/ahooks 的差异

| 方面 | Umi useRequest 分页 | cormi U12-2 |
| --- | --- | --- |
| API | `pagination` 选项 | 独立 usePagination |
| 追加 | 支持 | 支持，可 merge |
| 游标 | 插件生态 | 未提供 |
| 缓存/去重 | 插件生态 | 未提供 |
| SSR | 插件差异 | 未提供 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | 首屏 2 条、连续加载至 5 条、hasMore 变 false、reload 回到第 1 页；原有请求自动化/取消/竞态用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u12-2-pagination-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u12-2-pagination-validation.json)。

## 6. 下一步

- U12 剩余：缓存/去重、防抖节流、游标分页；
- U16 UI locale 映射、U17 Antd/ProLayout、F6 微前端与状态库适配。
