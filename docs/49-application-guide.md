# cormi 应用开发指南：从创建到独立静态交付

日期：2026-10-19，2026-10-20 补充应用运行时、路由配置与约定。本文面向使用框架开发应用的人，而不是修改框架内部的开发者。当前应用模式是 React SPA，默认后端由 React–Vite preset 组合提供，Cordis 管理 Node 插件。以下流程使用本地 kit；不是已经发布到公共 npm 的安装指南。实际验收以 P12 结果记录为准。

## 1. 创建一个有开发接口的应用

在框架仓库准备本地交付包；两个目标目录均须不存在，父目录须真实存在。下面的命令不会发布到 registry 或部署到线上：

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm pack:local --out /Users/mahoo/Projects/cormi-local-kit
pnpm create:app /Users/mahoo/Projects/cormi-first-app \
  --kit /Users/mahoo/Projects/cormi-local-kit --template react-api

cd /Users/mahoo/Projects/cormi-first-app
pnpm install --ignore-scripts
pnpm prepare:app
pnpm dev
```

普通 React 应用可改用 `--template react`；插件作者项目使用 `plugin-react`，其库构建与应用构建的区别见 [作者指南](41-plugin-authoring.md)。首次第三方依赖安装可能联网。`prepare:app` 不是安装钩子：它是你明确执行的生成命令，先生成路由类型和浏览器入口，再让编辑器识别 `.cormi`。

应用自己的 `.cormi-local/` 包含经过哈希检查的框架归档、Cordis 声明补丁与许可。移动开发项目时保留它，提交/分享时注意其中是本地交付包而非注册表依赖；不要把归档目录挂成静态站点。不能只搬 `src` 并期待本地 file: 依赖仍能解析。

## 2. 日常操作与命令边界

默认开发入口是 `127.0.0.1:8000`。同项目同时只能运行一个 CLI，会话结束后再运行检查或构建。不同项目可独立开发，但端口不能冲突。

| 命令 | 职责 |
| --- | --- |
| `pnpm prepare:app` | 根据当前配置和贡献生成入口与路由类型，不启动服务器 |
| `pnpm dev` | 生成、开发服务、组件更新和配置重载 |
| `pnpm typecheck` | 生成并检查应用/配置/客户端类型；不输出业务 JS |
| `pnpm build` | 生成、转译、构建，验证成功后替换本项目受管产物 |
| `pnpm preview` | 本地预览已有构建，不替你重新构建或提供 Mock |
| `pnpm run config:app --for build --json` | 当前配置派生与环境覆盖来源 |
| `pnpm diagnose --for dev --json` | 新 worker 内的原生插件/服务和贡献诊断 |
| `pnpm inspect --json` | 上一次成功生成结果，不重新扫描源码 |

`pnpm config` 是包管理器的内建命令，所以使用明确的 `config:app`，或直接 `pnpm exec cormi config`。`build` 转译成功不能替代 `typecheck`；CI 至少分别运行这两项。`diagnose` 也不是正在运行的 dev 进程的在线监视器。

## 3. 添加页面、布局和静态资源

默认 `src/pages` 使用有限约定：`index.tsx` 为首页，`users/[id].tsx` 为参数页，`_layout.tsx` 为当前目录布局。布局必须渲染 `Outlet`，页面内部使用 `Link`，不要新建第二个 Router 或 React root。

```tsx
// src/pages/_layout.tsx
import { Link, Outlet } from 'react-router';

export default function Layout() {
  return <>
    <nav><Link to="/">首页</Link> | <Link to="/users/42">用户详情</Link></nav>
    <Outlet />
  </>;
}
```

```tsx
// src/pages/users/[id].tsx
import { useParams } from 'react-router';

export default function User() {
  return <main><h1>User {useParams().id}</h1></main>;
}
```

显式设置 `app.routes` 会关闭约定扫描；插件仍可贡献 IR。不要把二者不加区分地叠加为两套路由。不能用同路径页面覆盖原贡献，冲突会被拒绝。

`src/assets.d.ts` 提供 CSS Modules、SVG、PNG 的有限模块声明。页面使用静态 `import styles from './page.module.css'` 和 `import image from './mark.svg'`，由后端处理资源。环境/路由类型来自 `.cormi/routes.d.ts`，默认 tsconfig 包含 `.cormi`，依赖声明检查默认开启。缺失图片仍可能通过类型声明检查，因此实际 `build` 和浏览器验收不能省略。

这份资产声明应保持为没有顶层 import/export 的声明脚本；增加顶层模块标记会改变 ambient module 的含义。关于这一 TypeScript 规则的外部依据见 [官方模块参考](https://www.typescriptlang.org/docs/handbook/modules/reference.html#ambient-modules)。不提供 `declare module '*'` 这样的全量 any 回退。

## 4. 应用运行时：在 src/app.tsx 中初始化

Umi 风格的 `src/app.tsx` 是浏览器侧运行时配置入口，不是 Node 配置或页面组件。cormi 把协议与发现分开：`@cormijs/runtime` 提供 `defineApp` 和钩子协议，`@cormijs/plugin-react` 的 `appRuntimePlugin` 负责可选的文件约定。默认 preset 不自动接管已有的 `src/app.tsx`，避免把普通 React 组件静默解释为配置；在 `cormi.config.ts` 显式加入一次：

```ts
import { appRuntimePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [reactVite],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    // 其他应用插件……
  ],
});
```

然后编写 `src/app.tsx`：

```tsx
import { defineApp } from '@cormijs/runtime';

