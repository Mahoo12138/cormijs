# cormi F1a：src/app.tsx 应用运行时约定

日期：2026-10-20。基于路线提交 `a802e4b`（P16 之后）。本切片交付 Umi `src/app.tsx` 运行时入口的第一部分：应用配置模块识别、导出协议、`render`/`rootContainer`/`patchClientRoutes`/`onRouteChange` 接入，以及供后续插件登记额外 key 的原生扩展点。F1a 时未交付的路由配置易用性、redirect/wrappers/layout、history 选择和 F2 的 model/request，已分别由 [F1b](61-f1b-config-routes.md)、[F1c](62-f1c-redirects-and-wrappers.md) 或后续批次承担。

## 1. 本切片可用的能力

应用在配置中显式加入 `appRuntimePlugin` 后，可以在 `src/app.tsx` 使用 `defineApp` 配置：

| key | 作用 |
| --- | --- |
| `setup(context)` | 首个渲染前的同步/异步初始化，可返回清理函数；取消或后续失败时逆序清理 |
| `render(next, context)` | 异步初始化并按需延迟首屏；调用 `next()` 前不创建 Router 或 React root |
| `patchClientRoutes({ routes })` | 在创建 Router 前修改路由树；必须原地修改并返回 void |
| `rootContainer(container, context)` | 包裹最终应用树，每次挂载执行一次 |
| `onRouteChange(event)` | 首次及后续导航的完整事件：`location`、`action`、`basename`、`isFirst`、`routes`、`clientRoutes` |

`context` 提供 `signal` 和 `basename`。命名导出与单个默认导出都受支持；默认导出可以是同步工厂。未知 key、命名与默认配置混用、异步默认工厂、错误的 hook 类型都会在浏览器启动时明确失败，而不是静默丢弃。

Umi 的运行时配置文档和固定源码：

