# cormi F5y：SSR 首屏服务端渲染（首个切片）

日期：2026-10-21。本切片交付 U32 的第一条可用路径：应用设置 `app.ssr: true` 并启用 `ssrPlugin` 后，开发服务器与 `cormi preview` 对 HTML 导航请求执行服务端渲染、注入 React Router hydration 数据，客户端 `hydrateRoot` 接管；`cormi build` 额外产出一个服务端 bundle 供 preview 使用。这不是完整 SSR 平台。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { ssrPlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'ssr', plugin: ssrPlugin, options: { id: 'application:ssr', mountId: 'root' } }],
  app: { ssr: true, server: { port: 0 } },
});
```

```sh
cormi build
cormi preview
```

- 开发与预览的 HTML 导航都返回服务端渲染的首屏与 `window.__staticRouterHydrationData`；
- 构建额外输出 `dist/.cormi/ssr/ssr.mjs`；
- 页面模块与 `clientLoader` 在服务端运行，客户端根据 hydration data 恢复；`app.ssr: true` 时路由组件改为 eager 导入（首屏一致性优先于按路由拆包）。

## 2. 契约与语义

- 生成：`generateApplication` 导出 `cormiApplication`（routes/plugins/models/appConfig/base/strict/history 等），客户端入口仅在 `typeof document !== 'undefined'` 时挂载；服务端入口导入该描述；
- 服务端渲染：`@cormijs/runtime/server` 的 `renderServerApplication` 用 React Router `createStaticHandler` 查询请求（执行 loader），`StaticRouterProvider` + `renderToString` 输出标记；`patchClientRoutes` 与 `rootContainer` 生效；`appConfig.setup`/`render`/`onRouteChange` 属客户端生命周期，不在服务端执行；
- head：渲染后收集匹配链的 `meta.head` 与页面 `<Helmet>` 条目，合并/应用 titleTemplate，把 title、meta、link、JSON-LD 作为受管标签写入 shell；客户端 hydration 后接管同一批受管节点；
- 组件：`app.ssr: true` 时页面与布局组件直接导入，不使用 `lazy()`；`app.ssr` 为 false 时保持按路由懒加载（本切片要求 true 才能稳定 hydration）；
- 开发：`configureServer` 生成临时 `.cormi/ssr.tsx`，通过 Vite `ssrLoadModule` 按请求渲染；shell 走 `transformIndexHtml`，保留 HMR/React Refresh 注入；
- 构建：`ssrPlugin` 在客户端构建后写临时 `.cormi/ssr.tsx`，用同一 `define`/`resolve.alias` 与 React 插件做 Vite SSR 构建，输出到 `dist/.cormi/ssr`，随后删除临时入口；
- 预览：中间件只接管 `Accept: text/html` 的 GET/HEAD 导航；把服务端标记注入空挂载点，把 hydration script 放在挂载点之外；资产、API 与 `/.cormi/*` 不接管；SSR 失败时记录错误并回退 CSR 外壳；
- 客户端：`mountApplication` 新增 `hydrate` 选项；生成入口在挂载点已有子节点时使用 `hydrateRoot`，React Router 自动读取 `__staticRouterHydrationData`；
- 限制：`ssrPlugin` 非法选项以 `SSR_INVALID` 失败，服务端 bundle 失败以 `SSR_BUILD_FAILED` 失败；`app.base` 前缀在服务端匹配前剥离，并由 static context 的 `basename` 与客户端 router 对齐。

## 3. 与 Umi 4 的差异

Umi SSR 在 dev 与生产服务中执行服务端渲染，支持 serverLoader/流式渲染与独立服务入口；cormi 首个切片只在 preview 中 SSR，客户端 loader 在服务端执行，路由拆包被禁用。

| 方面 | Umi 4 | cormi F5y |
| --- | --- | --- |
| dev SSR | 支持 | 支持（Vite SSR 模块图） |
| 生产运行 | Umi 服务 | `cormi preview` 中间件 |
| loader | serverLoader/clientLoader | clientLoader 在服务端执行 |
| 代码分割 | 保留 | `app.ssr` 下 eager |
| 流式/独立服务 | 支持 | 未提供 |
| base | 支持 | 支持（测试 `/ssr/`） |

## 4. 限制

- 只验证了 macOS/Node 22 与 `/`、`/ssr/` base；
- dev 与 preview 中间件只处理 HTML 导航；SSR 错误回退 CSR，不承诺错误页语义；
- 页面/Provider 若依赖 `window`、localStorage 或浏览器插件，服务端渲染可能失败或 hydration 不一致；
- 服务端 bundle 使用 Vite SSR 构建，CSS 资源不进入服务端产物；
- 没有流式渲染、serverLoader 或 SSR 数据预取；
- `app.ssr` 下所有页面进入首屏 bundle，失去按路由拆包；
- 开发与预览的 API/代理/MPA 中间件与 SSR 的接管顺序由插件注册顺序决定。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts`（静态渲染/loader/redirect、服务端 head、插件装卸与非法选项） | 2/2 |
| `tests/browser/ssr.test.ts`（dev/preview/serve 的服务端标记与 head、loader 数据、hydration 无 pageerror） | 1/1 |
| `pnpm check` | 544/544，0 失败/取消/跳过（F5x 为 542，新增 2 项） |
| `pnpm test:browser` | 52/52，0 失败/取消/跳过（F5x 为 51，新增 SSR 用例） |
| `pnpm test:package` | 328 阶段通过（完整套件；`ssr` consumer 覆盖安装、typecheck、公共类型、build、hydrated preview 与 serve） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5y-validation.json)；head 收集增量见 [SSR head 证据](../artifacts/f5y-ssr-head-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U32 后续：serverLoader、流式渲染与按路由拆包；
- U25 runtimePublicPath（Vite chunk 限制）、U16 Antd/dayjs、U17 UI adapter、F6 多 builder/微前端。
