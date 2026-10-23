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

默认扫描 `src/models/**`，namespace 由路径派生（`counter`、`admin.user`）；重复 namespace 明确失败。函数默认导出是 Hook 模型：每个 `mountApplication` 执行一次，路由切换保留状态，完整刷新重建。含 `state` 的对象默认导出是对象模型：`state + reducers + effects + subscriptions`，用 `defineModel` 获得 state 推断；`useModel` 订阅状态，`useModelDispatch(namespace)` 派发 reducer/effect，effect 的 `put` 可用 `namespace/action` 跨对象模型；reducer 必须返回新 state；subscriptions 在挂载后按 `dependencies` 拓扑顺序执行并可返回清理函数（SSR 不执行），裸 dispatch 作用于本模型、带 namespace 的动作走全局。`modelPlugin` 的 `extraModels` 可追加目录外文件，namespace 仍由路径派生。`useModel(namespace, selector, isEqual?)` 支持选择器与自定义等值比较：结果相等时不重渲染，派生对象需显式 isEqual；Hook 模型不适用该优化。仍无异步依赖、热替换保留 store 与 effect 取消。Hook 模型规则见 [F2a](66-f2a-models.md)，对象模型见 [U09-1](116-u09-object-models.md)、[U09-2](118-u09-subscriptions-extra-models.md)、[U09-3](122-u09-model-dependencies.md) 与 [U09-4](129-u09-selector-equality.md)。

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

首次请求自动执行；`manual: true` 时只由 `run`/`refresh` 触发。重复执行会中止旧请求，generation 保证最后一次结果生效；取消不写入错误。`retry`/`retryDelay` 在最终失败前重试，`pollingInterval` 在成功后轮询（`pollingWhenHidden` 控制隐藏页），`refreshDeps` 值变化时重新执行，`debounceWait` 合并窗口内的 run/refresh（可加 `debounceMaxWait` 限制最长延迟，`debounceLeading`/`debounceTrailing` 选择边沿）、`throttleWait` 进行前沿节流（二者互斥，轮询绕过）；取消和卸载会清理重试、防抖与轮询计时。列表分页使用 `usePagination`：服务返回 `{ list, total?, hasMore? }`，`loadMore` 追加、`reload` 回到第 1 页、`hasMore` 按显式值/total/pageSize 推断，`merge` 可自定义合并；同一时刻只允许一个分页请求；游标分页用 `useCursorPagination`（`nextCursor` 追加、reload 回到首屏）。GET 短缓存使用请求选项 `cacheTime`（0–3600000ms），同键并发共享一个请求，`cacheBust` 跳过读取且不写缓存；请求配置 `cacheLimit` 控制 LRU 容量，`cacheTags` + `client.invalidateCache(tags?)` 按标签失效。缓存默认只在当前客户端实例内；`cachePersist: 'session' | 'local'` 可把 GET 缓存写入 Web Storage，刷新后继续命中（仅 JSON、需自行避免敏感数据）；`local` 模式下 `invalidateCache` 通过 storage 事件通知其他标签页清空缓存。`throttleLeading`/`throttleTrailing` 可启用前沿、尾调用或仅尾调用（默认仍为前沿）；窗口内被丢弃的调用合并为窗口结束的一次执行。完整语义与验证见 [F2c](68-f2c-request.md)、[U12-1](117-u12-request-retry-polling.md)、[U12-2](119-u12-pagination.md)、[U12-3](121-u12-request-cache.md)、[U12-4](125-u12-cache-tags.md) 与 [U12-5](127-u12-debounce.md)、[U12-6](130-u12-throttle.md) 与 [U12-8](136-u12-trailing-throttle.md)、[U12-9](138-u12-cache-persistence.md)、[U12-10](139-u12-debounce-maxwait.md)、[U12-11](140-u12-debounce-edges.md)、[U12-12](141-u12-cross-tab-cache.md)。

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

