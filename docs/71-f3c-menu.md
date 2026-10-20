# cormi F3c：路由菜单、面包屑与 access 过滤

日期：2026-10-20。本切片交付 F3 的菜单基础：显式启用的 `menuPlugin` 从已挂载的路由树和 `meta` 生成嵌套菜单；`useBreadcrumb` 从当前路由匹配生成面包屑；启用 access 时按 `meta.access` 过滤菜单。UI adapter（Antd/ProLayout）、菜单折叠/选中 helper、路由级 access 守卫与服务端授权尚未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { accessPlugin, appRuntimePlugin, initialStatePlugin, menuPlugin, routeConfigPlugin } from '@cormijs/plugin-react';

const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', routes: [
    { index: true, component: './src/Home.tsx', meta: { title: 'Home', order: 2 } },
    { path: 'about', component: './src/About.tsx', meta: { title: 'About', order: 1 } },
    { path: 'team', component: './src/Team.tsx', meta: { title: 'Team', order: 4 }, routes: [
      { index: true, component: './src/TeamHome.tsx', meta: { title: 'Overview' } },
    ] },
    { path: 'admin', component: './src/Admin.tsx', meta: { title: 'Admin', order: 3, access: 'canAdmin' } },
  ],
}];

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
    { id: 'access', plugin: accessPlugin, options: { id: 'application:access' } },
    { id: 'menu', plugin: menuPlugin, options: { id: 'application:menu' } },
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
  ],
  app: { routes: [] },
});
```

```tsx
import { Link, Outlet, useBreadcrumb, useMenu } from '@cormijs/runtime';

function MenuList({ items }: { items: ReturnType<typeof useMenu> }) {
  return <ul>{items.map(item => <li key={item.key}>
    <Link to={item.path}>{item.title}</Link>
    {item.children.length ? <MenuList items={item.children} /> : null}
  </li>)}</ul>;
}

export default function Shell() {
  const crumbs = useBreadcrumb();
  return <main>
    <nav><MenuList items={useMenu()} /></nav>
    <p>{crumbs.map(item => item.title).join(' > ')}</p>
    <Outlet />
  </main>;
}
```

`menuPlugin` 是普通原生 Cordis 插件：`inject: ['react']`，登记一个 runtime Provider，卸载后下一次编译不再包含 `menuRuntime`。

## 2. 菜单语义

`meta` 字段：

| 字段 | 规则 |
| --- | --- |
| `title` / `name` | 菜单与面包屑标题；优先 `title` |
| `order` | 数字排序，升序；缺失为 0 |
| `hideInMenu` | `true` 时隐藏该项及整个子树 |
| `hidden` | 同 `hideInMenu` |
| `menu` | `false` 时隐藏该项及整个子树 |
| `access` | 权限键；启用 access 时只有 `access[key] === true` 才显示 |
| `icon` | 原样保留在 item meta 中，由 UI adapter 解释 |

展开规则：

1. 从 `mountApplication` 实际挂载的 `clientRoutes` 构建；不使用 Node 配置快照；
2. 无 `title` 的布局/wrapper 被折叠，其子项提升到当前层级；
3. 有 `title` 的父路由形成嵌套菜单；index 子路由使用父路径；
4. `*` catch-all 与 `cormi:` 内部路由不进入菜单；
5. 同层按 `order` 再按标题排序；深度最多 64，条目最多 1000；
6. 启用 access 时，`meta.access` 缺失于权限表视为 false；未启用 access 时不做过滤；
7. access 状态变化会重新生成菜单；`meta.access` 只是 UI 过滤，不阻止直接导航或 API 调用。

`useBreadcrumb()` 使用当前 `useRouteMatches()` 的 `meta.title`/`name` 生成父到子的标题链；没有标题的布局不产生条目。

## 3. 运行时契约

- Runtime plugin Provider 现在接收 `routes`（实际挂载的路由树）与 `basename`，使菜单等 Provider 不再依赖 Node 配置；
- menu runtime 贡献使用 stage 20，位于 access（stage 10）和 initialState（stage 0）内层，因此能读取权限上下文；
- `useMenu` 必须位于 menuProvider 内；`useBreadcrumb` 依赖 Router 上下文，只能在路由树内使用；
- 菜单 provider 每个挂载独立，不修改路由树或生成静态菜单文件。

## 4. 与 Umi 4 的差异

参考 Umi 4.7.25 的 `packages/plugins/src/layout.ts` 与 ProLayout 菜单文档：

| 方面 | Umi | cormi F3c |
| --- | --- | --- |
| 菜单来源 | 路由配置 + layout 插件 | 实际挂载路由树 + meta |
| UI | Antd/ProLayout 集成 | 仅数据 Hook，无 UI adapter |
| 过滤 | access + hideInMenu 等 | `meta.access` + hide/hidden/menu |
| 面包屑 | ProLayout 提供 | useBreadcrumb 数据 Hook |
| 选中/折叠/图标渲染 | UI 组件能力 | 未封装，应用自行选择 |
| 路由级 access | 支持 | 尚未交付 |

本切片不承诺 Umi layout/menu 配置或 ProLayout 组件的二进制兼容。

## 5. 限制

- 不提供 Antd/ProLayout/其他 UI adapter，也不自动渲染菜单；
- 不提供当前选中项、折叠、图标映射、权限菜单缓存等 UI helper；
- `meta.access` 只过滤显示，不是导航守卫或服务端授权；
- 隐藏带标题路由会隐藏整个子树，不能“隐藏父级但显示子级”；
- 菜单在每次 access 变化时重建；不含异步图标/远程菜单；
- 路由级 access guard、面包屑 i18n 与 SSR 序列化待后续。

## 6. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/menu.test.ts`（贡献、顺序、非法选项、卸载） | 2/2 |
| `tests/browser/menu.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 468/468，0 失败/取消/跳过（F3b 为 466，新增 2 项；约 113 秒） |
| `pnpm test:browser` | 32/32，0 失败/取消/跳过（F3b 为 31，新增 menu 用例；约 344 秒） |
| `pnpm test:package` | 181 阶段满足预期（F3b 为 173，新增 8 个 menu 阶段） |
| `examples/menu` prepare + typecheck | 退出 0 |

浏览器验收覆盖：meta 排序、无 title 布局折叠、Team/Overview 嵌套、access 隐藏 Admin、面包屑 Home/About/Team > Overview、升级角色后 Admin 出现并可导航；开发与生产 preview 一致。独立打包消费覆盖 menu 插件公开类型、MenuItem/BreadcrumbItem/useMenu/useBreadcrumb、开发、构建与静态预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f3c-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 7. 下一步

- F3d：路由级 access guard、菜单选中/折叠 helper 与可选 ProLayout/Antd adapter，route guard 已由 [F3d](72-f3d-route-access.md) 交付；
- F4：Mock 约定、配置/别名、HTML/head、样式与资源、微生成器等日常工程能力；
- U15 后续：layout:false 与菜单/布局联动的完整验证。