export default defineApp({
  async render(next) {
    const response = await fetch(import.meta.env.BASE_URL + 'startup.json');
    if (!response.ok) throw new Error('初始化失败');
    await next(); // 只调用一次；next 返回 Promise，也可直接 return
  },
  patchClientRoutes({ routes }) {
    routes.push({ id: 'help', path: 'help', Component: Help });
  },
  rootContainer(container) {
    return <PreferencesProvider>{container}</PreferencesProvider>;
  },
  onRouteChange({ location, action, isFirst, basename }) {
    document.title = `${action} ${location.pathname}`;
  },
});
```

实际顺序是：runtime 插件 `setup` → `app.setup` → `render`（可异步阻塞首屏）→ `patchClientRoutes` → `rootContainer` → 挂载。`setup` 是 cormi 补充的生命周期，可返回清理函数或异步清理函数；`render` 的 `next` 只能调用一次，未调用前不会创建 Router 或 React root，取消启动会拒绝迟到的调用。`rootContainer` 每次挂载只执行一次，不能直接使用 React Hooks；需要 Context 时用 Provider 组件。`onRouteChange` 的首次事件 `isFirst` 为 true，`location` 是包含 basename 的原始 history location；处理函数抛错只记录，不阻塞导航。

应用模块只被生成的浏览器入口静态 import，Node 配置与生成阶段不会执行 `app.tsx`。同一时刻只允许一个 `src/app.ts` 或 `src/app.tsx`，多个候选、符号链接和混合导出会明确失败。需要更低层入口时可关闭约定插件并配置 `app.runtimeConfig: { specifier, exportName }`，或继续使用已有的 `app.runtime`。模型、请求、权限等原生插件可登记额外运行时 key，登记随插件卸载撤回；应用侧用 module augmentation 扩展 `RuntimeConfig` 获得严格类型。完整 API、与 Umi 的差异和验证见 [F1a 应用运行时结果](60-f1a-app-runtime.md)。

示例：`pnpm cormi dev --root examples/app-runtime`，默认监听 `/runtime/`。

### 4.1 配置式嵌套路由、重定向与 wrappers

需要像 Umi 一样用 `routes` 声明布局、index、动态参数、错误边界、重定向和 wrapper 时，显式加入 `routeConfigPlugin`，并把声明放在独立的带类型源文件中：

```ts
// src/app-routes.ts
import type { ConfigRoute } from '@cormijs/plugin-react';

export const routes: readonly ConfigRoute[] = [{
  id: 'shell', path: '/', component: './src/layouts/Shell.tsx',
  routes: [
    { index: true, component: './src/pages/Home.tsx', meta: { title: '首页' } },
    {
      path: 'users/:id', component: './src/pages/User.tsx',
      errorBoundary: './src/pages/UserError.tsx',
      wrappers: ['./src/wrappers/Trace.tsx', './src/wrappers/Gate.tsx'],
    },
    { path: 'legacy/:id', redirect: '/users/:id' },
    { path: 'search', redirect: '/users/me', keepQuery: true },
  ],
}];
```

```ts
// cormi.config.ts
import { routeConfigPlugin } from '@cormijs/plugin-react';
import { routes } from './src/app-routes';

