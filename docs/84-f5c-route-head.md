# cormi F5c：路由级页面头部（`meta.head`）

日期：2026-10-20。本切片交付 U21 的配置侧能力：路由 `meta.head` 在每次导航后被同步到 `document` 的标题、`meta` 与 `link`，使用可选的 `headPlugin` 显式启用。它是客户端 SEO 元数据同步，不提供 `react-helmet` 式组件 API，也不产生服务端渲染的头部（SSR 属 U32）。

## 1. 使用方式

```ts
// cormi.config.ts
import { headPlugin, routeConfigPlugin } from '@cormijs/plugin-react';

plugins: [
  { id: 'routes', plugin: routeConfigPlugin, options: { id: 'app:routes', routes } },
  { id: 'head', plugin: headPlugin, options: { id: 'app:head', titleTemplate: ' · cormi' } },
]
```

```ts
// 路由声明
{ path: 'guide', component: './src/Guide.tsx', meta: { head: {
  title: '指南',
  metas: [{ name: 'description', content: '指南页' }, { property: 'og:title', content: '指南' }],
  links: [{ rel: 'canonical', href: '/route-head/guide' }],
} } }
```

示例：`pnpm cormi dev --root examples/route-head`（默认 `/route-head/`）。

## 2. 契约与语义

- 提供者：`cormi:route-head`（`inject: ['react']`），以 RuntimeContribution 形式注册 `routeHeadRuntime`（`@cormijs/runtime` 导出），runtime stage 30，排在内置 provider 之后；
- 触发：运行时在每次路由变化时调用插件的 `onRouteChange`；为此该钩子新增可选的第三个参数 `{ options, signal }`，既有两参插件不受影响；
- 合并：从根匹配向最深处合并 `meta.head`——标题取最深者，`metas` 按 `name`/`property` 由深覆盖浅，`links` 按 `rel + href` 去重；同级路由互不影响；
- 写入：标题为 `title + titleTemplate`；`meta`/`link` 带 `data-cormi-head` 标记，每次导航先移除本运行时拥有的节点再写入，作者手写在 index.html 的标签不会被删除或改写；
- 恢复：`setup` 记录挂载时的标题（或 `baseTitle`），应用卸载/插件停用时移除受管节点并恢复标题；
- 校验：`meta.head` 只接受 `title`/`metas`/`links`；`metas` 至多 32 条、必须恰有一个 `name` 或 `property`，`links` 至多 32 条且必须有 `rel`/`href`；违规以 `HEAD_INVALID` 失败（Node 侧插件选项同样校验）；
- 关闭自动同步：`headPlugin({ auto: false })`，便于应用自行调用 `collectHead`/`normalizeHead` 组合。

## 3. 与 Umi 4 / helmet 的差异

Umi 通过内置插件接入 `react-helmet-async`（`packages/preset-umi/src/features/helmet/helmet.ts:6`），页面内用 `<Helmet>` 组件声明标题与元数据，SSR 时由 renderer 收集；cormi 只在路由配置里声明 `meta.head`，由运行时在导航后同步到 document，不引入组件 API，也不参与 SSR。

| 方面 | Umi 4 / react-helmet-async | cormi F5c |
| --- | --- | --- |
| 声明位置 | 页面组件内 `<Helmet>` | 路由 `meta.head` |
| 生效时机 | 组件渲染 | 路由变化回调 |
| SSR 头部 | 支持收集 | 不支持（U32） |
| 合并规则 | helmet 自身优先级 | 根→深合并，深覆盖浅 |
| 恢复 | 卸载自动 | 卸载/停用恢复挂载时标题 |

## 4. 限制

- 仅客户端：不改变 `index.html` 的初始头部，搜索引擎与社交抓取依赖 SSR/静态导出（U32/U33）；
- 不支持 JSON-LD、`<script type="application/ld+json">`、`charset`/`http-equiv` 之外的任意属性，也不支持嵌套 `<Helmet>` 或 React 节点；
- 标题不做多语言联动（`meta.locale` 只用于菜单/面包屑），需要本地化标题时请在路由配置里直接给出或由应用调用 `collectHead` 自行处理；
- 每次导航重建受管节点，不做差分复用；大量 meta 的路由有轻微开销；
- `onRouteChange` 的第三个参数是新增契约，第三方运行时插件若自行实现同名钩子需保持向后兼容。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。开发中修正了两处问题：`collectHead` 起初只按“最近声明”取整块 head，导致子路由丢失父级 description（改为根→深合并），以及带 basename 时 `matchRoutes` 对相对/完整 pathname 的匹配差异（两种形式都接受）。

| 检查 | 结果 |
| --- | --- |
| `tests/route-head.test.ts`（合并规则、形状校验、basename 两种形式） | 3/3 |
| `tests/browser/route-head.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 499/499，0 失败/取消/跳过（F5b 为 496，新增 3 项；约 117 秒） |
| `pnpm test:browser` | 42/42，0 失败/取消/跳过（F5b 为 41，新增 1 项；约 449 秒） |
| `pnpm test:package` | 253 阶段通过（F5b 为 245，新增 8 个 route-head 阶段） |
| `examples/route-head` prepare + typecheck | 退出 0 |

浏览器与独立包消费验收断言：`/` 标题为 `Home · demo` 且继承父级 description；导航到 guide 后标题切换、og:title 与 canonical 写入、受管 meta 为 2 个且不累积；返回 `/` 后受管 meta 回到 1 个、og:title 被移除；深链接与 `page.reload()` 得到同一头部；index.html 中手写的 `meta[name=author]` 始终保留；无控制台错误与开发覆盖层。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5c-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U21 剩余：`<Helmet>` 式组件 API、JSON-LD、SSR 头部收集（依赖 U32）；
- F5d 已交付路由模块预取，见 [F5d 路由预取](85-f5d-route-prefetch.md)；U32/U33/U34/U35：SSR、静态导出、MPA、生产 API 路由；
- F4 剩余：U25 输出与资源策略、U27 微生成器（需 CLI 多参数协议）、U28 工程命令。
