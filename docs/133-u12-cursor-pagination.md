# U12-7：useCursorPagination 游标分页

日期：2026-10-22。本切片增加游标分页 Hook：服务返回列表与 `nextCursor`，`loadMore` 使用上一页游标追加；`reload` 从无游标重新开始。与 `usePagination` 的页码模式并存。

## 契约

- `useCursorPagination<T>(service, options)`；service 收到 `{ cursor?, signal }`，返回 `{ list, nextCursor?: string|null, hasMore?: boolean }`。
- 初始加载不带 cursor；`loadMore` 使用当前 `nextCursor`，成功后追加（可传 `merge`）；`hasMore` 优先响应值，否则以 `nextCursor` 是否存在推断。
- `reload` 清空游标并替换列表；`cancel` 中止并清 loading，不写 error；卸载中止。
- 同一时刻只允许一个请求；加载中再次 `loadMore`/`reload` 为 no-op。
- 错误保留已有列表与游标；不自动重试。
- 校验：`list` 必须为数组，`nextCursor` 为 string/null，`hasMore` 为 boolean，否则 `REQUEST_INVALID` 写入 error。

## 边界

- 不提供双向游标、游标编码/解码、缓存、并发预取或 SSR 注水。
- 不自动去重；需要时用 `merge`。
- 游标由服务端定义，cormi 只原样回传，不做 URL 编码（由 RequestClient 的 params 处理）。
- `manual` 请求不自动加载；首次 `loadMore` 等价于第一页。

## 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | 2→4→5 条追加、hasMore false、重复 loadMore no-op、reload 回第一页；既有页码/缓存/节流用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u12-7-cursor-pagination-validation.json |