export default defineConfig({
  presets: [reactVite],
  plugins: [{ id: 'application-routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } }],
  app: { routes: [] }, // 显式模式：关闭 src/pages 约定扫描
});
```

`component`/`errorBoundary`/`wrappers` 是项目相对、带运行时扩展名的源码文件，默认导出即组件。顶层 `/` 有子级时是根布局，无子级时是 index；空路径叶子在任意层级都按 index 处理。自动 ID 由完整路径派生，显式 `id` 可消除布局歧义。`redirect` 只接受内部绝对路径，目标参数必须来自当前路由的完整路径；重定向路由不能同时声明页面、错误边界、子路由或 wrappers。`keepQuery: true` 会把当前查询串和 hash 带到目标，且目标自身不能再带查询串或 hash。`wrappers` 按外层到内层展开为普通父路由记录，每个 wrapper 必须渲染 `<Outlet />`；第一个 wrapper 拥有 URL 路径，后续 wrapper 和真实页面使用空路径。`layout: false` 可用于退出显式启用的全局布局，见 4.2。

配置贡献仍通过原生 `ctx.react.routes.tap()` 登记，插件卸载会撤回；与 `app.routes` IR、`defineReactFeature` 及约定扫描的最终校验相同。声明修改按 Node 配置重启生效，页面与 wrapper 组件修改仍走 Fast Refresh。完整字段、限制、Umi 差异和验证见 [F1b 配置式嵌套路由](61-f1b-config-routes.md) 与 [F1c redirect 与 wrappers](62-f1c-redirects-and-wrappers.md)。

示例：`pnpm cormi dev --root examples/config-routes`，默认监听 `/routes/`。

### 4.2 全局布局与 layout:false

需要 Umi 式的全局布局入口时，显式加入 `layoutPlugin`：

```ts
// cormi.config.ts
import { layoutPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [reactVite],
  plugins: [{ id: 'application-layout', plugin: layoutPlugin, options: { id: 'application:layout' } }],
  // ...
});
```

```tsx
// src/layouts/index.tsx
import { Outlet } from 'react-router';

export default function GlobalLayout() {
  return <div className="app-shell"><Outlet /></div>;
}
```

默认查找 `src/layouts/index.tsx`、`.jsx`、`.ts`、`.js`，可用 `options.files` 覆盖。布局必须渲染 `<Outlet />`；它会在全部路由贡献合并后包住所有未退出的顶层路由，嵌套路由的路径和父子关系不变。布局来源通过原生 `ctx.react.layouts` 贡献，插件卸载即撤回；同一时刻只允许一个实际布局，多个候选以 `LAYOUT_CONFLICT` 失败。

顶层路由可声明 `layout: false` 退出全局布局，其整个子树都不经过该布局：

```ts
export const routes = [{
  path: 'login',
  component: './src/pages/Login.tsx',
  layout: false,
}];
```

配置路由的 `layout: false` 会传播到 wrapper 链。默认 404 仍在应用路由之外；自定义 `src/pages/404.tsx` 与 loading 约定见 4.3。完整规则、与 Umi 的差异和验证见 [F1d 全局布局](63-f1d-global-layout.md)。

示例：`pnpm cormi dev --root examples/config-routes`，其中 `/routes/bare` 演示退出全局布局。

### 4.3 约定式 404 与 loading

约定扫描会自动把页面根目录的 `src/pages/404.tsx`/`.jsx` 当作终端 catch-all；未知路径渲染该页面，没有该文件时使用框架默认 404。根级 404 会作为普通顶层路由经过全局布局；嵌套目录中的 `404.tsx` 仍是普通页面。显式 `app.routes` 模式不启用此约定，需要时自行声明 `path: "*"`。

需要自定义首次路由加载回退时，显式加入 `loadingPlugin`：

```ts
// cormi.config.ts
import { loadingPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [reactVite],
  plugins: [{ id: 'application-loading', plugin: loadingPlugin, options: { id: 'application:loading' } }],
  // ...
});
```

```tsx
// src/loading.tsx
export default function Loading() {
  return <p role="status">正在加载页面…</p>;
}
```

默认查找 `src/loading.tsx`、`.jsx`、`.ts`、`.js`，可用 `options.files` 覆盖；多个实际组件以 `LOADING_CONFLICT` 失败，插件卸载后回退默认加载提示。当前回退覆盖首次路由及其懒加载模块解析；客户端导航期间仍保留旧页面，完整的导航期 Suspense loading 留待 U13/F5。规则与验证见 [F1e 404 与 loading](64-f1e-404-and-loading.md)。

示例：`pnpm cormi dev --root examples/conventions`，默认监听 `/conventions/`。

### 4.4 history 模式与公共导航入口

`app.history` 选择 `browser`（默认）、`hash` 或 `memory`：

```ts
export default defineConfig({
  presets: [reactVite],
  app: { base: '/history/', history: 'hash' },
});
```

- `browser`：`app.base` 作为 Router basename，真实路径包含部署前缀，深链需要服务器 fallback；
- `hash`：路由位于 `#` 之后（如 `/history/#/about`），刷新保留路由，不需要逐路由 fallback；`app.base` 仍用于资源与挂载；
- `memory`：Router 从 `/` 开始，地址栏不变，刷新回到首页；适合嵌入或测试，不可分享 URL。