- [Umi 运行时配置](https://umijs.org/docs/api/runtime-config/)：`render`、`rootContainer`、`patchClientRoutes`、`onRouteChange` 是应用侧共同入口。
- `references/umi`（HEAD `2d368e378d10831e7a56b6eaa6e2ae705b1f3c78`，`packages/umi/package.json` 4.7.25）中的 `packages/renderer-react/src/browser.tsx`：`patchClientRoutes` 先于 `rootContainer` 组合；`BrowserRoutes` 先发出 `isFirst: true` 的首个 `onRouteChange`，再通过 `history.listen` 持续通知；`location` 是原始 history location。
- `packages/preset-umi/templates/umi.tpl`：`render` 以 compose 方式套在 `renderClient` 外，回调形式为 `oldRender`；应用入口由生成文件静态接入，不在 Node 配置阶段执行 app 模块。

## 2. 时序与错误语义

一次成功挂载的顺序固定为：

1. runtime 插件的 `setup`（按声明顺序）；
2. `app.setup`；
3. `app.render`；调用 `next()` 后才继续；
4. `patchClientRoutes`；
5. 创建 Router，构造基于已打补丁树的最终路由（追加运行时 404）；
6. `rootContainer`；
7. 创建 React root 并挂载；
8. 首个 `onRouteChange`，`isFirst: true`。

`next` 是只允许调用一次的 Promise 函数：重复调用、启动取消后迟到的调用都会抛 `APP_RENDER_NEXT_INVALID`。`render` 可以 `await next()`、`return next()` 或先 await 自身初始化再调用；返回非 `undefined` 值会被拒绝。未调用 `next` 时挂载会等待，直到启动被取消。`rootContainer` 不是 React 组件，不能直接使用 Hooks；需要 Context 时返回 Provider 组件。它不会在每次导航时重新执行。

启动失败、渲染前初始化失败或取消时，已执行的 `setup` 清理函数会逆序执行；已经进入的 `next` 渲染会先稳定完成再释放资源。`onRouteChange` 的同步/异步异常只记录到控制台，不阻塞导航。

## 3. 路由事件

`RouteChangeEvent` 同时提供两份路由视图：

- `routes`：传入 `mountApplication` 的原始路由树，`patchClientRoutes` 之前的独立副本；
- `clientRoutes`：实际创建 Router 时使用的树，包含运行时补丁，不包含内部追加的 404。

`location` 是原始 history location，`pathname` 包含部署 basename（与 Umi 的 history 一致）；`basename` 单独提供，便于应用自行裁剪。首次事件为 `POP`、`isFirst: true`，随后是 React Router 的 `PUSH`/`POP`/`REPLACE`。事件对象和 location 被冻结，路由数组是副本；修改事件数组的结构不会替换已创建的 Router，但其中的路由对象与挂载树共享引用，不应在事件中改写。

测试覆盖了 `pathname`、`search`、`hash`、`action`、`isFirst`、`basename`，以及原路由树不含新增路由、`clientRoutes` 含新增路由。

## 4. 文件约定与低层入口

`appRuntimePlugin` 是独立原生 Cordis 插件，默认候选为 `src/app.ts`、`src/app.tsx`、`src/app.js`、`src/app.jsx`，也可通过 `files` 改写。它：

- 默认 preset 不自动启用，避免把既有应用的普通 React 组件静默当作配置；在 `cormi.config.ts` 显式加入一次，`enabled: false` 即可撤回；
- 只接受一个存在的候选；多个候选、符号链接、目录或项目外路径会明确失败；
- 只在生成入口中静态 `import` 应用模块，Node 配置/扫描/生成阶段不会执行它；
- 继续使用现有客户端边界检查：Node SDK、`cormi.config`、`.server.*`、受管生成目录等不能被应用模块引用。

需要更低层控制时可关闭约定插件，使用 `app.runtimeConfig: { specifier, exportName }`，或继续使用既有 `app.runtime` 模块清单。显式入口与约定候选同时存在会被判为冲突，不按顺序猜选，即使指向同一文件也不例外。

## 5. 后续插件的扩展点

Node 侧插件通过 `ctx.react.appConfig.tap()` 登记额外运行时 key；登记绑定插件作用域，卸载后撤回。生成器把当前启用的 key 列表写入 `resolveAppConfig` 调用。应用侧通过 module augmentation 声明类型：

```ts
declare module '@cormijs/runtime' {
  interface RuntimeConfig {
    request?: { timeout?: number };
  }
}
```

浏览器侧 `RuntimePlugin.Provider` 和 `RuntimePlugin.setup` 现在都能读取冻结的 `appConfig`，未来 model/request/access/layout 插件可在自己的 Provider/初始化中消费这些 key。这里只登记 key 和传递配置对象，不包含 request/access 等行为的预置白名单；它们仍属于 F2/F3。若插件已停用而应用仍使用其 key，浏览器启动会以未知 key 失败，需要同时移除应用配置或恢复插件。

## 6. 与 Umi 的差异

| 方面 | Umi | cormi F1a |
| --- | --- | --- |
| 文件发现 | `src/app.tsx` 默认参与运行时 | 独立插件显式启用；默认 preset 不接管 |
| render 回调 | `render(oldRender)`，通常 `return oldRender()` | `render(next)`，`next` 返回 Promise，可直接 await/return；只允许一次 |
| 路由补丁 | `patchRoutes` 与 `patchClientRoutes` 两个入口 | 仅 `patchClientRoutes`，输入已经是 React Router `RouteObject[]` |
| 路由事件 | 通过 history location 通知 | 同等事件并显式提供原树/最终树；location 同样包含 basename |
| 额外 key | PluginAPI/运行时插件组合 | 原生 `ctx.react.appConfig.tap()`，按插件作用域撤回 |
| 初始化 | 主要依靠 `render` 或插件组合 | 补充 `setup`，可返回清理函数并被启动失败/取消排空 |
| history | browser/hash/memory 可配置 | 本切片仍只有 browser history |
| 兼容性 | Umi 运行时插件生态 | 不承诺 Umi 插件二进制/PluginAPI 兼容 |

`rootContainer` 每次挂载只执行一次并位于最外层；runtime 插件 Provider 按数组从外到内组成其内侧的层级，再包裹 Router。需要访问应用级配置的插件用 Provider 读取 `appConfig`，不要依赖 `rootContainer` 内的 Hooks。

## 7. 实施中暴露的缺陷

1. **基路径下的通配路由空白页。** 首轮浏览器运行时测试以 `routes: [{ path: '*' }]` 和 `basename: '/runtime/'` 挂载，React Router 不会用 `path:'/'` 根路由下的 `*` 子路由匹配 `/runtime/` 本身，结果根路由被当作无元素的叶子，页面空白并产生警告。已复现为 `Mount did not paint`，修复为无路径布局根路由；加载回退和错误边界保持不变。
2. **事件 location 的前缀语义。** 加强断言后曾按应用相对路径预期 `location.pathname`，实际原始 history location 包含 `/runtime/`。核对 Umi 的 history 模板后保留实现，修正测试并写入文档。
3. **原树与补丁树曾被当成同一数组。** 事件最初同时传入补丁后的树；现在分别持有 `routes`（原始副本）和 `clientRoutes`（最终树），测试断言补丁只出现在后者。

## 8. 验证

最终验证在 macOS arm64、Node 22.14.0、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行，实现自 11:34 后不再修改。文档写入后又在同一冻结源码上复跑整套 Node/浏览器检查，目录为 `.cache/f1a-final-20261020-114817`：`check.log` 439/439、103 秒，`browser.log` 22/22、225 秒；随后重新执行示例 prepare 与 `tsc -p`，均退出 0。

| 检查 | 结果 |
| --- | --- |
| F1a 运行时/约定/生成单元测试 | 13/13 |
| 真实 `src/app.tsx` 类型检查（含未知 key、混合导出、exclude 绕过、修复） | 3/3 |
| F1a 浏览器用例（异步首屏、根容器、动态路由、完整事件、停用与显式替换、失败/取消清理） | 3/3 |
| `pnpm check`（框架/测试类型与 Node 回归） | 439/439，0 失败/取消/跳过（P16 为 423，新增 16 项） |
| `pnpm test:browser` | 22/22，0 失败/取消/跳过（P16 为 19，新增 3 项） |
| `pnpm test:package` | 109 阶段满足预期（P16 为 99，新增 10 个 app-runtime 阶段） |
| `examples/app-runtime` prepare + `tsc -p` | 退出 0；生成摘要记录 `appRuntime.owner = cormi:app-runtime` |

独立打包消费实际完成了：tgz 独立安装、`app-runtime-typecheck`、公开类型（`defineApp`/`resolveAppConfig`/`AppConfigContribution`）、未知导出预期失败、修复后类型检查、dev 会话、生产构建、preview 会话。修改 `src/app.tsx` 为未构建内容后再运行 preview，页面仍显示构建时内容，且 `.cormi/app.tsx` 字节未变化；浏览器事件仍为 `POP`/`PUSH`/`POP`/`REPLACE`。

最终 Node/浏览器复跑目录为 `.cache/f1a-final-20261020-114817`；独立打包结果为 `.cache/package-test-1792467683496/result.json`，同目录的 `app-runtime-preview.png` 为实际生产预览截图。浏览器用例的开发/生产截图写入 `.cache/f1a-runtime-dev.png` 与 `.cache/f1a-runtime-preview.png`。源码/文档哈希与测试计数见 [机器证据](../artifacts/f1a-validation.json)。这些是本次本机证据，不是公共发布或跨平台承诺。

## 9. 下一步

- F1 剩余：history 选择与公共导航/查询入口。配置式嵌套路由、redirect/wrappers、全局布局/`layout:false` 与 404/loading 约定已分别在 [F1b](61-f1b-config-routes.md)、[F1c](62-f1c-redirects-and-wrappers.md)、[F1d](63-f1d-global-layout.md) 和 [F1e](64-f1e-404-and-loading.md) 交付。
- F2：在本入口上登记 model/initial-state/request 的运行时 key 和 Provider，验证初始化用户、共享模型、请求与权限的联动。
- 不把本切片扩展成浏览器 Cordis 宿主或 bootstrap 重构；应用配置仍只在浏览器求值，Node 插件继续拥有扫描、校验和生成。
