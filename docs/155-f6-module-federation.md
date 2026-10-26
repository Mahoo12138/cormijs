# F6-7：Module Federation 与远端路由合并

日期：2026-10-26。本切片提供可选 `@cormijs/plugin-federation`：基于 `@module-federation/vite` 生成与消费 `remoteEntry.js`，默认共享 React/React DOM/React Router/`@cormijs/runtime`；远程 cormi 应用可暴露 `./routes`，宿主在创建 React Router 之前加载并合并远端路由树，因此菜单、深链和远端 clientLoader 都按本地路由工作。参考了 hzero `@hzerojs/plugin-micro` 的“共享依赖 + 暴露 getRouterData + 宿主合并路由”思路，但不复用其 webpack、`microConfig.json` 或 Umi 路由数据格式。

## 1. 使用方式

远程应用：

```ts
import { federationPlugin } from '@cormijs/plugin-federation';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'federation', plugin: federationPlugin, options: { name: 'CormiRemote', exposeRoutes: true } }],
});
```

宿主应用：

```ts
import { federationPlugin } from '@cormijs/plugin-federation';
export default defineConfig({
  presets: [preset],
  plugins: [{
    id: 'federation',
    plugin: federationPlugin,
    options: {
      name: 'CormiHost',
      remotes: [{ name: 'CormiRemote', entry: 'https://cdn.example.com/remoteEntry.js', prefix: '/remote' }],
    },
  }],
});
```

`remotes[].name` 必须与远程的 federation `name` 一致。`entry` 接受绝对 `http(s)` URL 或根相对路径；跨域部署必须由远程资源服务器返回 CORS 头（Vite dev server 默认允许）。`prefix` 可选，未设置时远端路由使用自身路径，可能与宿主冲突并启动失败。

## 2. 契约与语义

- `federationPlugin` 通过 `ctx.vite.add` 安装 `@module-federation/vite`，输出固定文件名 `remoteEntry.js`；`exposes` 可继续暴露任意组件。共享依赖默认 `react`、`react-dom`、`react-router`、`@cormijs/runtime`，全部以 `singleton` 方式共享；可通过 `shared` 覆盖。
- `exposeRoutes: true` 时生成临时 `.cormi/federation-routes.ts` 并暴露为 `./routes`。模块导出 `getRoutes()`：先设置 `__CORMI_MICRO_APP__`，再动态导入 ``.cormi/app`` 并返回 `cormiApplication.routes`，最后恢复标记。远端单独运行时仍由 `index.html` 正常自动挂载；宿主导入路由模块不会触发第二份应用。
- 宿主生成的应用包含一个 `federationRuntime` 运行时插件。它调用 Module Federation runtime 的 `init`/`loadRemote` 加载每个远程的 `./routes`，并在 `mountApplication` 新增的客户端 `RuntimePlugin.routes` 钩子中合并路由。该钩子位于 `appConfig.patchClientRoutes` 之前、router 创建之前；钩子返回非 `undefined` 会报错并清理挂载。
- 远端路由是 React Router `RouteObject[]`，因此 `handle.cormi.meta`、`lazy`、`Component`、`clientLoader`、error boundary 等字段原样保留。合并时：
  - 所有路由 id 加 `<remote>:` 前缀，避免和宿主 `file:`/配置 id 冲突；
  - 设置 `prefix` 时在远端树外增加一个 pathless chrome 路由（`<remote>:federation-root`，`path` 为前缀），远端顶层绝对路径会去掉前导 `/` 后挂到该前缀下；远端嵌套绝对路径在前缀模式下会被拒绝；
  - 按完整路径字符串检测与宿主或先前 remote 的精确冲突，冲突时抛出 `FEDERATION_ROUTE_CONFLICT`，不静默用路由排序覆盖；
  - 远端根 index 在未设置前缀且宿主已有根 index 时同样视为冲突；
  - 限制单 remote 2048 个节点、64 层，防止恶意/损坏远端撑爆路由。
- 每个 remote 默认 `required: true`：加载超时（默认 15000ms，可配 `routeTimeout`）、入口 404、CORS 失败或路由格式错误都会使宿主启动失败。设为 `required: false` 时记录 `console.error` 并跳过该 remote，宿主继续启动。
- 菜单不读取单独的远端清单：`menuPlugin` 的 `MenuProvider` 接收的是合并后的路由树，因此远端 `meta.title`/`meta.order`/access 会自然出现在宿主菜单，点击使用宿主 `Link` 做客户端导航。深链在首次挂载时也会先合并远端路由再创建 router。

## 3. 边界

- 仅客户端路由合并。SSR 的 `renderServerApplication` 不执行 `RuntimePlugin.routes`，因此远端路由在服务端 HTML 中不存在；在 `app.ssr: true` 的宿主上直接访问远端路径会发生服务端 404 与客户端路由不一致。此切片未提供 SSR 远端加载。
- remotes 在构建期写入生成入口，修改远端地址需要重新构建宿主；没有 hzero `microConfig.json` 式的运行时清单、按路径懒加载清单或远程版本元数据接口。
- 只共享显式配置的模块，不做依赖自动探测、版本兼容范围协商、CSS 隔离、qiankun 式 JS 沙箱或应用间 global state。
- 远端必须是 cormi 应用并使用 `exposeRoutes`，或由自定义 expose 导出 `getRoutes()` / 默认路由数组；不兼容 hzero `getRouterData` 的 `{type,routes}` 结构，也不解析 Umi 路由数据。
- 不提供 `registerMicroApps`/activeRule 或菜单注册表；Qiankun 场景仍使用 F6-4–F6-6。远端 CSS/资源的 `publicPath`、CDN 路径与 CORS 是部署责任，本切片未暴露 `publicPath` 配置。
- 未单独断言 `@cormijs/runtime` 的模块身份；验证断言 React hooks 与 React Router context（`useLoaderData`）在宿主/远端同源。仅验证 Edge 156，未跑 Firefox/Safari 矩阵。

## 4. 验证

验证环境：`@module-federation/vite@1.23.5`、`@module-federation/runtime@2.9.2`、Vite 7.3.2、React 19.3.1、Playwright 1.58.2、Edge 156.0.4314.42、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/federation.test.ts` | 6 项：前缀包装/id 命名、绝对路径、冲突、畸形路由、前缀校验、runtime 选项 |
| `tests/browser/federation.test.ts` | 独立 remote/host：dev、typecheck、remote build、host build、preview；共享 React hooks、远端 clientLoader、菜单导航、深链 |
| 安装包 federation consumer | remote/host 各自安装（首次在线预热后离线复跑）、typecheck、公共类型、remote build、host dev/build/preview 浏览器验收 |
| `pnpm check` | 579/579 |
| `pnpm test:browser` | 62/62；最终代码变更后 targeted 复跑 1/1 |
| `pnpm test:package` | 87 阶段（`CORMI_PACKAGE_ONLY=federation`，暖缓存离线安装；全量未重跑） |

完整计数、日志哈希与源码集合见 [机器证据](../artifacts/f6-module-federation-validation.json)。

## 5. 下一步

- F6 剩余：qiankun `registerMicroApps`/activeRule/菜单集成、多 builder/MFSU、dva 自动发现/immer/loading；
- 联邦后续：运行时 remote 清单、SSR 远端路由、CSS/样式隔离、版本兼容提示与多 remote 菜单排序验证；
- U33 按语言拆分、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
