# 布局

cormi 有三层布局，职责不要混用：

| 层级 | 位置 | 作用 |
| --- | --- | --- |
| 目录布局 | `src/pages/**/_layout.tsx` | 包住当前目录及子目录的页面 |
| 配置根布局 | `src/app-routes.ts` 的顶层 route | 配置式路由的父级页面 |
| 全局布局 | `src/layouts/index.tsx` | 在全部路由合并后包住未退出的顶层路由 |

三者都必须渲染 `<Outlet />`，否则子页面没有出口。

## 目录布局

目录布局由基础路由扫描生成，不需要插件：

```tsx
// src/pages/docs/_layout.tsx
import { NavLink, Outlet } from 'react-router'

export default function DocsLayout() {
  return (
    <>
      <aside>
        <NavLink to="/docs">概览</NavLink>
        <NavLink to="/docs/routing">路由</NavLink>
      </aside>
      <article><Outlet /></article>
    </>
  )
}
```

它只影响 `src/pages/docs/**`。目录布局不会自动成为全局布局，也不会绕过 `src/layouts/index.tsx`。

## 配置式根布局

需要为配置路由声明一个明确的根组件时，把顶层 route 指向布局文件：

```ts
export const routes: readonly ConfigRoute[] = [{
  id: 'shell',
  path: '/',
  component: './src/layouts/Shell.tsx',
  routes: [
    { index: true, component: './src/pages/Home.tsx' },
    { path: 'team/:id', component: './src/pages/Team.tsx' },
  ],
}]
```

```tsx
// src/layouts/Shell.tsx
import { Link, Outlet } from 'react-router'

export default function Shell() {
  return (
    <>
      <header><Link to="/">cormi</Link></header>
      <main><Outlet /></main>
    </>
  )
}
```

顶层 `/` 有子级时是布局，无子级时是 index。

## 全局布局

需要 Umi 风格的全局布局入口时，显式挂载 `layoutPlugin`：

```ts
import { layoutPlugin } from '@cormijs/plugin-react'

plugins: [
  { id: 'application-layout', plugin: layoutPlugin, options: { id: 'application:layout' } },
]
```

```tsx
// src/layouts/index.tsx
import { Outlet } from 'react-router'

export default function GlobalLayout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">...</aside>
      <div className="app-main"><Outlet /></div>
    </div>
  )
}
```

默认查找 `src/layouts/index.tsx`、`.jsx`、`.ts`、`.js`，可用 `options.files` 覆盖。布局会在全部路由贡献合并后包住所有未退出的顶层路由，不改变嵌套路由的路径和父子关系。

顶层路由可以退出全局布局：

```ts
{ path: 'login', component: './src/pages/Login.tsx', layout: false }
```

`layout: false` 会传播到 wrappers 链，整个子树都不经过全局布局。默认 404 在应用路由之外，自定义根 `src/pages/404.tsx` 会作为普通顶层路由经过全局布局。

::: warning 只允许一个实际布局
同一时刻只允许一个全局布局候选；多个存在的候选文件会以 `LAYOUT_CONFLICT` 失败。删除或停用插件后回退到无全局布局。
:::

## 与 `rootContainer` 的区别

`src/app.tsx` 的 `rootContainer` 是最外层 React 容器，可以包 Provider，但**不能直接使用 React Hooks**，因为它在 Router 和根之外执行。应用级布局、菜单和导航请放在 `src/layouts/index.tsx`。

```tsx
// src/app.tsx
export default defineApp({
  rootContainer(container) {
    return <PreferencesProvider>{container}</PreferencesProvider>
  },
})
```

## ProLayout 外壳

需要 Ant Design ProLayout 时，安装 `antd` 与 `@ant-design/pro-layout`，挂载 `antdPlugin`、`menuPlugin` 和 `proLayoutPlugin`：

```ts
import { antdPlugin, proLayoutPlugin } from '@cormijs/plugin-antd'
import { menuPlugin } from '@cormijs/plugin-react'

plugins: [
  { id: 'locale', plugin: localePlugin, options: { id: 'application:locale' } },
  { id: 'antd', plugin: antdPlugin, options: { id: 'application:antd' } },
  { id: 'menu', plugin: menuPlugin, options: { id: 'application:menu' } },
  { id: 'pro-layout', plugin: proLayoutPlugin },
]
```

```tsx
// src/layouts/index.tsx
import { Outlet } from 'react-router'
import { ProLayoutShell } from '@cormijs/plugin-antd/pro-layout'

export default function Layout() {
  return (
    <ProLayoutShell
      title="cormi app"
      logo="/logo.svg"
      settingDrawer
      settingsStorageKey="app:pro-layout"
    >
      <Outlet />
    </ProLayoutShell>
  )
}
```

`ProLayoutShell` 的菜单来自 `useMenu()`，折叠状态来自 `useMenuCollapse()`，`syncLocale` 默认把当前 locale 同步到 ProLayout 的五个内置文案。`settingDrawer` + `useProLayoutSettings()` 提供可持久化的主题/布局编辑。

ProLayout 7.22.7 仍声明 antd 4/5 peer；使用 antd 6 时严格 peer 安装需要对该可选集成关闭校验。这属于可选 UI 集成的已知差异，不是 cormi 内核行为。

## SSR 与浏览器 API

布局在 SSR 与客户端都会执行。不要在布局模块顶层直接访问 `window`、`document` 或浏览器专用的图表库；用 `<ClientOnly>` 包住浏览器内容：

```tsx
import { ClientOnly } from '@cormijs/runtime'

<ClientOnly fallback={<div className="chart-placeholder" />}>
  <Chart />
</ClientOnly>
```

`ClientOnly` 在 SSR 输出 fallback，客户端挂载后渲染子节点。图表本身仍应使用 lazy + Suspense 拆分。

## 限制

- 当前没有路由级布局插槽；全局布局只能有一个。
- 布局声明与 `layoutPlugin` 配置修改会重启 worker，组件修改走 Fast Refresh。
- 不要在页面里再创建 Router 或 React root；导航统一使用 `@cormijs/runtime` 的导出。

下一步：[菜单与面包屑](/guide/menu)。
