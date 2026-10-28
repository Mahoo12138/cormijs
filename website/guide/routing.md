# 路由

cormi 的最终路由是一棵**扁平的 RouteRecord IR**，由约定扫描、配置式路由和插件贡献合并而成。最终校验统一执行，冲突会明确失败，不会用同路径页面互相覆盖。

两种写法可以分别使用：

| 写法 | 适合 | 入口 |
| --- | --- | --- |
| 约定式 | 大多数页面；目录即路由 | `src/pages/**` |
| 配置式 | 需要嵌套布局、wrapper、redirect、错误边界或精细 meta | `routeConfigPlugin` |

显式设置 `app.routes` 会关闭 `src/pages` 扫描。不要在同一个应用里把两套路由不加区分地叠加。

## 约定式路由

```text
src/pages/
├─ index.tsx              /
├─ about.tsx              /about
├─ _layout.tsx            当前目录布局
├─ docs/
│  ├─ index.tsx           /docs
│  └─ getting-started.tsx /docs/getting-started
├─ users/
│  └─ [id].tsx            /users/:id
├─ files/
│  └─ [...path].tsx       /files/*
└─ 404.tsx                根级 catch-all
```

目录布局必须渲染 `<Outlet />`：

```tsx
// src/pages/_layout.tsx
import { Link, Outlet } from 'react-router'

export default function Layout() {
  return (
    <>
      <nav>
        <Link to="/">首页</Link> | <Link to="/users/42">用户详情</Link>
      </nav>
      <Outlet />
    </>
  )
}
```

页面参数使用 `useParams`：

```tsx
// src/pages/users/[id].tsx
import { useParams } from 'react-router'

export default function User() {
  return <main><h1>User {useParams().id}</h1></main>
}
```

`404.tsx` 只有放在页面根目录才会成为终端 catch-all。嵌套目录里的 `404.tsx` 仍是普通页面。没有根 404 时使用框架默认页面。

## 配置式路由

把声明放在独立的带类型源文件里，再由 `routeConfigPlugin` 贡献：

```ts
// src/app-routes.ts
import type { ConfigRoute } from '@cormijs/plugin-react'

export const routes: readonly ConfigRoute[] = [{
  id: 'shell',
  path: '/',
  component: './src/layouts/Shell.tsx',
  routes: [
    { index: true, component: './src/pages/Home.tsx', meta: { title: '首页' } },
    {
      path: 'users/:id',
      component: './src/pages/User.tsx',
      errorBoundary: './src/pages/UserError.tsx',
      wrappers: ['./src/wrappers/Trace.tsx', './src/wrappers/Gate.tsx'],
    },
    { path: 'legacy/:id', redirect: '/users/:id' },
    { path: 'search', redirect: '/users/me', keepQuery: true },
    { path: '*', component: './src/pages/NotFound.tsx' },
  ],
}]
```

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs'
import reactVite from '@cormijs/preset-react-vite'
import { routeConfigPlugin } from '@cormijs/plugin-react'
import { routes } from './src/app-routes'