当前消息来自内联配置或 `src/locales` 目录；支持 default/fallback、切换/持久化、ICU 复数/日期/数字、相对时间与富文本。UI 库语言资源用 `useLocaleResource` 选择：标签经 `normalizeLocaleTag` 归一化，`zh_CN` 与 `zh-CN` 等价，回退链覆盖语言；Antd locale 对象与 dayjs 加载函数由应用提供。返回的 `direction` 由 `localeDirection` 计算（ar/he/fa/ur 等 RTL，可用归一化覆盖），可直接传给 ConfigProvider 或根节点 `dir`。SSR 与按请求 locale 仍待后续。完整语义见 [F3a locale](69-f3a-locale.md)、[U16-1](120-u16-ui-locale.md) 与 [U16-2](124-u16-rtl.md)。

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

### 4.19 消息目录

语言文案多起来时，把消息表放进 `src/locales/<locale>.json`，并显式开启目录约定：

```ts
plugins: [{ id: 'locale', plugin: localePlugin, options: { id: 'application:locale', directory: 'src/locales' } }]
```

```jsonc
// src/locales/zh-CN.json
{ "title": "目录标题", "greeting": "你好 {name}" }
```

目录在 Node 侧读取并以内联 JSON 写进生成入口（浏览器不再发额外请求）；同一 locale 的重复 key 会直接失败，`src/app.tsx` 里的 `locale.messages` 逐 key 覆盖目录值。文件必须是扁平的 `key → string` 表，locale 由文件名决定。规则与上限见 [F4h 消息目录](81-f4h-locale-catalogs.md)。

示例：`pnpm cormi dev --root examples/locale-catalog`，默认监听 `/locale-catalog/`。

### 4.21 菜单折叠与目录化标题

外壳需要“收起侧栏”或按语言切换菜单文案时，用 `menuPlugin` 的折叠状态与 `meta.locale`：

```ts
plugins: [
  { id: 'locale', plugin: localePlugin, options: { id: 'app:locale', directory: 'src/locales' } },
  { id: 'menu', plugin: menuPlugin, options: { id: 'app:menu', collapse: { storageKey: 'app:menu:collapsed' } } },
]
```

```tsx
import { useMenuCollapse } from '@cormijs/runtime';
const { collapsed, toggle } = useMenuCollapse();
```

标题解析顺序是 `meta.locale`（消息目录命中）→ `meta.title` → `meta.name`；未命中的 key 不会被当成标题显示。折叠状态默认 `false`，可选 `defaultCollapsed`，并在 `storageKey` 存在时尽力持久化到 `localStorage`。这里没有 ProLayout/Antd 组件或布局插槽，外壳结构由应用自己实现。规则见 [F4i 菜单折叠与标题](82-f4i-menu-collapse.md)。

### 4.22 路由 client loader

页面需要的首屏数据可以在配置式路由里声明为浏览器 loader，渲染前完成取数：

```ts
plugins: [{ id: 'routes', plugin: routeConfigPlugin, options: { id: 'app:routes', routes: [
  { path: 'member/:id', component: './src/Member.tsx', clientLoader: 'clientLoader' },
] } }]
```

```tsx
import { useClientLoaderData } from '@cormijs/runtime';
export default function Member() {
  const data = useClientLoaderData<{ id: string }>();
  return <p data-id>{data.id}</p>;
}
export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  return { id: params.id ?? '-' };
}
```

`clientLoader` 是页面模块里的导出名；生成入口把同一模块同时用作组件与 loader 来源，声明交给 React Router 的数据路由执行，因此深链接、刷新和前进后退都会取数。约定式路由暂不识别该声明，loader 失败的边界呈现契约仍未交付，服务端 loader/SSR 注水与预取也不在本能力内。规则与限制见 [F5a 路由 client loader](83-f5a-client-loader.md)。

### 4.23 路由级页面头部

需要按页面切换标题与 SEO 元数据时，显式启用 `headPlugin`，并在路由 `meta.head` 里声明：

```ts
plugins: [
  { id: 'routes', plugin: routeConfigPlugin, options: { id: 'app:routes', routes } },
  { id: 'head', plugin: headPlugin, options: { id: 'app:head', titleTemplate: ' · cormi' } },
]
```

