# U33-8：sitemap lastmod 与预压缩

日期：2026-10-24。本切片为预渲染 sitemap 增加统一的 `<lastmod>` 与可选 `.gz` 预压缩副本；索引与分片保持一致，robots 仍指向未压缩入口。

## 1. 使用方式

```ts
{ id: 'ssr', plugin: ssrPlugin, options: {
  prerender: true,
  sitemap: 'https://example.com',
  sitemapLastmod: '2026-01-02',
  sitemapGzip: true,
} }
```

单文件输出 `sitemap.xml` + `sitemap.xml.gz`；设置 `sitemapChunkSize` 时输出各 `sitemap-N.xml(.gz)` 与 `sitemap-index.xml(.gz)`。

## 2. 契约与语义

- `sitemapLastmod` 接受 `YYYY-MM-DD` 或带时间的 ISO-8601（`Z`/时区偏移、可选毫秒），作为默认 `<lastmod>`；路由 `meta.lastmod` 存在时按页覆盖，要求同时配置 `sitemap`。索引条目的 `<lastmod>` 使用默认值。
- `sitemapGzip` 为布尔值，要求 `sitemap`；启用后为每个 sitemap 文件写一份 gzip 副本，文件名追加 `.gz`，内容与未压缩文件一致（Node `gzipSync`）。
- `PrerenderResult.sitemapGzip` 按写入顺序返回 gzip 文件路径；`sitemap`/`sitemapChunks` 仍指向未压缩入口/分片。
- robots `{{sitemap}}` 仍展开到 `sitemap.xml` 或 `sitemap-index.xml`，不指向 `.gz`；预压缩副本供 CDN/静态服务器按 `Accept-Encoding` 使用。
- 从分片 gzip 改回单文件时删除旧的 `sitemap.xml`、`sitemap.xml.gz` 与 `sitemap-index.xml(.gz)` 中对应入口；切换分片数量遗留的旧分片（及其 gzip）不会自动清理。
- 非法的日期/类型或缺少 `sitemap` 以 `SSR_INVALID`（直接调用 `prerenderStaticPages` 为 `SSR_PRERENDER_FAILED`）失败。

## 3. 边界

- 路由级 `meta.lastmod` 只适用于字面/预渲染页面；`prerenderPaths` 动态路径没有 meta，仍使用默认值。不读取页面 mtime 或 git 历史。
- 不生成 `changefreq`/`priority`、语言 alternates 或按语言拆分。
- 不做 Brotli、不重命名入口、不自动配置服务器 `Content-Encoding`/缓存头；`.gz` 只是文件副本。
- gzip 由 Node 同步压缩；大 sitemap 会占用构建期内存，但不引入并发/流式压缩。
- 索引/分片的旧文件清理仅覆盖两种入口切换，不扫描任意 `sitemap-*.xml`。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts` | 默认/按页 lastmod XML、索引/分片 lastmod、gzip 解压一致、非法选项 |
| `tests/browser/ssr.test.ts` | 真实 Vite 构建中 guide 的 `meta.lastmod` 覆盖默认值，其余 URL/索引使用默认值；三个 `.gz` 解压与原文一致 |
| 安装包 `ssr` consumer | 同一 fixture 的 dev/preview/serve 验收 |
| `pnpm check` | 572/572 |
| `pnpm test:browser` | 56/56 |
| `pnpm test:package` | 359 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u33-8-sitemap-lastmod-gzip-validation.json)。

## 5. 下一步

- U33 剩余：动态路径 lastmod/alternates、按语言拆分、changefreq/priority；语言 alternates 见 [U33-9](148-u33-sitemap-alternates.md)；
- F6 微前端/dva/valtio、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
