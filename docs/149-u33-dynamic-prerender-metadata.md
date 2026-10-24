# U33-10：动态预渲染路径元数据

日期：2026-10-24。本切片让 `prerenderPaths` 对象条目携带 `lastmod`/`alternates`，与字面路由的 `meta.lastmod`/`meta.alternates` 使用同一 sitemap 输出。

## 1. 使用方式

```ts
{ id: 'ssr', plugin: ssrPlugin, options: {
  prerender: true,
  sitemap: 'https://example.com',
  sitemapLastmod: '2026-01-02',
  prerenderPaths: async () => [
    { path: '/users/7', lastmod: '2026-04-05', alternates: { en: '/users/7', 'zh-CN': '/zh/users/7' } },
    { path: '/users/8', prerender: false },
  ],
} }
```

动态路径的 `lastmod`/`alternates` 覆盖全局 default，并写入同一个 sitemap（含分片）。

## 2. 契约与语义

- 对象条目允许 `{ path, prerender?, lastmod?, alternates? }`；`lastmod` 为 ISO-8601，`alternates` 为 hreflang → 应用相对路径（规则同路由 meta）。
- `resolvePrerenderEntries` 保留并校验元数据；`resolvePrerenderPaths` 仍返回路径字符串，兼容既有调用。
- 相同路径重复出现时保留第一条条目的元数据；排序按 path。
- `prerenderPages` 接受字符串或条目；动态路径没有路由 head，sitemap 元数据直接进入 `StaticPage`。
- 非法 lastmod/alternates 在配置/解析阶段以 `SSR_INVALID` 失败；预渲染阶段仍可因渲染错误跳过页面，跳过页不进入 sitemap。
- `prerender: false` 的条目在解析后过滤，不消耗渲染，也不进入 sitemap。

## 3. 边界

- 仍必须显式列出动态路径，不做自动爬取或 route meta 合并。
- 没有全局 alternates 模板或按语言拆分；`hreflang` 目标不校验是否已预渲染。
- 不提供 changefreq/priority、动态 mtime 或每路径 head。
- 重复路径的元数据不合并（第一条胜出）。
- 与 `sitemapGzip`/分片/索引组合沿用 U33-8 语义。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts` | 条目 lastmod/alternates 保留、非法值拒绝、`prerenderPages` 元数据进入页面 |
| `tests/browser/ssr.test.ts` | 动态 `/backend/7` 的 lastmod/alternate 出现在真实 sitemap 分片 |
| 安装包 `ssr` consumer | 本次仅运行 `CORMI_PACKAGE_ONLY=ssr` 子集（宿主磁盘不足，全量基线 359） |
| `pnpm check` | 572/572 |
| `pnpm test:browser` | 56/56 |
| `pnpm test:package` | 83 阶段（ssr 子集） |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u33-10-dynamic-prerender-metadata-validation.json)。

## 5. 下一步

- U33 剩余：按语言拆分 sitemap、changefreq/priority、全局 alternates 模板；
- F6 微前端/dva/valtio、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