```ts
{ path: 'guide', component: './src/Guide.tsx', meta: { head: { title: '指南', metas: [{ name: 'description', content: '指南页' }], links: [{ rel: 'canonical', href: '/guide' }] } } }
```

标题取匹配链上最深的路由，`metas` 按 `name`/`property` 由深覆盖浅，`links` 按 `rel + href` 去重；受管标签带 `data-cormi-head`，每次导航替换而不会累积，作者写在 index.html 的标签不受影响，卸载时恢复进入前的标题。这是客户端同步，不改变构建产物的初始头部；SSR 头部属 U32。规则见 [F5c 路由级页面头部](84-f5c-route-head.md)。

示例：`pnpm cormi dev --root examples/route-head`，默认监听 `/route-head/`。

### 4.24 路由预取

页面按路由懒加载后，可用 `routePrefetchPlugin` 暴露的注册表提前加载目标模块：

```ts
plugins: [{ id: 'prefetch', plugin: routePrefetchPlugin, options: { id: 'app:prefetch', mode: 'idle' } }]
```

```tsx
const { ids, prefetch } = usePrefetch();
void prefetch('config:guide');
```

`ids` 是当前生成入口中的路由 id（含布局路由），`prefetch(id)` 返回布尔 Promise，未知 id 返回 `false`，并发调用复用同一在途 Promise；`mode: 'idle'` 会在首屏后通过 `requestIdleCallback` 预热全部路由（2 秒超时，卸载取消），路由较多时建议用手动模式。悬停或聚焦即预取的链接用 `usePrefetchOnIntent`：

```tsx
const intent = usePrefetchOnIntent('config:guide', { delayMs: 50 });
<Link to="/guide" {...intent}>指南</Link>
```

它只预取代码，不预取 `clientLoader` 的数据。规则与限制见 [F5d 路由预取](85-f5d-route-prefetch.md)。

示例：`pnpm cormi dev --root examples/prefetch`，默认监听 `/prefetch/`。

### 4.25 构建输出与静态文件

需要把 `public/` 之外的项目文件带进构建产物，或关闭文件名哈希时，显式启用 `outputPlugin`：

```ts
plugins: [{ id: 'output', plugin: outputPlugin, options: {
  hash: false,
  copy: [{ from: 'static', to: 'extras' }, { from: 'static/robots.txt' }],
} }]
```

复制发生在构建结束（`closeBundle`），目标缺省为源路径的文件名，`from` 必须在项目内且不能是 `node_modules`、`.cormi*`、`.env*` 或符号链接；`hash:false` 生成 `assets/[name].js` 这类稳定名称，若同时存在自定义命名策略会直接失败。开发服务器不执行复制（开发期需要的静态文件请放 `public/`），preview 会提供复制后的文件。规则与边界见 [F4j 构建输出策略](86-f4j-output-policy.md)。

示例：先 `pnpm cormi build --root examples/output`，再 `pnpm cormi preview --root examples/output`。

### 4.26 生成页面、组件与模型

启用 `generatorPlugin` 后可直接生成项目内文件：

```sh
cormi generate page about-us
cormi generate component profile-card
cormi generate model counter
```

默认拒绝覆盖已有文件；需要覆盖或只看计划时，把 flag 写在 `--` 之后（CLI 的全局选项保持严格）：

```sh
cormi generate page about-us -- --force
cormi generate page preview -- --dry-run
```

生成器只写文件，不会把页面注册进路由，也不会格式化内容；模型模板遵循 `src/models/<kebab>.ts` 的 Hook 模型约定。规则与边界见 [F4k 微生成器](87-f4k-generator.md)。

### 4.27 静态导出外壳

需要让静态托管和爬虫直接拿到每个页面的标题与 meta 时，加入 `staticExportPlugin`：

```ts
plugins: [
  { id: 'export', plugin: staticExportPlugin, options: { id: 'app:export', titleTemplate: ' · cormi' } },
  { id: 'head', plugin: headPlugin, options: { id: 'app:head', titleTemplate: ' · cormi' } },
]
```

