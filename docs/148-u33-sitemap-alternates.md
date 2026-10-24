# U33-9：sitemap 语言 alternates

日期：2026-10-24。本切片允许页面通过路由 `meta.alternates` 声明 hreflang 与对应应用路径；预渲染 sitemap 为每个 URL 写入 `<xhtml:link rel="alternate">`，供多语言站点声明等价页面。

## 1. 使用方式

```ts
const routes = [
  { id: 'guide', path: '/guide', component: './src/Guide.tsx', meta: {
    lastmod: '2026-03-04',
    alternates: {
      en: '/guide',
      'zh-CN': '/guide?lang=zh',
      'x-default': '/guide',
    },
  } },
];
```

输出：

```xml
<url><loc>https://example.com/app/guide</loc>
  <lastmod>2026-03-04</lastmod>
  <xhtml:link rel="alternate" hreflang="en" href="https://example.com/app/guide"/>
  <xhtml:link rel="alternate" hreflang="zh-CN" href="https://example.com/app/guide?lang=zh"/>
  <xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/app/guide"/>
</url>
```

## 2. 契约与语义

- `meta.alternates` 必须是 `hreflang → 应用相对路径` 的字符串映射；路径以 `/` 开头、≤2048、不含 NUL/换行/`#`。`hreflang` 为 2–8 位语言标签或 `x-default`。
- 仅对成功预渲染的页面写入 alternates；`meta.alternates` 只影响 sitemap，不写入 HTML head。
- `href` 通过 `publicUrl(sitemap, base, path)` 转为绝对 URL，保留路径中的查询串；不自动添加/规范化语言参数。
- 有 alternates 的 `<urlset>` 增加 `xmlns:xhtml` 命名空间；分片保留各页 alternates，索引条目不含 alternate。
- 没有 alternates 的页面/sitemap 输出保持原样；不因全局语言配置自动推导等价路径。
- 非法映射在预渲染阶段以 `SSR_PRERENDER_FAILED` 失败（缺少 sitemap 时忽略 meta）。

## 3. 边界

- 不提供全局 alternates 模板、按 locale 目录自动改写、语言前缀推断或反向链接生成。
- 不校验 alternate 目标是否已预渲染、是否存活或是否互相引用；由应用保证正确性。
- 动态 `prerenderPaths` 可通过对象条目声明 `alternates`/`lastmod`（U33-10）；没有对象元数据的路径仍无法声明。
- 不输出 `xhtml:link` 到 HTML `<head>`；需要 head 时使用路由/组件 head API。
- 不处理 RTL/语言协商或搜索引擎提交。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts` | XML 命名空间与 hreflang/href、分片保留 alternates、按页 lastmod 共存 |
| `tests/browser/ssr.test.ts` | 真实构建中 guide 的 en/zh-CN/x-default alternate 以 base 绝对 URL 输出 |
| 安装包 `ssr` consumer | 同一 fixture 的 dev/preview/serve 验收 |
| `pnpm check` | 572/572 |
| `pnpm test:browser` | 56/56 |
| `pnpm test:package` | 83 阶段（`CORMI_PACKAGE_ONLY=ssr`；宿主磁盘不足未重跑全量，基线为 359） |

宿主磁盘剩余空间不足以重跑完整安装包矩阵；本轮运行 `ssr` 子集验证本次改动涉及的 consumer。完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u33-9-sitemap-alternates-validation.json)。

## 5. 下一步

- U33 剩余：changefreq/priority、按语言拆分 sitemap；
- F6 微前端/dva/valtio、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