页面导航与查询统一从 `@cormijs/runtime` 导入，不需要直接依赖 `react-router`：

```tsx
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from '@cormijs/runtime';
```

`onRouteChange` 事件包含 `history` 字段。完整行为、Umi 差异和验证见 [F1f history 与导航](65-f1f-history-and-navigation.md)。

示例：`pnpm cormi dev --root examples/history`，默认监听 `/history/`。

### 4.5 model 与 useModel

需要跨页面共享状态时，显式加入 `modelPlugin`。模型默认导出是一个 React Hook：

```ts
// cormi.config.ts
import { modelPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [reactVite],
  plugins: [{ id: 'application-model', plugin: modelPlugin, options: { id: 'application:model' } }],
  // ...
});
```

```ts
// src/models/counter.ts
import { useState } from 'react';

export default function counter() {
  const [count, setCount] = useState(0);
  return { count, increment: () => setCount(value => value + 1) };
}
```

```tsx
// 页面
import { useModel } from '@cormijs/runtime';

const { count, increment } = useModel<{ count: number; increment: () => void }>('counter');
const selected = useModel('counter', (state: { count: number }) => state.count);
```

默认扫描 `src/models/**`，namespace 由路径派生（`counter`、`admin.user`）；重复 namespace 明确失败。模型在每个 `mountApplication` 中执行一次，路由切换保留状态，完整刷新重建；`useModel` 支持 selector，但当前不做深比较记忆化。对象模型、reducers/effects、`extraModels` 和模型依赖排序尚未交付。规则、限制和验证见 [F2a model 与 useModel](66-f2a-models.md)。

示例：`pnpm cormi dev --root examples/model`，默认监听 `/models/`。

### 4.6 初始状态 getInitialState

需要应用启动状态时，同时启用 app 运行时约定与 `initialStatePlugin`：

```ts
// cormi.config.ts
import { appRuntimePlugin, initialStatePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [reactVite],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
  ],
  // ...
});
```

```tsx
// src/app.tsx
import { defineApp } from '@cormijs/runtime';

export default defineApp({
  async getInitialState() {
    return { user: await fetch(import.meta.env.BASE_URL + 'bootstrap.json').then(response => response.json()) };
  },
});
```

```tsx
import { useInitialState } from '@cormijs/runtime';

const { loading, error, data, refresh, setInitialState } = useInitialState<{ user: { name: string } }>();
```

Provider 在挂载后执行一次初始状态，首屏不被阻塞；`refresh` 重新请求，`setInitialState` 直接覆盖并取消在途刷新。当前未提供 `useModel('@@initialState')`、首屏阻塞或 SSR/hydration 集成。完整语义与验证见 [F2b getInitialState](67-f2b-initial-state.md)。

示例：`pnpm cormi dev --root examples/initial-state`，默认监听 `/initial-state/`。

### 4.7 请求客户端与 useRequest

需要可配置的请求客户端时，同时启用 app 运行时与 `requestPlugin`：

```ts
// cormi.config.ts
import { appRuntimePlugin, requestPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [reactVite],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'request', plugin: requestPlugin, options: { id: 'application:request' } },
  ],
  // ...
});
```

```tsx
// src/app.tsx
export default defineApp({
  request: { baseURL: '/api', headers: { 'x-application': 'cormi' }, timeout: 5000 },
});
```

```tsx
import { useRequest } from '@cormijs/runtime';

const { data, loading, error, run, refresh, cancel } = useRequest(
  (client, signal) => client.get<{ message: string }>('/hello', { signal, params: { q: 'one' } }),
);
```

首次请求自动执行；`manual: true` 时只由 `run`/`refresh` 触发。重复执行会中止旧请求，generation 保证最后一次结果生效；取消不写入错误。当前只提供 fetch 客户端，拦截器、统一错误协议、重试、轮询与分页尚未交付。完整语义与验证见 [F2c request 与 useRequest](68-f2c-request.md)。

示例：`pnpm cormi dev --root examples/request`，默认监听 `/request/`。

### 4.8 locale 与消息

需要运行时语言切换时，同时启用 app 运行时与 `localePlugin`：

```ts
import { appRuntimePlugin, localePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [reactVite],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'locale', plugin: localePlugin, options: { id: 'application:locale' } },
  ],
});
```

```tsx
// src/app.tsx
export default defineApp({
  locale: {
    default: 'zh',
    fallback: 'en',
    storageKey: 'demo:locale',
    messages: {
      en: { title: 'Locale demo', greeting: 'Hello, {name}' },
      zh: { title: '语言演示', greeting: '你好，{name}' },
    },
  },
});
```