开启 `notFound: true` 时用 catch-all 路由 head 生成 `dist/404.html`。构建后 `dist/index.html`、`dist/guide/index.html` 等各自带有该路由（含祖先）的 `meta.head`；动态段、catch-all 与 redirect 路由不会生成页面文件。它只是 HTML 外壳：页面内容仍需浏览器挂载，不是预渲染。`index.html` 必须声明 `<meta charset>`，否则非 ASCII 标题可能按错误编码返回。与 `headPlugin` 搭配可在客户端导航后继续同步标题。规则见 [F5e 静态导出](88-f5e-static-export.md)。

需要真正的预渲染时，改用 `ssrPlugin` 的 `prerender: true`：构建后用同一 SSR bundle 渲染字面路由，执行 clientLoader/serverLoader，写入首屏标记、hydration 与 head；`prerenderPaths: ['/users/1']` 枚举动态路径（对应 Umi `extraRoutePaths`），`sitemap: 'https://example.com'` 生成带 `app.base` 的 sitemap.xml；`sitemapChunkSize` 改为分片并生成 `sitemap-index.xml`。构建保留 `dist/.cormi/shell.html` 供 preview/serve 继续 SSR。loader 返回 Response 或状态 ≥400 的页面会跳过。不要与 `staticExportPlugin` 同时启用后写的壳导出。规则见 [U33-1 预渲染](114-u33-prerender-sitemap.md)。

示例：`pnpm cormi build --root examples/static-export`，再 `pnpm cormi preview --root examples/static-export`。

### 4.28 数字、日期与复数消息

`useIntl()` 直接绑定当前语言到平台 `Intl`：

```tsx
const { formatNumber, formatDate, tp } = useIntl();
formatNumber(1234.5);                       // en: 1,234.5；de: 1.234,5
formatDate(Date.now(), { dateStyle: 'medium' });
tp('items', 1);                             // items_one；缺失时 items_other，再回退 items
```

```jsonc
{ "items_one": "{count} item", "items_other": "{count} items" }
```

复数类别由 `Intl.PluralRules(locale)` 决定，`{count}` 自动插值；`tp` 会先在当前语言、再在 fallback 语言中查找。非法数字/日期与非法 count 会抛 `TypeError`（`LOCALE_INVALID`）。需要单条消息内组合复数、选择与格式化时，使用下一节的 ICU 子集；相对时间与富文本仍待后续。规则见 [F5f 格式化与复数](89-f5f-locale-formatting.md)。

### 4.29 页面访问分析

需要在每次路由变化时记录 page-view 时，显式启用 `analyticsPlugin`：

```ts
plugins: [{ id: 'analytics', plugin: analyticsPlugin, options: { id: 'app:analytics', measurementId: 'G-XXXXXXX', dispatch: true } }]
```

配置 `measurementId` 后，插件维护 GA4 的 `dataLayer`/`gtag` 队列并发送 `page_view`（`page_path` 含部署 base）；`dispatch: true` 还会发出 `cormi:pageview`，detail 为 `{ path, search, hash, title, referrer }`（`path` 不含 base）。GA 脚本仍由应用通过 `htmlPlugin` 的 `headScripts` 自行引入；首屏事件在 React 挂载前发出，宿主如需在 UI 中展示请在模块作用域监听。插件不处理 Cookie 同意。规则见 [F5h pageview 分析](90-f5h-analytics.md)。

### 4.30 运行项目的 lint 与 format

框架不内置 linter，用 `toolPlugin` 包装项目自己安装的二进制：

```ts
plugins: [{ id: 'tools', plugin: toolPlugin, options: { lint: { bin: 'eslint' }, format: { bin: 'prettier', args: ['--write'] } } }]
```

```sh
cormi lint -- --max-warnings 0
cormi format -- --check src
```

二进制从 `node_modules/.bin` 解析，使用 `spawn` 而不是 shell；stdout/stderr 转发到 CLI 的 stderr，非零退出以 `TOOL_FAILED` 失败，未安装则为 `TOOL_MISSING`。默认参数可配置（默认 `eslint .` 与 `prettier --write .`），没有内置文件发现或配置生成。规则见 [F5i 工程命令](91-f5i-tool-commands.md)。