export default defineConfig({
  presets: [reactVite],
  plugins: [
    { id: 'application-routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
  ],
  app: { routes: [] }, // 关闭 src/pages 约定扫描
})
```

### 字段

| 字段 | 说明 |
| --- | --- |
| `path` | 相对父路由的路径；顶层使用 `/` |
| `index` | 索引路由，不能与 `path` 同时使用 |
| `component` | 项目相对、带运行时扩展名的源码文件，默认导出为组件 |
| `errorBoundary` | 路由错误边界，默认导出为组件；通过 `useRouteError` 读取错误 |
| `wrappers` | 外层到内层的布局组件，每个都必须渲染 `<Outlet />` |
| `redirect` | 内部绝对路径；不能与页面、子路由、错误边界或 wrappers 同时使用 |
| `keepQuery` | 重定向时保留当前 query 与 hash |
| `layout` | 设为 `false` 时退出可选的全局布局 |
| `access` | 权限 key，由 `accessPlugin` 在渲染前求值 |
| `clientLoader` | 页面模块中的浏览器 loader 导出名 |
| `serverLoader` | 页面模块中的服务端 loader 导出名，要求 SSR |
| `meta` | 公开 JSON 元数据，供菜单、head、analysis 等插件读取 |
| `routes` | 子路由 |
| `id` | 可选路由 id；自动派生有歧义时用显式 id |

顶层 `/` 有子级时是根布局；无子级时是 index。空路径叶子在任意层级都按 index 处理。

### redirect

目标必须是内部绝对路径，参数只能来自当前路由的完整路径：

```ts
{ path: 'legacy/:id', redirect: '/users/:id' }
{ path: 'search', redirect: '/users/me', keepQuery: true }
```

`keepQuery` 的目标不能自带查询串或 hash。重定向以 replace 导航完成，不渲染页面。

### wrappers

`wrappers` 按外层到内层展开成普通父路由记录：

```tsx
// src/wrappers/Trace.tsx
import { Outlet } from 'react-router'

export default function Trace() {
  return <div data-trace><Outlet /></div>
}
```

第一个 wrapper 拥有 URL 路径，后续 wrapper 和真实页面使用空路径。路由级 `access` 会传播到首个 wrapper，守卫覆盖整条链。

## 布局

全局布局是可选的，通过 `layoutPlugin` 发现 `src/layouts/index.tsx`：

```ts
plugins: [{ id: 'application-layout', plugin: layoutPlugin, options: { id: 'application:layout' } }]
```

```tsx
// src/layouts/index.tsx
import { Outlet } from 'react-router'

export default function GlobalLayout() {
  return <div className="app-shell"><Outlet /></div>
}
```

它会在全部路由贡献合并后包住所有未退出的顶层路由，不改变嵌套路由的路径和父子关系。顶层路由声明 `layout: false` 时，整个子树都不经过该布局：

```ts
{ path: 'login', component: './src/pages/Login.tsx', layout: false }
```

同一时刻只允许一个实际布局，多个候选以 `LAYOUT_CONFLICT` 失败。详见[布局](/guide/layout)。

## 404 与 loading

根级 `src/pages/404.tsx` 会作为普通顶层路由经过全局布局。自定义 403 由 `app.accessForbidden` 提供，见[权限](/guide/access)。

首次路由加载的回退通过 `loadingPlugin` 提供：

```ts
plugins: [{ id: 'application-loading', plugin: loadingPlugin, options: { id: 'application:loading' } }]
```

```tsx
// src/loading.tsx
export default function Loading() {
  return <p role="status">正在加载页面…</p>
}
```

当前回退覆盖首次路由及其懒加载模块解析；客户端导航期间仍保留旧页面。

## history

```ts
export default defineConfig({
  presets: [reactVite],
  app: { base: '/history/', history: 'hash' },
})
```

| 值 | 行为 |
| --- | --- |
| `browser`（默认） | `app.base` 作为 Router basename；深链需要服务器 fallback |
| `hash` | 路由位于 `#` 之后；刷新保留路由，不需要逐路由 fallback |
| `memory` | Router 从 `/` 开始，地址栏不变；刷新回到首页，不可分享 |

导航和查询统一从 `@cormijs/runtime` 导入：

```tsx
import {
  Link, NavLink, Navigate, Outlet,
  useLocation, useNavigate, useParams, useSearchParams,
} from '@cormijs/runtime'
```

`onRouteChange` 事件同时包含 `history` 字段。

## 数据加载

### clientLoader

页面模块导出一个 loader，在渲染前执行。约定式页面会被自动识别：

```tsx
// src/pages/member/[id].tsx
import { useClientLoaderData } from '@cormijs/runtime'

export default function Member() {
  const data = useClientLoaderData<{ id: string }>()
  return <p>{data.id}</p>
}

export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  return { id: params.id ?? '-' }
}
```

配置式路由用 `clientLoader: 'clientLoader'` 显式指定导出名。loader 失败由该路由的 `errorBoundary` 呈现；读取任意匹配路由的数据可用 `useRouteLoaderDataFor(routeId)`，当前路由错误可用 `useClientLoaderError()`。

重导出也会被识别：

```ts
export { clientLoader } from './reusable-loader'
export { load as clientLoader } from './loader'
```

`export *`、`export type`、给 loader 改名成其他绑定，以及运行时拼接不会被识别。

### 类型

生成器会写 `.cormi/loaders.d.ts`，按路由 id 提供返回类型：

```ts
type MemberData = CormiLoaderData.Data<'config:member/:id'>
const data = useClientLoaderData<MemberData>()
```

删除或改名 loader 导出会导致 `typecheck` 失败。

### serverLoader

SSR 应用可以在路由上声明 `serverLoader: 'serverLoader'`。它只在服务端执行，结果写入 hydration；客户端导航时通过 `<base>.cormi/server-loader` 取数，用 `useServerLoaderData(routeId?)` 读取。详见 [SSR](/guide/build#ssr)。

## 预取

`routePrefetchPlugin` 暴露生成入口中的路由模块注册表：

```ts
plugins: [{ id: 'prefetch', plugin: routePrefetchPlugin, options: { id: 'app:prefetch', mode: 'idle' } }]
```

```tsx
const { ids, prefetch, prefetchAll } = usePrefetch()
void prefetch('config:guide')
```

- `manual`（默认）：只暴露 API。
- `idle`：首屏后通过 `requestIdleCallback` 预热全部路由，2 秒超时，卸载取消。路由较多时建议手动。

悬停或聚焦即预取：

```tsx
const intent = usePrefetchOnIntent('config:guide', { delayMs: 50 })
<Link to="/guide" {...intent}>指南</Link>
```

进入视口即预取：

```tsx
const visible = usePrefetchOnVisible('config:guide', { rootMargin: '200px' })
<Link ref={visible} to="/guide">Guide</Link>
```

预取只加载代码，不预取 `clientLoader` 数据。

## 限制

- 路由声明修改按 Node 配置重启生效；页面和 wrapper 组件修改走 Fast Refresh。
- 约定式路由不识别 `clientLoader` 的配置式字段，但会识别页面导出的 `clientLoader`。
- 404 与 loading 是两套独立机制；loading 不覆盖客户端导航期间的 Suspense。
- 嵌套目录的 `404.tsx` 不会自动成为该目录的 catch-all。

下一步：[布局](/guide/layout)。