```tsx
import { FormattedMessage, useIntl } from '@cormijs/runtime';

const { locale, setLocale, t } = useIntl();
setLocale(locale === 'zh' ? 'en' : 'zh');
<p>{t('greeting', { name: 'Ada' })}</p>
<FormattedMessage id="greeting" values={{ name: 'Grace' }} />
```

当前消息只来自内联配置；支持 default/fallback、占位符替换与 localStorage 持久化，不扫描消息目录，也不提供复数/日期格式、UI 库语言联动或 SSR。完整语义见 [F3a locale](69-f3a-locale.md)。

示例：`pnpm cormi dev --root examples/locale`，默认监听 `/locale/`。

### 4.9 access 与初始状态

权限函数放在 `src/app.tsx`，并同时启用 app 运行时、initial-state 与 access 插件：

```ts
import { accessPlugin, appRuntimePlugin, initialStatePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [reactVite],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
    { id: 'access', plugin: accessPlugin, options: { id: 'application:access' } },
  ],
});
```

```tsx
// src/app.tsx
export default defineApp({
  async getInitialState() { return { role: 'admin' }; },
  access(state) {
    const user = state as { role?: string } | undefined;
    return { canAdmin: user?.role === 'admin' };
  },
});
```

```tsx
import { Access, useAccess } from '@cormijs/runtime';

const access = useAccess();
<Access accessible={access.canAdmin} fallback={<p>没有权限</p>}><AdminPanel /></Access>
```

access Provider 依赖初始状态 Provider，并在 runtime stage 中位于其内层；`setInitialState` 改变数据后权限自动重算。当前没有 `src/access.ts` 自动发现或路由级 access 守卫，客户端权限不能替代后端授权。完整语义见 [F3b access](70-f3b-access.md)。

示例：`pnpm cormi dev --root examples/access`，默认监听 `/access/`。

### 4.10 路由菜单与面包屑

显式启用 `menuPlugin` 后，可用路由 meta 生成菜单：

```ts
plugins: [
  { id: 'app-runtime', plugin: appRuntimePlugin },
  { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
  { id: 'access', plugin: accessPlugin, options: { id: 'application:access' } },
  { id: 'menu', plugin: menuPlugin, options: { id: 'application:menu' } },
  { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
]
```

```ts
// 路由 meta
{ path: 'admin', component: './src/Admin.tsx', meta: { title: '管理', order: 3, access: 'canAdmin' } }
```

```tsx
import { useBreadcrumb, useMenu } from '@cormijs/runtime';

const menu = useMenu();       // { key, path, title, order, children, meta }[]
const crumbs = useBreadcrumb(); // 当前路由匹配的 { title, pathname }[]
```

菜单支持 `title`/`name`、`order`、`hideInMenu`/`hidden`/`menu:false`、`access`；无标题布局和 wrapper 会被折叠，嵌套路由形成子菜单。启用 access 时，`meta.access` 为 false/缺失的项隐藏；但这不是导航守卫。当前只提供数据 Hook，不提供 ProLayout/Antd adapter、选中/折叠 helper 或路由级 access。完整语义见 [F3c menu](71-f3c-menu.md)。

示例：`pnpm cormi dev --root examples/menu`，默认监听 `/menu/`。

### 4.11 路由级 access 守卫

在配置路由上添加 `access` key；需要同时启用 `accessPlugin`：

```ts
{ path: 'admin', component: './src/Admin.tsx', access: 'canAdmin', meta: { title: '管理', access: 'canAdmin' } }
```

生成器会为该路由创建守卫：`access.canAdmin` 为 true 时加载页面，否则渲染内置 403，不加载页面模块；有 wrappers 时 access 传播到首个 wrapper，守卫覆盖整条链。菜单读取同一个 key 过滤。客户端守卫只保护 UI，不替代后端授权；403 当前不可定制。完整行为见 [F3d route access](72-f3d-route-access.md)。

### 4.12 自定义 403 与菜单选中

在 app 配置中提供 `accessForbidden` 组件，即可替换路由守卫生成的默认 403：

```tsx
function Forbidden() { return <main role="status"><h1>无权访问</h1></main>; }

export default defineApp({
  getInitialState() { return { role: 'user' }; },
  access(state) { return { canAdmin: (state as { role: string }).role === 'admin' }; },
  accessForbidden: Forbidden,
});
```

菜单页面可使用 `useActiveMenuKeys()` 获取当前路径的选中项和祖先 key：

```tsx
const active = useActiveMenuKeys();
<Link to={item.path} data-active={active.includes(item.key) ? 'true' : undefined}>{item.title}</Link>
```

根路径 `/` 使用精确匹配，其他路径使用 `matchPath(..., { end: false })`。当前不提供菜单折叠状态或 ProLayout/Antd adapter。完整语义见 [F3e](73-f3e-custom-403-active-menu.md)。