### 4.31 约定式页面的 clientLoader

约定路由（`src/pages/**`）不需要配置：页面导出 `clientLoader` 即自动生效：

```tsx
// src/pages/member/[id].tsx
export default function Member() {
  const data = useClientLoaderData<{ id: string }>();
  return <p>{data.id}</p>;
}
export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  return { id: params.id ?? '-' };
}
```

检测使用零依赖的词法扫描（忽略注释与字符串），只识别 `export function/async function/const clientLoader`；注释、字符串、`declare` 与类型导出不会误判，重导出（`export { clientLoader } from …`）不被识别。配置式路由仍用 `clientLoader` 字段显式声明。规则与边界见 [F5j 约定式 loader](92-f5j-conventional-loader.md)。

### 4.32 locale key 类型

启用 `src/locales` 目录后，编译会生成环境类型，给语言代码与消息 key 提供编译期约束：

```ts
const key: CormiLocale.MessageKey = 'greeting';
const code: CormiLocale.Code = 'zh-CN';
// @ts-expect-error 未知 key 会失败
const typo: CormiLocale.MessageKey = 'missing';
```

文件位于 `.cormi/locale.d.ts`，无需 import（tsconfig 已包含 `.cormi/**/*`）；无目录时为 `never`。它只覆盖目录来源——`app.tsx` 内联消息不参与生成，`t()` 的参数仍是 `string`，不会自动拒绝动态 key。规则见 [F5k locale 类型](93-f5k-locale-types.md)。

### 4.33 ICU 消息子集

单条消息需要复数、性别选择与数字/日期格式化时，直接在消息目录中写 ICU 子集，`t` 传入值即可：

```jsonc
{
  "guests": "{count, plural, offset:1 =0 {no guests} =1 {just you} other {you and # others}}",
  "reply": "{gender, select, female {She replied} male {He replied} other {They replied}}",
  "total": "Total {amount, number} ({fee, number, percent} fee)"
}
```

```tsx
t('guests', { count: 3 });                          // you and 2 others
t('reply', { gender: 'female' });                   // She replied
t('total', { amount: 1234.5, fee: 0.25 });          // Total 1,234.5 (25% fee)
t('guests', { count: 0 });                          // no guests
```

支持 `{name}`、`{n, number|date|time[, integer|percent|short|medium|long|full]}`、`plural`/`selectordinal`/`select`（可嵌套、可带 `offset:N`）、`#` 计数占位与单引号字面量；`=N` 始终匹配原始值，`offset` 只影响复数类别与 `#`。未传值时 `t` 不解析消息、原样返回目录文本；传值后语法错误会抛 `LOCALE_INVALID`。也导出纯函数 `formatIcu(message, values, locale)`。富文本标签、货币/骨架格式与编译期消息校验仍未提供。规则见 [F5l ICU 子集](94-f5l-icu.md)。

### 4.34 相对时间

`useIntl().formatRelativeTime` 跟随当前语言输出相对时间，时间差由调用方计算：

```tsx
const { formatRelativeTime } = useIntl();
formatRelativeTime(-2, 'day');                       // en: 2 days ago；zh: 2天前
formatRelativeTime(-1, 'day', { numeric: 'auto' });  // en: yesterday；zh: 昨天
```

非 React 场景使用 `formatRelativeTimeFor(locale, value, unit, options?)`。`value` 必须有限，`unit` 限 `Intl.RelativeTimeFormatUnit` 的合法值；非法输入抛 `LOCALE_INVALID`。它只做格式化，不自动刷新、不读取当前时间。规则见 [F5m 相对时间](95-f5m-relative-time.md)。

### 4.35 生产 API 路由

需要开发期与预览期都能访问的 HTTP 接口时，显式启用 `apiRoutePlugin`：

```ts
plugins: [{ id: 'api', plugin: apiRoutePlugin }]
```

```ts
// src/api/users/[id].ts
import type { ApiHandlerContext } from '@cormijs/plugin-react-vite';
export default (request: Request, { params }: ApiHandlerContext) =>
  Response.json({ id: params.id });
```

