# cormi F1b：配置式嵌套路由

日期：2026-10-20。基于路线提交 `a802e4b` 的工作区（F1a/F1b/F1c/F1d/F1e/F1f 尚未提交）。本切片交付 Umi U04 的第一部分：用 `routes` 嵌套声明页面、布局、index、动态参数、错误边界和 meta，由原生插件展开为既有扁平 `RouteRecord` IR。redirect/keepQuery 与 wrappers 已由后续 [F1c](62-f1c-redirects-and-wrappers.md) 补充；`layout:false` 与全局布局由 [F1d](63-f1d-global-layout.md) 交付；404/loading 约定由 [F1e](64-f1e-404-and-loading.md) 交付；history 选择由 [F1f](65-f1f-history-and-navigation.md) 交付。

## 1. 使用方式

在 `cormi.config.ts` 中显式加入路由配置插件。声明是纯数据，放在独立的 `.ts` 文件中便于类型检查和复用：

```ts
// src/app-routes.ts
import type { ConfigRoute } from '@cormijs/plugin-react';

export const routes: readonly ConfigRoute[] = [{
  id: 'shell',
  path: '/',
  component: './src/layouts/Shell.tsx',
  routes: [
    { index: true, component: './src/pages/Home.tsx', meta: { title: '首页' } },
    { path: 'about', component: './src/pages/About.tsx', meta: { title: '关于' } },
    { id: 'team', path: 'team', component: './src/pages/team/TeamLayout.tsx', routes: [
      { index: true, component: './src/pages/team/TeamIndex.tsx' },
      { path: ':id', component: './src/pages/team/Member.tsx', errorBoundary: './src/pages/team/MemberError.tsx' },
    ] },
  ],
}];
```

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { routeConfigPlugin } from '@cormijs/plugin-react';
import { routes } from './src/app-routes';

