# U33-1：SSR 预渲染与 sitemap

日期：2026-10-22。本切片把静态导出从“每路由 HTML 外壳”推进到真正的预渲染：构建完成后用已生成的 SSR bundle 渲染每个字面路由，写入带首屏标记与 hydration 数据的 HTML；可选生成 sitemap.xml。动态路由、重定向与增量更新不在本切片。

## 1. 使用方式

```ts
plugins: [
  { id: 'ssr', plugin: ssrPlugin, options: {
    id: 'application:ssr',
    prerender: true,
    prerenderPaths: async () => [{ path: '/users/1' }, { path: '/users/2', prerender: false }],
    prerenderIgnoreErrors: false,
    prerenderIncremental: true,
    sitemap: 'https://example.com',
  } },
],
app: { ssr: true, base: '/app/' },
```

```sh
cormi build
```

产物：

- `dist/index.html`：`/` 的预渲染页面；
- `dist/<path>/index.html`：每个字面路径路由（含 `:id`、`*` 的路由跳过），以及 `prerenderPaths` 显式列出的动态路径；
- `dist/sitemap.xml`：已写出页面的绝对 URL，包含 `app.base`；
- `dist/.cormi/shell.html`：构建时的空挂载点外壳，供 `cormi preview` / `cormi serve` 继续 SSR 使用；
- `dist/.cormi/ssr/ssr.mjs`：预渲染与运行时 SSR 共用的服务端 bundle。

## 2. 契约与语义

- **触发**：`ssrPlugin` 的 `prerender: true`；`sitemap` 是可选绝对 http(s) 站点地址，`prerenderPaths` 是可选内部应用路径数组/异步函数（对象条目可 `prerender:false` 跳过），`prerenderIgnoreErrors` 允许单页异常跳过，`prerenderIncremental` 跳过未变化 HTML 的写入。均需与 `prerender` 同时出现，否则 `SSR_INVALID`。
- **路由集合**：复用 `staticPages`：只处理有页面模块、无 redirect、路径不含 `:param` 或 `*` 的路由；再合并 `prerenderPaths`（去重、排序，非法路径或 `..` 被拒绝）。
- **渲染**：构建完成后导入 `dist/.cormi/ssr/ssr.mjs`，对每个路径构造包含 `app.base` 的 GET 请求，执行与运行时相同的 `renderServerApplication`。clientLoader 与 serverLoader 都会执行，数据进入 hydration；`meta.head` 与 `<Helmet>` 通过 `injectShell` 写入页面。
- **重定向与错误**：loader 返回 `Response` 或 SSR 结果状态 `>= 400` 的页面不会写成 HTML；`prerenderIgnoreErrors: true` 时单页渲染异常也记录并跳过，默认抛错使构建失败。跳过项不进入 sitemap。
- **sitemap**：只包含成功写出的路径，URL 由 `sitemap` + `app.base` + 路由路径拼接；XML 特殊字符转义。未提供 `sitemap` 时不写文件。
- **空壳隔离**：预渲染会填满 `dist/index.html`，因此构建同时保存 `dist/.cormi/shell.html`；`cormi preview` 与 `cormi serve` 优先读取该空壳再注入 SSR 标记，避免把已预渲染内容再次作为模板。
- **失败**：SSR bundle 缺失或页面渲染抛错时构建以 `SSR_PRERENDER_FAILED` 失败，不留下“部分页面成功但构建绿”的结果；`CormiError` 原样上抛。
- **base**：预渲染请求与 sitemap URL 都带 `app.base`；写入磁盘的目录不重复 base，由静态服务器按部署前缀映射。

## 3. 边界

- 动态参数路径必须由 `prerenderPaths` 显式枚举（对应 Umi `exportStatic.extraRoutePaths`）；对象条目可关闭单页。不会从数据源自动发现路径。
- 没有增量预渲染、页面级开关、并发控制或渲染结果缓存；每个字面路由顺序渲染一次。
- 与 `staticExportPlugin` 同时启用时，后执行的壳写入可能覆盖预渲染结果；需要预渲染时不要同时启用静态外壳导出（或确保 staticExport 先执行）。本切片不自动协调插件顺序。
- sitemap 不包含 `lastmod`、优先级、多语言 alternates、robots.txt 或 sitemap index。
- 不提供流式 SSR；预渲染是完整缓冲后写文件。

## 4. 与 Umi 4 的差异

| 方面 | Umi 4 | cormi U33-1 |
| --- | --- | --- |
| 预渲染 | exportStatic 可生成 HTML | `ssrPlugin.prerender` 用同一 SSR bundle 渲染 |
| sitemap | 插件生态 | 内置可选 `sitemap`，仅列出成功页面 |
| serverLoader | SSR 时执行 | 预渲染时同样执行并写入 hydration |
| 动态路由 | `extraRoutePaths` 枚举 | `prerenderPaths` 枚举 |
| 增量 | 部分生态方案 | 未提供 |

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts` | 预渲染写文件、shell/head 注入、重定向跳过、sitemap 排序与转义、插件选项校验 |
| `tests/browser/ssr.test.ts` | dist 首屏标记、serverLoader 预渲染数据、hydration script、sitemap URL 与 base；preview/serve 仍使用空壳 SSR |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u33-prerender-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u33-prerender-validation.json)。

## 6. 下一步

- U32 流式 SSR；U33 动态路由枚举/增量预渲染与 robots；
- U17 官方 Antd/ProLayout 集成、U16 dayjs/Antd locale 映射、F6 多 builder/微前端。