`src/api/**` 的文件映射为 `/api/**`（`index.ts` 是目录本身，`[id].ts` 捕获一段）；处理器是标准 Fetch `Request`/`Response`，自行判断 method。`cormi dev` 直接运行源码，`cormi build` 把处理器打包进 `dist/.cormi/api`，`cormi preview` 从编译产物提供服务。请求/响应缓冲上限为 1 MiB/8 MiB，错误返回 JSON 码且不泄漏堆栈；新增/删除路由文件需重启开发服务。规则见 [F5n API 路由](96-f5n-api-routes.md)。

### 4.36 富文本消息

消息中需要强调或链接结构时，用成对标签并在渲染时显式提供渲染器：

```jsonc
{ "notice": "<b>Hello {name}</b>, you have {count, plural, one {# message} other {# messages}}" }
```

```tsx
const { rich } = useIntl();
rich('notice', { name: 'Ada', count: 2 }, { b: children => <strong>{children}</strong> });
// FormattedMessage 也可传 tags={{ b: children => <b>{children}</b> }}
```

`t()`/`tp()` 不解析标签，按普通文本返回；只有 `rich`/`FormattedMessage.tags` 会解析。标签可嵌套、内部可用 ICU 参数与 `#`，未列出/错配/未闭合标签抛 `LOCALE_INVALID`。不生成 HTML 字符串，标签渲染器由应用提供。规则见 [F5o 富文本消息](97-f5o-rich-text.md)。

### 4.37 视口预取

让链接在进入视口时预取其路由模块：

```tsx
const visible = usePrefetchOnVisible('config:guide', { rootMargin: '200px' });
<Link ref={visible} to="/guide">Guide</Link>
```

`rootMargin` 默认 `200px`、`threshold` 默认 0.01、`delayMs` 默认 0；首次相交后预取并断开观察，ref 变化/卸载释放。没有 `IntersectionObserver` 时为空操作；只预取模块，不预取 loader 数据。规则见 [F5p 视口预取](98-f5p-viewport-prefetch.md)。

### 4.38 多页应用

需要多个独立 HTML 页面时，启用 `mpaPlugin`：

```ts
plugins: [{ id: 'mpa', plugin: mpaPlugin }]
```

`src/pages/home/index.tsx` 生成 `/home.html`，可在同目录 `config.json` 配 `{ "title": "Home page", "mountElementId": "app", "layout": "src/HomeLayout.tsx" }`；`layout` 也可由插件选项全局指定，页面配置优先；插件 `template` 可指定项目内 HTML 模板，需包含 `{{mountElementId}}` 与 `{{entry}}`。`src/pages` 顶层目录即页面，`index` 保留给 SPA。每个页面是独立 React 根，layout 只包裹 children、不注入 SPA Provider；dev/build/preview 均可用，构建产物为 `dist/<name>.html`。新增/删除页面需重启开发服务。规则见 [F5q MPA](99-f5q-mpa.md)。

### 4.39 生成 API 与 Mock 文件

```sh
cormi generate api health
cormi generate mock health
```

第一条写 `src/api/health.ts`（Fetch 处理器骨架），由 [F5n API 路由](96-f5n-api-routes.md) 发现；第二条写 `mock/health.ts`（`GET /api/health` 示例），由 [F4b Mock](75-f4b-mock.md) 发现。生成器不注册路由或 Mock、不安装依赖；`--force` 覆盖、`--dry-run` 只预览。规则见 [F5r API/Mock 生成器](100-f5r-generators.md)。

### 4.40 开发与预览代理

把路径前缀转发到真实后端：

```ts
plugins: [{ id: 'proxy', plugin: proxyPlugin, options: { proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true } } } }]
```

1–32 个前缀；目标必须是 http(s) URL 且不能内嵌凭据；支持 `changeOrigin`/`secure`/`ws`。开发与预览都生效，构建产物不含代理，生产部署需网关。不支持 rewrite 函数与自定义 headers。规则见 [F5s 代理](101-f5s-proxy.md)。

### 4.41 路由 JSON-LD

在路由 `meta.head.jsonLd` 声明结构化数据，导航后自动同步到 `<head>`：