### 4.13 配置式 HTML head

使用 React–Vite 时，可显式加入 `htmlPlugin` 配置页面标题、语言、meta、link 与 favicon：

```ts
import { htmlPlugin } from '@cormijs/plugin-react-vite';

plugins: [{
  id: 'html', plugin: htmlPlugin,
  options: {
    title: 'cormi app',
    lang: 'zh-CN',
    favicon: '/favicon.svg',
    metas: [{ name: 'description', content: '应用描述' }],
    links: [{ rel: 'canonical', href: '/' }],
    headScripts: [{ src: '/mark.js', defer: true }, 'window.__mark = "inline-head"'],
    scripts: [{ content: 'window.__tail = "inline-body"' }],
  },
}]
```

`index.html` 仍由应用维护，`htmlPlugin` 只做确定性的 head/body 替换与注入并转义属性值；开发、构建与 preview 结果一致。`headScripts` 落在 `<head>` 末尾、`scripts` 落在 `</body>` 之前；脚本属性只接受 `src|content|async|defer|type|charset|crossorigin`，内联内容中的 `</script` 会被消解。当前不提供每路由 head、CSP/nonce 或非 Vite 后端。规则见 [F4a HTML head](74-f4a-html-head.md) 与 [F4e HTML scripts](78-f4e-html-scripts.md)。

示例：`pnpm cormi dev --root examples/html`，默认监听 `/html/`。

### 4.14 Mock 目录约定

开发期需要文件化 Mock 时，显式加入 `mockPlugin` 与 DevApi Vite bridge：

```ts
import { mockPlugin } from '@cormijs/plugin-dev-api';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';

plugins: [
  { id: 'dev-api', plugin: devApiVitePlugin },
  { id: 'mock', plugin: mockPlugin, options: { intervalMs: 200 } },
]
```

```ts
// mock/users.ts
export default {
  'GET /api/users': { body: { users: ['Ada'] } },
  'POST /api/echo': request => ({ status: 201, body: request.body }),
};
```

默认扫描 `mock/**/*.{ts,tsx,js,jsx}`，路径可带 `/api` prefix（注册时去掉）；值可以是响应对象或返回响应对象的函数。开发期按文件 mtime/size 轮询重载，新文件无效时保留旧规则；生产预览不提供 Mock。Mock 是可执行开发代码，不是安全沙箱。完整语义见 [F4b Mock](75-f4b-mock.md)。

示例：`pnpm cormi dev --root examples/mock`，默认监听 `/mock/`。

### 4.15 路径别名

需要 `@`/`@shared` 之类的导入别名时，显式加入 `aliasPlugin`，并在 tsconfig 中对齐 TypeScript paths：

```ts
import { aliasPlugin } from '@cormijs/plugin-react-vite';

plugins: [{ id: 'alias', plugin: aliasPlugin, options: { aliases: { '@': 'src', '@shared': 'src/shared' } } }]
```

```jsonc
// tsconfig.json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], "@shared/*": ["./src/shared/*"] } } }
```

别名值必须是项目内相对路径；映射在 dev 与 build 中同样生效，插件不修改 tsconfig。完整规则见 [F4c alias](76-f4c-alias.md)。

示例：`pnpm cormi dev --root examples/alias`，默认监听 `/alias/`。

### 4.16 编译期常量

需要把构建信息（版本号、开关、公开模式）烧进客户端代码时，显式加入 `definePlugin`：

```ts
import { aliasPlugin, definePlugin } from '@cormijs/plugin-react-vite';

plugins: [
  { id: 'alias', plugin: aliasPlugin, options: { builtins: true } },
  { id: 'define', plugin: definePlugin, options: { values: {
    APP_NAME: 'cormi define',
    APP_FLAGS: { beta: true, retries: 2 },
    'process.env.APP_MODE': 'example',
  } } },
]
```

值按 JSON 字面量替换（字符串会带引号），`process.env.X` 形式也可用；开发、构建与预览结果一致。TypeScript 需要自行声明：

```ts
// src/defines.d.ts
declare const APP_NAME: string;
declare const APP_FLAGS: { beta: boolean; retries: number };
```

`builtins: true` 让 `@` 指向 `src`，与显式别名并存且不截获 `@scope/pkg` 形式的作用域包；tsconfig 仍需 `paths: { "@/*": ["./src/*"] }`。规则与边界见 [F4d define](77-f4d-define.md)。

示例：`pnpm cormi dev --root examples/define`，默认监听 `/define/`。

### 4.17 全局样式约定

入口级全局样式用显式的 `globalStylePlugin` 声明，而不是在某个页面里隐式导入：

