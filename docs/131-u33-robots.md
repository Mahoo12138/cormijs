# U33-5：robots.txt

日期：2026-10-22。预渲染构建可输出 `robots.txt`：`robots` 为原始文本（≤64 KiB），`{{sitemap}}` 在构建时替换为带 `app.base` 的绝对 sitemap URL；需要 `prerender: true`，使用占位时必须配置 `sitemap`。

## 契约

- `ssrPlugin` 选项 `robots?: string`；非字符串/空/超长/含空字节以 `SSR_INVALID` 失败。
- 写入时机：SSR bundle 构建并完成预渲染后，写 `dist/robots.txt`。
- `{{sitemap}}` → `publicUrl(sitemap, base, '/sitemap.xml')`，例如 `https://example.com/app/sitemap.xml`；没有占位时不写 sitemap URL。
- 占位存在但没有 `sitemap` 时构建失败；`robots` 与 `sitemap` 都要求 `prerender: true`。
- 不生成 sitemap index、多语言 alternates 或按环境切换 robots。

## 边界

- 只写一个静态 robots.txt；不做请求级/环境级动态生成。
- 不校验 robots 语法；内容由应用提供。
- 不与 CDN/缓存失效集成。

## 验证

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts` | 选项类型/占位/依赖校验 |
| `tests/browser/ssr.test.ts` | 构建产物 robots.txt 的 `{{sitemap}}` 替换与 base |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u33-5-robots-validation.json |
