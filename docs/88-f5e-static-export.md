# cormi F5e：静态导出（逐路由 HTML 外壳）

日期：2026-10-20。本切片交付 U33 的第一步：可选 `staticExportPlugin` 在构建后为每个可静态寻址的路由生成 `dist/<path>/index.html`，并把该路由（含祖先）的 `meta.head` 写进外壳，使静态托管与爬虫拿到正确的标题/描述/canonical。**这不是预渲染**：页面内容仍由浏览器挂载，没有 SSR 数据，也没有 `prerender` 开关。

## 1. 使用方式

```ts
// cormi.config.ts
import { headPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
import { staticExportPlugin } from '@cormijs/plugin-react-vite';

plugins: [
  { id: 'routes', plugin: routeConfigPlugin, options: { id: 'app:routes', routes } },
  { id: 'export', plugin: staticExportPlugin, options: { id: 'app:export', titleTemplate: ' · cormi' } },
  { id: 'head', plugin: headPlugin, options: { id: 'app:head', titleTemplate: ' · cormi' } },
]
```

构建后得到 `dist/index.html`、`dist/guide/index.html` 等；静态托管按目录返回即可。示例：`pnpm cormi build --root examples/static-export` 后运行 `pnpm cormi preview --root examples/static-export`。

## 2. 契约与语义

- 提供者：`cormi:static-export`（React–Vite 桥，`inject: ['vite', 'react']`），只在构建期注册 `apply: 'build'` 的 Vite 插件；在 `closeBundle` 读取路由 IR 与已生成的 `dist/index.html`；
- 导出范围：带页面模块的字面路径路由（含其父级拼接出的完整路径）；动态段（`:id`）、`*` catch-all 与 redirect 路由跳过——前者无法静态寻址，后者没有页面；
- 头部：与运行时 head 相同的合并规则（祖先 `meta.head` 深覆盖、metas 按 name/property、links 按 rel+href），`titleTemplate` 追加在标题后；受管标签不覆盖作者在 index.html 手写的标签；
- 根路由：`/` 的 head 直接写回 `dist/index.html`，其余页面各写一份外壳，路径必须留在输出目录内；
- 组合：与 `headPlugin` 搭配时，静态外壳负责首屏与爬虫，客户端导航后由运行时的 `onRouteChange` 继续同步标题；
- 校验：未生成 `index.html`、路径逃逸、非对象选项、非法 id/titleTemplate 均以 `STATIC_EXPORT_INVALID` 失败；
- 退出：卸载插件后不再生成任何页面外壳。

## 3. 与 Umi 4 的差异

Umi 的 exportStatic（`packages/preset-umi/src/features/exportStatic/exportStatic.ts`）通过 `getMarkup` 生成每个路由的 HTML，支持 `prerender` 标记、SSR 服务端构建产物（`absServerBuildPath`）与 404.html 特殊处理。cormi 目前只做“同一份 SPA 外壳 + 路由 head”的静态化：没有 `getMarkup`、没有 SSR 产物、没有 404.html 与 prerender。

| 方面 | Umi 4 | cormi F5e |
| --- | --- | --- |
| 每路由 HTML | 有（可含 prerender） | 有（仅外壳） |
| SSR 产物 | 支持 | 未交付（U32） |
| 动态路由 | Windows 下跳过 | 一律跳过 |
| catch-all | 特殊导出 404.html | 跳过 |
| 头部 | 由 markup/SSR 决定 | `meta.head` + titleTemplate |

## 4. 限制

- **不是预渲染**：HTML 里没有页面内容与 loader 数据，首屏仍要等 JS；搜索引擎若要求内容快照，需要 U32 SSR；
- 要求 `index.html` 声明 `<meta charset>`，否则静态托管可能按错误编码返回非 ASCII 标题（本切片验收中就因此修正了脚手架）；
- 只导出模块路由；纯 redirect、路径参数、catch-all 与索引子路由（与父路径相同、自动去重）不单独出文件；
- 不生成 `404.html`、`sitemap.xml`、`robots.txt`，也不改写绝对资源 URL（资源由 `app.base` 决定，天然适配子路径）；
- 与 `htmlPlugin` 的 `transformIndexHtml` 叠加时，静态导出只追加/替换 head，不再做第二次 HTML 插值。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。首轮包消费验证在打包校验阶段失败：`plugin-react-vite` 新增了对 `@cormijs/routes` 的类型引用但未声明依赖；补上 workspace 依赖后重跑打包/边界单元用例（15/15）与**受影响的独立包消费阶段**（check/browser 未受影响，未重跑）。另外验收脚手架起初缺少 `<meta charset>`，导致非 ASCII 标题经静态托管按错误编码返回，已修正并作为限制记录。

| 检查 | 结果 |
| --- | --- |
| `tests/static-export.test.ts`（路由筛选、祖先 head 合并、渲染转义、写出与根外壳、缺 index.html 失败） | 3/3 |
| `tests/browser/static-export.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 508/508，0 失败/取消/跳过（F4k 为 505，新增 3 项；约 115 秒） |
| `pnpm test:browser` | 46/46，0 失败/取消/跳过（F4k 为 45，新增 1 项；约 494 秒） |
| `pnpm test:package` | 286 阶段通过（F4k 为 278，新增 8 个 static-export 阶段） |
| `examples/static-export` prepare + typecheck | 退出 0 |

独立包消费与浏览器验收断言：`dist/index.html` 的标题为 `Site · demo` 且含父级 description 与作者自写 `meta[name=author]`；`dist/guide/index.html` 的标题为 `Guide · demo`、含 canonical 与继承的 description；`dist/detail/index.html` 不存在（动态路由跳过）；preview 对 `/static/guide/` 返回 200 且 HTML 标题正确；页面在 `/guide/` 渲染后客户端导航回首页，`headPlugin` 把标题同步为 `Site · demo`；无控制台错误与开发覆盖层。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5e-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U33 剩余：prerender、`404.html`、与 SSR 组合；
- U32/U34/U35：SSR、MPA、生产 API 路由；
- F4 剩余：U28 工程命令；U23：样式生态；U16：格式化与 locale key 类型。
