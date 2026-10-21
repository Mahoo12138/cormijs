# U32-2：流式 SSR

日期：2026-10-22。本切片在 U32-1 的 serverLoader 基础上增加流式渲染：`streaming: true` 时 dev、preview 与 `cormi serve` 使用 React `renderToReadableStream`，先发送已知 head 与同步外壳，Suspense 边界继续流入；React Router 的 hydration script 从流末尾移出挂载根。预渲染仍使用缓冲渲染。

## 1. 使用方式

```ts
plugins: [
  { id: 'ssr', plugin: ssrPlugin, options: { id: 'application:ssr', streaming: true } },
  { id: 'serve', plugin: servePlugin, options: { id: 'application:serve', streaming: true, base: '/app/' } },
],
app: { ssr: true, base: '/app/' },
```

页面用常规 `<Suspense fallback={...}>` 包住需要等待的数据；同步外壳（布局标题、导航、fallback）在数据完成前发送。

## 2. 契约与语义

- **运行时**：`@cormijs/runtime/server` 新增 `renderServerApplicationStream`，返回 `{ stream, status, headers, head, hydration }`。流是 Web `ReadableStream<Uint8Array>`，`hydrate` 为 hydration script 的 Promise。
- **时序**：`renderToReadableStream` 在 shell 就绪后 resolve，此时路由 `meta.head` 与已渲染部分的 `<Helmet>` 已知；后续 Suspense 内容继续写入 `stream`。
- **hydration 位置**：React Router 把 `window.__staticRouterHydrationData` 脚本写在流末尾。运行时用 TransformStream 暂存该脚本，不把它当作页面标记；`sendShellStream` 在关闭挂载根后写入 hydration，再补 shell 尾部。
- **中间件**：`ssrPlugin` 的 dev/preview 与 `servePlugin` 都新增 `streaming` 选项；开启后直接写 HTTP 响应，不再 `sendResult` 缓冲。HEAD 只设置状态/头并取消流。
- **错误**：shell 就绪前抛错时中间件回退 CSR 外壳；写头之后的流错误记录日志并结束连接，不尝试二次发送。`onError` 只记录，不改变状态码。
- **head 限制**：shell 就绪后才出现的 `<Helmet>`（位于 Suspense 内容内）不会进入初始 `<head>`；客户端挂载后会按常规 head 同步接管。
- **预渲染**：`prerender` 继续使用 `renderServerApplication` 的缓冲结果，流式选项不影响构建产物。
- **选项**：`streaming` 必须为 boolean，否则 `SSR_INVALID` / `SERVE_INVALID`。

## 3. 边界

- 没有压缩、TLS、HTTP/2 推送或缓存策略；`sendShellStream` 忽略 Node 写背压（`response.write` 的返回值），大页面下可能占用内存。
- 只在同步内容位于 Suspense 边界之外时才能提前发送；若整个根都处于同一个 Suspense 边界，React 会等待其完成。
- serverLoader 仍在 static handler 中先执行完毕，流式收益来自 Suspense 组件与后续渲染，不是 loader 级流式数据。
- 流中错误只记录；不像 Next.js 那样注入客户端错误重试脚本。
- 未验证多实例部署、代理缓冲（如 nginx 默认 buffering）或 CDN 行为。

## 4. 与 Umi 4 的差异

| 方面 | Umi 4 | cormi U32-2 |
| --- | --- | --- |
| 流式入口 | Umi server streaming | `streaming: true`，dev/preview/serve 一致 |
| hydration script | 模板注入 | 从 React 流末尾剥离并放到根外 |
| head | 渲染时收集 | shell 就绪时收集，Suspense 内 Helmet 不进初始 head |
| 错误恢复 | 生态方案 | 只记录，CSR 回退仅限写头前 |
| 预渲染 | exportStatic | 缓冲渲染，不受流式影响 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts` | 流在 Suspense 完成前产出 shell/fallback，hydration 不在标记内，loader 数据进入脚本 |
| `tests/browser/ssr.test.ts` | dev/preview/serve 流式 HTML、hydration、head、serverLoader 与预渲染并存 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u32-streaming-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u32-streaming-validation.json)。

## 6. 下一步

- U32 生产化：压缩/TLS、背压、代理缓冲与流中错误恢复；
- U17 官方 Antd/ProLayout 集成、U16 dayjs/Antd locale 映射、F6 多 builder/微前端。