```ts
import { globalStylePlugin } from '@cormijs/plugin-react';

plugins: [{ id: 'styles', plugin: globalStylePlugin, options: { id: 'app:styles' } }]
```

默认候选为 `src/global.css`、`src/global.scss`、`src/global.sass`、`src/global.less`（每个贡献取第一个存在的文件，可用 `options.files` 覆盖）。生成入口 `.cormi/app.tsx` 会按 styles hook 顺序加入 `import "../src/global.css";`，开发期新建或删除该文件会触发生成更新；页面组件仍各自导入局部样式或 CSS Module。Less/Sass 由 Vite 原生处理，需要应用自行安装 `less`/`sass`；CSS Module 的类型声明由应用提供（create 模板已含 `*.module.css`）。规则与边界见 [F4f 全局样式](79-f4f-global-styles.md)。

示例：`pnpm cormi dev --root examples/global-style`，默认监听 `/global-style/`。

### 4.18 `src/access.ts` 权限约定

启用 `accessPlugin` 后，权限函数可以直接放在约定文件里，`src/app.tsx` 只负责初始状态：

```ts
// src/access.ts
export default function access(state: unknown) {
  const user = state as { role?: string } | undefined;
  return { canAdmin: user?.role === 'admin', canRead: user !== undefined };
}
```

约定文件由 `accessPlugin`（默认候选 `src/access.ts`、`src/access.tsx`，可用 `options.files` 覆盖）发现，生成入口以 `applyAccessConvention(resolveAppConfig(...), accessConvention.default)` 合并；如果 `src/app.tsx` 显式提供了 `access`，配置值优先。工厂必须是同步函数，`useAccess()` 返回布尔映射，路由级 `access` 与 `accessForbidden` 的用法不变。规则与边界见 [F4g access 约定](80-f4g-access-convention.md)。

示例：`pnpm cormi dev --root examples/access-convention`，默认监听 `/access-convention/`。

## 5. 环境和 Mock 使用同一个部署前缀

创建 `.env.staging`：

```dotenv
CORMI_PUBLIC_TITLE=cormi MVP staging
MY_PRIVATE_SERVICE_TOKEN=replace-with-your-private-value
```

执行 `pnpm dev --mode staging` 或 `pnpm build --mode staging` 选择该环境。前者仍是开发语义，后者仍是生产代码；客户端可读 `import.meta.env.CORMI_PUBLIC_TITLE`，未明确声明存在的公开项类型为 `string | undefined`，应设置回退值。私有值只能留在 Node 配置/插件，不要展开进 runtime、meta 或日志。覆盖与失败恢复详见 [环境协议](47-environment-configuration.md)。

生成的配置中只改 `const base = '/'` 为 `const base = '/workbench/'`，即可同步改变 Router 和模板开发 API 前缀。Mock provider 使用 `base + 'api'`，页面使用 `import.meta.env.BASE_URL + 'api/hello'`。这只是模板自己的接口约定，框架不会自动修改你写死的第三方后端 URL。

开发接口由可选 Cordis 插件提供，配置中 `enabled: command === 'dev'` 明确关闭非开发目标的实例；页面在生产模式禁用演示请求按钮。Mock 错误、格式不对的响应应表现为错误，不能把 HTML 200 当成 JSON 成功。模板会校验响应 message 类型、支持重新请求，并在页面卸载时取消自己的请求；实际后端的取消语义仍需要它自己实现。

## 6. 把一项应用功能组织为 Cordis 插件

先明确添加所用 SDK，而不是借用依赖提升。当前本地试用包可执行：

```sh
pnpm add @cormijs/plugin-react@file:./.cormi-local/tarballs/cormijs-plugin-react-0.0.1.tgz --ignore-scripts
```

新增 `features/status/plugin.ts`，让插件声明自己的客户端页面位置，而不是由消费者复制其文件：

```ts
import { defineReactFeature, clientModule } from '@cormijs/plugin-react';

export default defineReactFeature({
  id: 'application:status',
  routes: [{
    id: 'application:status:page',
    path: 'status',
    module: clientModule('./Page.tsx', import.meta.url),
  }],
});
```

```tsx
// features/status/Page.tsx
import { Link } from 'react-router';
export default function Status() {
  return <main><h1>状态页面</h1><Link to="/">回到首页</Link></main>;
}
```

在原配置中 import 此插件，并向已有 `plugins` 数组追加 `{ id: 'status', plugin: statusFeature }`；保留原 preset 和开发 API。向 tsconfig.include 加入 `features`，检查业务扩展代码。`clientModule` 只记录模块引用，不在 Node 执行页面源码。停用插件后其路由贡献会撤回，配置改动仍按已有 worker 重启策略执行。