```ts
meta: { head: { title: 'Article', jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: 'cormi' } } }
```

对象或 ≤32 个对象、≤64 KiB 的 JSON 数据；最深路由整体替换祖先块，切换/卸载移除受管脚本。`staticExportPlugin` 会把同一数据写入静态页面；`<` 被转义为 `\u003c`。规则见 [F5t JSON-LD](102-f5t-json-ld.md)。

### 4.42 loader 返回类型

启用 client loader 后，编译生成 `.cormi/loaders.d.ts`（无需 import，tsconfig 已包含 `.cormi/**/*`）：

```ts
type MemberData = CormiLoaderData.Data<'config:member/:id'>;
const data = useClientLoaderData<MemberData>();
```

按路由 id 索引，类型来自 `Awaited<ReturnType<typeof import(module)[exportName]>>`；没有 loader 时为空接口。删除/改名 loader 导出会导致 typecheck 失败。规则见 [F5u loader 类型](103-f5u-loader-types.md)。

### 4.43 重导出 clientLoader

页面可以用值导出列表重导出 loader：

```ts
export { clientLoader } from './reused-loader';
// 或 export { load as clientLoader } from './loader';
```

静态 `export { … }`/`export { … } from` 被约定扫描识别；`export type`、`clientLoader as other`、`export *` 与运行时拼接不识别。目标绑定是否存在由打包与 typecheck 报告。规则见 [F5v 重导出 loader](104-f5v-reexport-loaders.md)。

### 4.44 自定义生成模板

```ts
plugins: [{ id: 'generator', plugin: generatorPlugin, options: { templates: { note: { path: 'src/notes/{{kebab}}.md', content: '# {{pascal}} ({{name}})\n' } } } }]
```

`cormi generate note Hello-World` 写 `src/notes/hello-world.md`。最多 16 个类型，不能同名内置类型；路径必须留在项目源码内（禁止 `node_modules`、`.git`、`.cormi`、`.env*`、`cormi.config.ts`），内容 ≤64 KiB。覆盖/试运行沿用原规则。规则见 [F5w 自定义生成模板](105-f5w-generator-templates.md)。

### 4.45 `<Helmet>` 组件

页面内可直接声明 head：

```tsx
import { Helmet } from '@cormijs/runtime';
<Helmet title="Home" metas={[{ name: 'description', content: 'D' }]} jsonLd={{ '@type': 'WebPage' }} />
```

需要启用 `headPlugin`。合并顺序为路由 `meta.head` → Helmet 挂载顺序：标题/JSON-LD 后者胜，meta 按 name/property、link 按 rel+href 替换；卸载/导航移除条目。使用对象 props，不支持 children 标签或 SSR 收集。规则见 [F5x Helmet](106-f5x-helmet.md)。

### 4.46 SSR（首个切片）

需要生产预览的服务端首屏时，同时设置应用选项并启用插件：

```ts
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'ssr', plugin: ssrPlugin, options: { id: 'application:ssr', mountId: 'root' } }],
  app: { ssr: true, server: { port: 0 } },
});
```

`cormi dev` 与 `cormi preview` 的 HTML 导航都由 static handler 渲染（clientLoader 在服务端执行）并注入 hydration 数据，客户端 hydrateRoot 接管；服务端同时输出路由 `meta.head`/`<Helmet>` 的 title/meta/link/JSON-LD 到 shell。`cormi build` 额外产出 `dist/.cormi/ssr/ssr.mjs` 供 preview/serve。serverLoader 仅在服务端执行并写入 hydration，客户端导航经 `<base>.cormi/server-loader` 取数；`streaming: true` 时 dev/preview/serve 使用 React 流式渲染，Suspense 边界继续流入，hydration 脚本放在挂载根之外。hydration 前只预解析当前匹配链，其他页面仍按需加载；`app.base` 前缀由服务端剥离并与客户端 basename 对齐。规则分别见 [U32-1](113-u32-server-loader.md) 与 [U32-2](115-u32-streaming.md)。

### 4.47 独立生产服务 `cormi serve`