export default defineConfig({
  presets: [preset],
  plugins: [{
    id: 'application-routes',
    plugin: routeConfigPlugin,
    options: { id: 'application:routes', routes },
  }],
  // 显式路由模式：关闭 src/pages 约定扫描，避免扫描和配置各生成一次。
  app: { routes: [] },
});
```

`routeConfigPlugin` 是普通原生 Cordis 插件：`inject: ['react']`，在 `ctx.effect(() => ctx.react.routes.tap(...))` 中登记一个 reducer。`options.id` 是贡献 owner（同时用于 hook ID 和生成清单的 `source.pluginId`），`options.stage` 沿用 OrderedHooks 的阶段排序；插件卸载时路由贡献随 effect 撤回。多个路由配置插件可共存，但 `options.id` 必须唯一。插件挂载时才展开配置，之后的数组/meta 外部修改不会改变已登记贡献。

## 2. 声明字段与展开结果

| 字段 | 规则 |
| --- | --- |
| `path` | 相对于父路由。顶层允许以 `/` 开头（如 `/docs` → `docs`）；嵌套路径必须相对。末尾 `/`、查询串、hash、`..`、重复参数等由统一路由校验拒绝 |
| `index` | 当前层级首页；不能同时有 `path` 或 `routes`，必须提供 `component` |
| `component` | 项目根部相对路径，必须带 `.ts/.tsx/.js/.jsx/.mts/.cts/.mjs/.cjs` 运行时源码扩展；默认导出是路由组件。不接受 `.d.ts`、绝对路径、反斜杠、隐藏目录或项目外路径 |
| `errorBoundary` | 与 `component` 同样的模块规则；生成时作为急切客户端 import，路由渲染失败时由 React Router 的 `ErrorBoundary` 接收 |
| `meta` | 公开 JSON；进入生成路由的 `handle.cormi.meta`，可用 `useRouteMatches()` 读取。不是权限或服务端凭据 |
| `routes` | 非空子路由数组；没有 `component` 的父路由作为纯布局，渲染子级 `Outlet` |
| `id` | 可选显式 ID；不提供时按路径生成稳定 ID |

顶层 `path: '/'` 或 `path: ''` 的语义：

- 有子路由：无路径根布局（`path: ''`），子路由继续相对根；
- 没有子路由：顶层 index 路由，等价于约定扫描的 `src/pages/index.tsx`；
- 空路径叶子在任意层级都按 index 处理。React Router 不会用无路径、无 index、无子级的路由匹配 URL，因此不能把空路径页面当作普通叶子。

自动 ID：

| 形状 | ID |
| --- | --- |
| 普通路径页面/布局 | `config:<完整相对路径>` |
| index | `config:<父路径或 root>:index` |
| 无路径布局 | `config:<完整路径或 root>:layout` |

例如根布局显式 `id: 'shell'`、首页 `config:root:index`、`team/:id` 页面 `config:team/:id`。ID 包含路径而不是数组下标，增删兄弟路由不会整体重编号；同一路径的无路径布局等歧义会要求显式 `id`。所有展开结果最后仍交给 `validateRoutes`，重复 ID、父子环、歧义端点、非法参数和 meta 错误保持原有错误码。

## 3. 与约定路由、低层 IR 的关系

配置路由是**追加贡献**，不是新的路由系统：`expandRouteConfig` 输出既有 `RouteRecord[]`，`generateApplication`、`generateRouteTypes`、inspect 清单和浏览器 Router 均未分叉。低层 `app.routes` IR 与 `defineReactFeature` 继续可用；显式 IR 可以和配置路由组合，最终统一校验，冲突时本次提交失败并保留上一次有效产物。

与 Umi 不同，配置插件不会隐式关闭约定扫描。需要 Umi 式“配置替代约定”时设置 `app.routes: []`；这样 `src/pages` 只作为组件源码目录。保留追加语义是为了不引入第二个路由开关：任何来源的贡献都通过同一 hook 组合，卸载和冲突诊断也只走一套机制。同步更新约定扫描关闭规则见 [路由与 React 协议](08-routes-and-react.md)。

`component` 必须写项目相对源码文件并带扩展名；当前不解析 Umi 的 `@/`、`@@/`、`./` 省略扩展名或 npm 组件别名。页面模块仍受客户端边界检查：Node SDK、`cormi.config`、`.server.*`、`.env.*`、受管 `.cormi` 目录和符号链接不能进入浏览器入口。

## 4. 与 Umi 4 的差异

参考 `references/umi`（HEAD `2d368e378d10831e7a56b6eaa6e2ae705b1f3c78`，`packages/umi/package.json` 4.7.25）的 `packages/core/src/route/routesConfig.ts`：Umi 配置式路由同样使用 `routes`（拒绝 `children`），递归处理子路由和 `component`，把 `wrappers` 转成额外父路由，并分配顺序 ID。

| 方面 | Umi | cormi F1b |
| --- | --- | --- |
| 启用方式 | `.umirc`/config 的 `routes` | 显式 `routeConfigPlugin` 的 options；默认 preset 不启用 |
| 约定路由 | 配置 routes 后约定失效 | 插件追加贡献；用 `app.routes: []` 显式关闭约定 |
| 组件路径 | 支持别名、省略扩展名、包组件 | 项目相对源码文件且必须带运行时扩展名 |
| ID | 按遍历顺序分配 | 路径派生稳定 ID，必要时显式 `id` |
| 顶层绝对路径 | 支持 | 支持并在展开时规范化为相对路径 |
| 嵌套绝对/末尾斜杠 | 规则更宽松 | 明确拒绝，避免双重规范化 |
| redirect/wrappers/layout:false | 配置字段 | redirect/keepQuery/wrappers 已由 [F1c](62-f1c-redirects-and-wrappers.md) 交付；`layout:false` 与全局布局由 [F1d](63-f1d-global-layout.md) 交付 |
| meta | 路由 metadata | 公开 JSON，进入 `handle.cormi.meta` |

本切片不承诺 Umi 路由配置的二进制兼容，也不引入 Umi PluginAPI。

## 5. 错误、限制与生命周期

- 单次展开最多 10000 条路由，嵌套深度最多 64；显式 ID 最长 128 字符，派生 ID 过长要求显式 ID；
- 未知字段（包括 `children`）、空子数组、叶子缺组件、index 携带 path/children、嵌套绝对路径、组件路径逃逸/隐藏/无扩展名/声明文件都会在插件挂载或展开阶段失败；
- 模块是否存在、是否私有、是否符号链接仍在生成阶段检查；缺失模块进入既有开发修复观察，不会执行页面源码；
- 配置在插件 apply 时快照。修改 `cormi.config.ts`/路由声明属于 Node 配置更新，按现有 worker 重启策略生效；页面组件源码更新仍由 Vite/Fast Refresh 处理。本切片没有为路由声明增加进程内热替换；
- 插件卸载撤回 hook，下一次编译不再包含其路由；活动编译通过 revision 检查拒绝旧贡献；
- 配置冲突发生在统一 `validateRoutes` 阶段，本次生成失败，上次成功产物不被替换。

## 6. 实施中确认的路由语义

1. **无路径叶子不会匹配。** 设计阶段用 React Router 7.18.2 的 `matchRoutes` 验证：`{id, lazy}` 没有 `path`、`index` 或子级时不会进入匹配分支，顶层 `/` 页面若直接规范化为无路径叶子会空白。展开器因此把无子级的 `path: ''`/顶层 `path: '/'` 转为 index；有子级时才是无路径根布局。该规则与约定扫描的 `src/pages/index.tsx` 一致。
2. **基路径下的根布局。** F1a 已确立生成入口使用无路径根布局包裹所有应用路由；本切片的顶层根布局/索引继续沿用该结构，`base: '/routes/'` 下 `/routes/` 可直接匹配首页。
3. **错误边界是急切模块。** 错误边界在生成入口中静态 import，页面仍懒加载；边界必须能在页面模块导入失败前存在。本切片复用既有生成逻辑，没有改变错误边界时序。

## 7. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| 配置路由展开/校验/插件生命周期单元测试 | 6/6 |
| 真实应用浏览器验收（dev、修改组件、typecheck、build、preview、参数、边界、深链、404） | 1/1 |
| `pnpm check` | 445/445，0 失败/取消/跳过（F1a 为 439，新增 6 项；约 104 秒） |
| `pnpm test:browser` | 23/23，0 失败/取消/跳过（F1a 为 22，新增 1 项；约 240 秒） |
| `pnpm test:package` | 117 阶段满足预期（F1a 为 109，新增 8 个 config-routes 阶段） |
| `examples/config-routes` prepare + typecheck | 退出 0；生成清单 owner/pluginId 为 `application:routes` |

独立打包消费覆盖：tgz 独立安装、公开 `ConfigRoute`/`expandRouteConfig`/`routeConfigPlugin` 类型、dev 会话、生产构建、静态 preview，以及修改未构建的组件源码后 preview 页面与 `.cormi/app.tsx` 保持不变。浏览器验收还覆盖了首页/index、布局嵌套、`:id` 参数、meta 展示、错误边界、深链刷新和未知路径 404。最终复跑目录为 `.cache/f1b-final`，独立打包结果为 `.cache/package-test-1792474378151/result.json`，同目录的 `config-routes-preview.png` 是实际生产预览截图；浏览器用例的开发/生产截图写入 `.cache/f1b-config-routes-dev.png` 与 `.cache/f1b-config-routes-preview.png`。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f1b-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 8. 下一步

- U05 已完成：redirect/keepQuery、wrappers 与 `layout:false` 均已交付；全局布局见 [F1d](63-f1d-global-layout.md)；
- U06 已完成：全局布局、根 `src/pages/404.tsx` 与 `src/loading.*` 已分别由 [F1d](63-f1d-global-layout.md)、[F1e](64-f1e-404-and-loading.md) 交付；
- U07 已完成：history 与公共导航/查询入口由 [F1f](65-f1f-history-and-navigation.md) 交付；
- F2：在 F1a 运行时入口上登记 model/initial-state/request 的 key 与 Provider。
