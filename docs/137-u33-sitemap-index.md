# U33-7：sitemap index 与分片

日期：2026-10-22。本切片为预渲染 sitemap 增加 `sitemapChunkSize`：URL 按固定大小拆成 `sitemap-1.xml`…，并写 `sitemap-index.xml`；robots 的 `{{sitemap}}` 指向索引而不是单个 sitemap。

## 1. 使用方式

```ts
{ id: 'ssr', plugin: ssrPlugin, options: {
  prerender: true,
  sitemap: 'https://example.com',
  sitemapChunkSize: 2,
  robots: 'Sitemap: {{sitemap}}',
} }
```

输出（`app.base` 为 `/app/` 时）：

```text
dist/sitemap-index.xml
dist/sitemap-1.xml
dist/sitemap-2.xml
dist/robots.txt   # Sitemap: https://example.com/app/sitemap-index.xml
```

## 2. 契约与语义

- `sitemapChunkSize` 为 1–50000 的整数；需要同时设置 `prerender: true` 与 `sitemap`，否则 `SSR_INVALID`（直接调用 `prerenderStaticPages` 时为 `SSR_PRERENDER_FAILED`）。
- 设置后总是输出索引模式：URL 按页面顺序切成 `Math.max(1, Math.ceil(urls / chunkSize))` 个分片（空结果也写一个空 `sitemap-1.xml`），并写 `sitemap-index.xml`；不写 `sitemap.xml`。
- 索引条目使用绝对 URL：`publicUrl(sitemap, base, '/sitemap-N.xml')`；分片内容与单文件 sitemap 相同的 `<urlset>`，经过 XML 转义。
- `PrerenderResult.sitemap` 指向入口文件（索引模式为 `sitemap-index.xml`），`sitemapChunks` 按顺序返回分片本地路径；`written`/`unchanged`/`skipped` 语义不变。
- robots `{{sitemap}}` 根据 `sitemapChunkSize` 是否设置选择 `/sitemap.xml` 或 `/sitemap-index.xml`。
- 从分片模式改回单文件会删除旧的 `sitemap-index.xml`；从单文件改到分片会删除旧的 `sitemap.xml`，避免 robots 指向两种入口。
- 分片顺序沿用预渲染结果（页面顺序），并发预渲染不会打乱 sitemap 顺序。

## 3. 边界

- 只按 URL 数量分片，不按语言/目录/最后修改时间分组；不支持 `lastmod`/`changefreq`/`priority`。
- 没有压缩（`.xml.gz`）、跨站点 sitemap 引用或索引嵌套。
- 不自动清理切换分片大小后遗留的旧分片文件（例如从 3 片改为 2 片）；构建输出目录仍可能保留旧 `sitemap-3.xml`。
- 分片上限沿用 sitemap 协议的 50000，但 cormi 的预渲染路径本身最多 10000 条。
- 不代替 CDN/搜索引擎提交；sitemap 只写入构建产物。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts` | 选项类型/依赖/范围校验；分片文件、索引 base URL、单文件↔索引切换；`sitemapIndexXml` XML 转义 |
| `tests/browser/ssr.test.ts` | 真实 Vite 构建：4 个 URL 分为 2 片、索引链接、robots 指向 `sitemap-index.xml`、无 `sitemap.xml` |
| 安装包 `ssr` consumer | 公共类型包含 `sitemapChunkSize`/`sitemapIndexXml`；dev/preview/serve 验收保持 |
| `pnpm check` | 570/570 |
| `pnpm test:browser` | 54/54 |
| `pnpm test:package` | 344 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u33-7-sitemap-index-validation.json)。

## 5. 下一步

- U33 剩余：按页 lastmod、按语言拆分/alternates、changefreq/priority；统一 lastmod/压缩见 [U33-8](147-u33-sitemap-lastmod-gzip.md)；
- U17 图表/主题编辑器、F6、U09 热替换、U12 缓存持久化、U16 请求 locale、SSR 生产化。