启用 `servePlugin` 后可用 `cormi serve` 提供已构建产物：

```ts
plugins: [{ id: 'serve', plugin: servePlugin, options: { id: 'application:serve', port: 4173, base: '/' } }]
```

服务读取 `dist/index.html` 与 `dist/.cormi/ssr/ssr.mjs`：HTML 导航执行 SSR/hydration，其余请求按 dist 白名单提供静态文件；需先 `cormi build`。支持 `host`/`port`/`outDir`/`base`/`mountId` 选项；不执行 API 路由、Mock、代理，无压缩/流式/TLS。规则见 [F5z cormi serve](108-f5z-serve.md)。

### 4.48 菜单适配 Antd/ProLayout

```tsx
const items = toAntdMenuItems(useMenu());
<Menu items={items} onClick={({ key }) => navigate(key)} />
// 或 const route = { path: '/', routes: toLayoutRoutes(useMenu()) };
```

适配器不引入 antd/ProLayout；`key` 为 path、label 已本地化、routeId 保留路由 id。需要 Antd Provider 时安装 `antd` 并加入 `@cormijs/plugin-antd`（见 4.51），主题/图标/图表仍需应用自行组合。规则见 [U17 菜单适配器](109-ui-menu-adapters.md)。

### 4.49 CSS Modules 与资源类型

启用 `styleTypesPlugin` 后生成 `.cormi/styles.d.ts`，声明 `*.module.{css,scss,sass,less}`、纯 CSS 副作用导入与常见图片/字体资源；默认关闭以免与应用自有 `*.d.ts` 冲突。类名为字符串索引，不解析具体选择器，也不支持 `?url` 等后缀。规则见 [F4m 样式类型](110-f4m-style-types.md)。

### 4.50 locale 变更订阅

```tsx
useEffect(() => intl.subscribe(locale => dayjs.locale(locale)), [intl]);
// 或监听 window 的 cormi:localechange，detail 为 { locale, previous }
```

只在 `setLocale` 成功后通知，初始挂载不回调；框架不自动修改 dayjs/Antd 语言包。规则见 [U16 locale 订阅](111-u16-locale-subscription.md)。规则见 [F5y SSR](107-f5y-ssr.md)。

### 4.51 Antd Provider 集成

```ts
plugins: [
  { id: 'locale', plugin: localePlugin, options: { id: 'application:locale' } },
  { id: 'antd', plugin: antdPlugin, options: { id: 'application:antd', theme: { token: { colorPrimary: '#1677ff' }, dark: false } } },
],
```

安装 `antd` 后，`@cormijs/plugin-antd` 通过 runtime 贡献包裹 `ConfigProvider`：locale 由 cormi 的 UI locale 回退链选择包内 11 个官方 locale（含 `en`/`zh` 语言别名），direction 来自 `localeDirection`，主题 token 与 dark 算法由插件校验后传 JSON。localePlugin 必须先挂载。规则见 [U17-1 Antd](126-u17-antd.md)。

需要 ProLayout 外壳时，安装 `@ant-design/pro-layout`，挂载 `proLayoutPlugin`（Vite 预打包声明），并在 `src/layouts/index.tsx` 用 `ProLayoutShell` 包裹 `<Outlet/>`；菜单、折叠持久化与 SPA 导航来自 menuPlugin。ProLayout 7.22.7 仍声明 antd 4/5 peer，antd 6.6.7 组合已验证但严格 peer 安装需对该可选集成关闭校验；菜单图标通过 `meta.icon` + `icons` 注册表接入（任意图标库）；`ProLayoutShell` 的 `settingDrawer` + `useProLayoutSettings` 提供可持久化主题/布局编辑；图表按 Umi 的生态方式由应用安装 `@ant-design/plots` 等库，cormi 不提供图表插件。需要 React Query 时挂载可选 `reactQueryPlugin`；应用直接使用 `@tanstack/react-query`，插件只提供 QueryClientProvider 与受校验的默认项。规则见 [U17-2 ProLayout](134-u17-pro-layout.md) 与 [U17-3 菜单图标](135-u17-menu-icons.md)。

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
