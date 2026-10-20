# cormi F1d：全局布局约定与 layout:false

日期：2026-10-20。本切片交付 U06 的全局布局部分：原生 `layoutPlugin` 发现 `src/layouts/index.*`，把一个无路径全局布局包在所有适用的顶层路由外；配置路由和低层 IR 都可用 `layout: false` 退出该布局。约定 404 与 `src/loading` 已由后续 [F1e](64-f1e-404-and-loading.md) 交付。

## 1. 使用方式

在显式配置中加入 `layoutPlugin`：

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { layoutPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
import { routes } from './src/app-routes';

export default defineConfig({
  presets: [preset],
  plugins: [
    {
      id: 'application-layout',
      plugin: layoutPlugin,
      options: { id: 'application:layout' },
    },
    {
      id: 'application-routes',
      plugin: routeConfigPlugin,
      options: { id: 'application:routes', routes },
    },
  ],
  app: { base: '/routes/', routes: [] },
});
```

```tsx
// src/layouts/index.tsx
import { Link, Outlet } from 'react-router';

export default function GlobalLayout() {
  return <div className="app-shell">
    <nav><Link to="/">首页</Link></nav>
    <Outlet />
  </div>;
}
```

默认候选文件依次为 `src/layouts/index.tsx`、`src/layouts/index.jsx`、`src/layouts/index.ts`、`src/layouts/index.js`；可用 `options.files` 替换为项目内其他相对源码文件。找不到任何候选时布局不生效，不报错；候选文件被创建、删除或替换会触发开发态重新生成。

`layoutPlugin` 是普通原生 Cordis 插件：`inject: ['react']`，通过 `ctx.effect(() => ctx.react.layouts.tap(...))` 登记一个布局贡献，卸载即撤回。多个插件可以声明布局贡献，但同一时刻只允许一个实际存在的布局模块；重复或不明确时以 `LAYOUT_CONFLICT` 失败。布局路由的来源记录为贡献的 `options.id`（默认 `cormi:layout`）。

## 2. 展开语义

全局布局在所有路由贡献合并、统一校验之后应用：

1. 初始布局记录 `id: "layout:global"`，无 path、无 index，模块是发现的布局组件；
2. 所有没有 `parentId` 且 `layout !== false` 的路由记录改为 `parentId: "layout:global"`；
3. 已有子路由保持原父子关系，路径仍相对于自己的父级；
4. 如果所有顶层路由都 `layout: false`，不生成布局记录。

示例：

```ts
[
  { id: 'home', index: true, module: Home },
  { id: 'bare', path: 'bare', module: Bare, layout: false },
  { id: 'team', path: 'team', module: Team, routes: [
    { id: 'team:member', path: ':id', module: Member },
  ] },
]
```

展开后：

| 记录 | parentId | 结果 |
| --- | --- | --- |
| `layout:global` | — | 无路径布局，渲染 `Outlet` 后显示子级 |
| `home` | `layout:global` | 仍在 `/` |
| `bare` | — | 不经过全局布局 |
| `team` | `layout:global` | 仍在 `/team`，子级不变 |
| `team:member` | `team` | 仍在 `/team/:id` |

`layout: false` 是**顶层路由**的退出开关，同时覆盖该路由的整个子树。嵌套路由上的 `layout: false` 不会脱离外层全局布局；它只作为记录字段保留。配置路由有 `wrappers` 时，展开器会把 `layout: false` 同时写到 wrapper 链和真实页面记录上，确保第一个 wrapper 位于顶层时仍能退出全局布局。

布局组件必须渲染 `<Outlet />`。cormi 不执行组件，因此无法静态验证这一点；缺少 Outlet 时只会渲染布局本身。

## 3. 与生成、类型和生命周期的关系

- `RouteRecord` 增加可选 `layout: false`；`validateRoutes` 只接受 `false`，其他值以 `ROUTE_LAYOUT_INVALID` 失败；
- `ConfigRoute` 增加 `layout: false`；`expandRouteConfig` 将它传播到 wrapper 链和页面记录；
- 布局是普通扁平 IR 记录，生成器、route types、inspect 清单、开发观察和产物替换没有分叉；
- 布局模块按页面相同的懒加载路径进入浏览器入口，不在 Node 生成阶段执行；
- 开发态候选文件缺失、创建、删除或变为符号链接都会进入既有修复观察；模棱两可的多个候选布局以 `LAYOUT_CONFLICT` 失败，并保留上一次成功产物；
- 布局插件卸载后，下一次编译不再生成 `layout:global`；活动编译通过贡献 revision 检查拒绝旧结果。

## 4. 与 Umi 4 的差异

参考 `references/umi`（HEAD `2d368e378d10831e7a56b6eaa6e2ae705b1f3c78`，`packages/umi/package.json` 4.7.25）：

- `packages/preset-umi/src/features/tmpFiles/routes.ts` 默认查找 `src/layouts/index.tsx` 等文件，并把它注册为 `@@/global-layout` 父路由；
- `layout: false` 由路由配置传入，wrapper 链会继承该标志。

| 方面 | Umi | cormi F1d |
| --- | --- | --- |
| 启用方式 | 默认约定 | 显式 `layoutPlugin` 或等价原生贡献 |
| 布局位置 | 全局布局父路由，path `/` | 无路径布局记录 `layout:global` |
| 多布局 | `addLayouts` 可注册多个带 test 的布局 | 只支持一个实际布局；冲突明确失败 |
| 布局入口 | `src/layouts/index.*` | 同一默认候选，可用 `files` 覆盖 |
| `layout:false` | 路由配置字段 | 配置和低层 IR 均支持；wrapper 链传播 |
| 404 与 loading | 约定自动发现 | 已由 [F1e](64-f1e-404-and-loading.md) 交付 |
| originPath 等布局元数据 | 记录供渲染器使用 | 未记录；当前不需要 |

本切片不承诺 Umi 布局或路由配置的二进制兼容，也不引入 Umi PluginAPI。

## 5. 错误、限制与生命周期

- `LAYOUT_INVALID`：布局贡献或插件选项为空、ID 非法、候选文件路径非法或重复；
- `LAYOUT_CONFLICT`：多个实际存在的布局模块同时激活；
- `CLIENT_MODULE_INVALID`：布局候选是目录、符号链接或不可用客户端模块；
- `ROUTE_LAYOUT_INVALID`：IR 中 `layout` 不是 `false`；
- `ROUTE_ID_CONFLICT`：显式布局路由 ID 与已有路由冲突；
- 布局候选最多 16 个文件（每个贡献），贡献最多 8 个；路由数量、深度和 wrapper 限制沿用既有校验；
- 配置或布局文件变化按 Node 配置/生成更新策略生效，组件内容仍交给 Vite/Fast Refresh；
- 默认 404 仍在应用路由之外，不会自动经过全局布局；自定义 `src/pages/404.tsx` 由 [F1e](64-f1e-404-and-loading.md) 提供，并作为普通顶层路由经过全局布局。

## 6. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/layout.test.ts`（IR 展开、wrapper 传播、插件发现/冲突/卸载） | 3/3 |
| config-routes 浏览器验收 | 1/1 |
| `pnpm check` | 452/452，0 失败/取消/跳过（F1c 为 449，新增 3 项；约 103 秒） |
| `pnpm test:browser` | 23/23，0 失败/取消/跳过（用例数不变；config-routes 增加全局布局与 opt-out 断言；约 238 秒） |
| `pnpm test:package` | 117 阶段满足预期（config-routes 安装消费覆盖布局插件与公开类型） |
| `examples/config-routes` prepare + typecheck | 退出 0；生成入口包含 `layout:global` |

浏览器验收覆盖：首页与配置路由位于全局布局内；`layout: false` 的顶层路由既不渲染全局布局也不渲染 Shell；现有 redirect、keepQuery、wrapper、错误边界、深链刷新和 404 行为保持通过。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f1d-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 7. 下一步

- U06 已完成：全局布局、`src/pages/404.tsx` 与 `src/loading.*` 已分别由 F1d/F1e 交付；
- U07：browser/hash/memory history 选择与公共导航/查询入口；
- F2：在 F1a 运行时入口上登记 model/initial-state/request 的 key 与 Provider。