多个领域能力可通过原生 `ctx.plugin()` 组合为父插件；需要 API 的子插件声明 `inject: ['devApi']` 并调用 `ctx.devApi.add()`，作用域释放由 Cordis 和领域服务共同承担。不要另建一套 enable/disable 状态机。生态来源和 Node/client 分离见 [生态契约](37-cordis-ecosystem.md)，真正可分发、多实例插件见 [作者指南](41-plugin-authoring.md) 和 [实例协议](45-plugin-instances.md)。

## 7. 类型失败与构建失败要能阻止错误交付

P16起，TypeScript插件支持根solution和project references。将 `.cormi/**/*` 明确纳入唯一浏览器项目的include，Node工具项目保留自己的环境；需要显式归属时，在TypeScript插件options中设置 `generatedProject`，不要把它写进app。检查按引用关系临时生成内存声明，不落地业务JS/声明或tsbuildinfo；命令的prepare阶段仍会更新受管.cormi。配置示例、原生约束与支持范围见 [TypeScript项目引用](57-typescript-projects.md)。

先运行 `pnpm typecheck --mode staging`，再运行 `pnpm build --mode staging`。类型错误应非零退出；路由冲突、编译失败或输出被篡改时，不能替换旧成功产物。已有未知 `dist` 不会被清空接管；旧版本没有 `.cormi-build.json` 的目录，应先保管或改用新输出位置。

原 `dist/.cormi-build.json` 是本机输出所有权信息，保留在原输出中供下次受管替换。它不是部署服务器必须消费的文件。不要为了不公开元数据而直接删除原文件，应该只在部署副本中排除它。

## 8. 交付静态文件，不部署开发工具链

生产站点只需要构建后的 HTML、JS、CSS 和资产。将所选站点文件复制到独立目录，排除点文件元数据；不要把应用根目录、`.env`、`.cormi-local`、`.cormi`、源码和 `node_modules` 当作发布目录。`preview` 只是本地检查工具，不是线上服务器。

对于 `/workbench/` 部署，服务器应将该前缀的页面导航回退到 `/workbench/index.html`，资源与后端 API 则有各自规则。缺失 `.js`、`.css`、图片和 API 必须返回真正的 404 或由真实后端处理，不能全部返回首页 HTML；否则 HTTP 200 并不能证明模块加载成功。

以下为待按实际服务器核验的 NGINX 示例：假设部署文件已经放在 `/srv/www/workbench/`，并在 `http` 中包含标准 `mime.types`。本轮**没有执行 NGINX 或部署线上服务**；其 root/try_files 的外部依据见 [NGINX 官方文档](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files)。

```nginx
server {
    listen 8080;
    server_name localhost;
    root /srv/www;
    index index.html;

    location = /workbench { return 308 /workbench/; }
    location ~ /\. { return 404; }
    location = /workbench/api { return 404; }
    location ^~ /workbench/api/ { return 404; } # 替换为已配置的真实后端。
    location ~* ^/workbench/.*\.(?:js|mjs|css|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|json)$ {
        try_files $uri =404;
    }
    location /workbench/ {
        try_files $uri $uri/ /workbench/index.html;
    }
    location / { return 404; }
}
```

SPA 页面 404 是客户端路由结果，不一定等于文档请求 HTTP 404；资源和 API 的缺失不应套用这一规则。实际部署还需独立配置 TLS、缓存、访问控制、真实 API、日志和回滚，不属于这里的静态字节交付验证。

## 9. 可复现的整条验收入口

在框架仓库运行：

```sh
pnpm test:application
```

脚本从真实 tgz 安装创建器，新建应用，再显式装配应用内原生 feature；它不是调用原先已安装的演示项目。应用与 kit 重定位后删除自己的依赖，冻结锁文件重装；依次验证根/子路径开发、Mock、类型、三种诊断、重复构建和失败保旧。最后复制纯站点文件、将整个源应用移离原路径，用不引用 cormi/Vite 的测试 HTTP 主机运行页面、插件、动态路由与资产。

`--out <不存在的目录> --keep` 可保存独立应用和日志，默认成功后回收自己的临时应用。测试主机只负责可控验收，不作为框架新增生产服务器，不证明 NGINX/CDN/全部浏览器或长期运维可用。脚本和结果不应包含真实开发者密钥。

当前可用性范围是本地 React SPA 开发和静态交付。公共 npm 的许可/包归属、Cordis 根声明补丁、最新代码的跨平台全回归、长期资源趋势、自动中断发布恢复和 TypeScript 项目引用仍单独列为门槛，不能因为这条应用流程通过就宣称整个框架 1.0 或生产认证完成。
