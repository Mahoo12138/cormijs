# cormi 路由、生成与 React 协议

日期：2026-10-16。阶段：P1b，实验性本地实现；不表示已发布 npm 或整个 MVP 完成。框架名 cormi，包解析名使用 cormijs/@cormijs。

## 1. 插件边界

`@cormijs/routes` 提供路由 IR、约定扫描与验证；不运行页面源码，也不依赖 React/Vite。`@cormijs/plugin-react` 通过 Cordis 提供 `application` 编译能力和 `react` 贡献入口，不 import Vite。`@cormijs/runtime` 只包含浏览器代码，依赖 React/React Router，不 import Cordis、Node 或构建器。

`@cormijs/plugin-react-vite` 才集成原生 React Vite 插件、依赖去重、开发依赖预构建与客户端 Node SDK 导入检查。`@cormijs/preset-react-vite` 是显式组合：Web consumer、应用命令、React compiler、Vite provider、React-Vite bridge。core 的职责未扩大为 React 或 Vite 宿主。

应用命令插件依赖 commands/web/application。生成结束后才调用 builder；命令卸载会取消工作、撤销更新订阅并关闭自己的编译和服务器会话，不要求移除所有 provider。没有后端时可以单独调用 React compiler 做 prepare；默认应用命令组合仍需要 Web/builder。

## 2. 最小应用

```ts
import { defineConfig } from 'cormijs';
import reactVite from '@cormijs/preset-react-vite';

export default defineConfig({
  presets: [reactVite],
  app: {
    base: '/',
    outDir: 'dist',
    server: { host: '127.0.0.1', port: 8001 },
  },
});
```

当前 preset 导出的是 `definePreset` 对象，不是需要调用的工厂。应用 `index.html` 保留用户所有权，包含挂载点与 `<script type="module" src="/.cormi/app.tsx"></script>`。默认 mountId 为 root；app.mountId 可覆盖。框架不自动改写用户 HTML。

```sh
pnpm build
pnpm cormi prepare --root examples/basic
pnpm cormi dev --root examples/basic
```

prepare 生成入口并返回路由摘要后退出；dev 生成入口并启动开发服务。停止 dev 后才能 build/preview，因为同项目 CLI 会话仍使用独占锁。preview 读取已有产物，不重新扫描页面或生成代码。

## 3. 路由约定与中间表示

默认扫描 src/pages 的 .tsx/.jsx；index 是当前目录首页，`[id]` 是参数，`[...rest]` 是终端 catch-all，`_layout` 是所在目录及其后代的布局，组件内部通过 Outlet 渲染后代。点目录、下划线辅助目录和 test/spec 文件忽略。页面树中的符号链接拒绝扫描。所有扫描只读路径，不 import 页面模块。F1e 起，根级 `404.tsx`/`.jsx` 映射为终端 `*`；嵌套目录的同名文件仍是普通页面。

基础 IR 字段为 id、parentId、path、index、module、source；P4a 增加公开 JSON meta，F1c 增加可选 redirect/keepQuery，F1d 增加可选 layout:false。module 的 specifier/exportName 可附带显式作者 file URL from；source 记录 file/pluginId。路径相对于父路由，顶层 / 规范化为空路径。默认 ID 是 `file:<项目相对文件名>`，不取数组下标。不开放任意运行时路由函数，增量规则见 [功能插件协议](21-react-features.md)。

设置 app.routes 后关闭约定扫描；其值必须是平面的 IR 数组。所有来源最终统一校验：重复 ID、缺失 parent、父子环、index 携带 path/children、非终端 splat、重复参数及 URL 结构歧义会失败。`users.tsx` 与 `users/index.tsx`、`[id]` 与 `[slug]`、仅大小写不同的页面不会靠扫描顺序覆盖。静态路由与参数路由可以共存，实际匹配交给 React Router。

F1b 起，`@cormijs/plugin-react` 的 `routeConfigPlugin` 接受嵌套 `ConfigRoute[]`（`path`/`component`/`index`/`errorBoundary`/`redirect`/`keepQuery`/`wrappers`/`layout`/`meta`/`routes`）。展开由 `@cormijs/routes` 的 `expandRouteConfig` 完成，输出并通过校验的仍是上述扁平 IR；组件和错误边界是项目相对源文件，自动 ID 由路径派生。插件仍是普通 `ctx.react.routes.tap()` 贡献，卸载即撤回。配置声明是追加贡献，不是第二个路由系统；需要 Umi 式显式路由时设置 `app.routes: []` 关闭约定扫描。字段规则、路径语义和 Umi 差异见 [F1b 配置式嵌套路由](61-f1b-config-routes.md)、[F1c redirect 与 wrappers](62-f1c-redirects-and-wrappers.md)、[F1d 全局布局](63-f1d-global-layout.md) 与 [F1e 404 与 loading](64-f1e-404-and-loading.md)。

app.pages 可选择其他项目内目录。当前不支持可选参数、路由组、并行路由、MDX 或 Umi 全量约定；超过扫描/深度限制明确报错。

本节保留 P1b 的基础协议；P1c 新增的类型、生成清单与检查命令见 [增量协议](10-publication-and-tools.md)。

## 4. 贡献与生成

Node 插件可注入 react，通过 `ctx.react.routes.tap()` 登记路由 reducer，通过 `ctx.react.runtime.tap()` 收集运行时模块。登记返回注销函数，调用者用 ctx.effect 绑定作用域。OrderedHooks 的 before/after、稳定 ownerOrder 和冲突诊断继续适用。不同编译轮次观察登记 revision，当前轮不修改正在遍历的登记快照。

app.runtime 支持 `{ id, module: { specifier, exportName }, options }` 数组。options 必须是可复制的有限、无环 JSON，不能传递 Context、服务实例、函数或整个 Node 配置。未带 from 的相对模块仍相对项目根；包模块使用裸包 specifier。P4a 可通过 clientModule 为 ./ 客户端引用显式绑定作者位置，限制在作者目录子树内，并接入缺失文件修复观察。详见 [功能插件协议](21-react-features.md)。

生成的 `.cormi/app.tsx` 包含静态 runtime imports、路由 lazy imports 和 mountApplication 调用。字符串使用 JSON 转义，页面源码不嵌入生成文件。提交前使用独立 esbuild 检查生成代码语法；这不是对业务页面执行完整类型检查。

## 5. 提交与开发更新

P1b 的 AtomicEntry 管理 `.cormi/app.tsx`；P1c 扩展固定白名单 routes.d.ts/inspect.jsonc，仍保持每个目标单文件提交。已有目标必须是普通文件且含 cormi 生成标识；不会覆盖未知文件或沿符号链接写入。新内容写入同目录独占临时文件、sync/close 后，在不含 await 的临界区验证目录身份、目标旧值和 revision，再 rename。内容不变时不改 mtime。正常失败清理自己的临时文件。

这是单个入口的原子可见性，不是多文件事务、断电持久性保证或整个应用源码回滚。CLI 跨进程锁防止正常并发写入；直接使用低层 compiler 的调用方应自行确保同项目只有一个写入者。不能将同用户恶意修改文件系统视为这里提供的安全沙箱。

RevisionQueue 单消费者执行，仅保留最新等待任务；新 revision 会协作取消旧任务。即使旧计算不响应取消，旧结果也不能通过提交检查。生成错误保留之前成功的入口，但用户已经修改/删除的业务模块仍可能报错，不宣称全应用自动恢复旧状态。

组件内容和 CSS 交给 Vite/React Fast Refresh；页面集合、已知模块元数据、贡献 revision 变化按 150ms 间隔观察。结构变化不保证保留页面局部状态；Node 配置更新继续走已有 worker 重启。P2a 起，开发态首次可修复路由/模块错误也可启动诊断会话，修复后生成有效入口；后续结构冲突保留既有生成物，清除冲突且内容不变时仅清除面板，不额外刷新。具体错误分类及一次性命令的严格失败语义见 [开发恢复](12-development-recovery.md)。

**生成文件已提交不等于开发服务器转换缓存已更新。** PreparedApplication 的 updates 订阅将已提交文件通知 Web 命令；开发 ServerHandle 的可选 invalidate(files) 能力由 Vite provider 实现，显式失效模块缓存并广播整页刷新。应用组合在需要该能力而后端未提供时报告 BUILDER_INVALIDATION_UNSUPPORTED。启动过程中发生的生成更新也在注册订阅后重新对齐。此接口只接收项目相对路径，不泄漏 Vite server 类型。

## 6. 浏览器运行时

runtime 插件提供可选 Provider、setup 和 onRouteChange。setup 按声明顺序执行，可返回异步 disposer；后续 setup 失败时撤销已获取的资源。Provider 按数组从外到内组合。每次 mountApplication 独立拥有 React root、Router 和订阅，dispose 幂等，先撤销订阅/路由并卸载 root，再逆序关闭 runtime effects。路由观察者错误不阻塞导航，但会写入控制台。

F1a 起，应用可通过显式启用的 `appRuntimePlugin` 使用 `src/app.tsx` 约定：`defineApp` 可配置 `setup`、`render(next)`、`patchClientRoutes`、`rootContainer` 和完整 `onRouteChange`。应用模块只在生成的浏览器入口中被静态 import，Node 生成阶段不会执行它；未启用约定插件时，显式 `app.runtime` 贡献保持原行为。协议、时序、与 Umi 的差异及验证见 [F1a 应用运行时](60-f1a-app-runtime.md)。

F1c 起，含 `redirect` 的路由在生成入口中使用 runtime 的 `RedirectRoute`：匹配后按参数生成目标，可选保留当前查询串和 hash，并以 replace 导航。它是客户端渲染重定向，不是服务器 3xx 或 loader 重定向；详见 [F1c redirect 与 wrappers](62-f1c-redirects-and-wrappers.md)。

F1d 起，显式启用的 `layoutPlugin` 通过 `ctx.react.layouts` 登记一个全局布局来源；编译合并全部路由后，用无路径的 `layout:global` 包裹未声明 `layout:false` 的顶层路由。布局组件为普通懒加载路由组件，必须渲染 `<Outlet />`；`layout:false` 在配置和低层 IR 中均可使用。详见 [F1d 全局布局](63-f1d-global-layout.md)。

F1e 起，约定扫描把根级 `src/pages/404.tsx` 映射为终端 catch-all；显式启用的 `loadingPlugin` 通过 `ctx.react.loading` 提供一个 `src/loading.*` 组件，作为首次路由解析的 `HydrateFallback`。它不改变导航期间保留旧页面的行为；完整 Suspense loading 仍待 U13/F5。详见 [F1e 404 与 loading](64-f1e-404-and-loading.md)。

当前默认包含加载、路由错误和 404 页面。页面模块懒加载；生产与开发使用相同路由树。不存在 SSR/hydration/RSC 功能承诺。普通完整页面刷新会销毁浏览器文档；显式多 mount 使用者应调用返回的 dispose。

## 7. 验证与未完成边界

对应代码：[路由](../packages/routes/src/index.ts)、[生成队列](../packages/plugin-web/src/generation.ts)、[应用命令](../packages/plugin-web/src/application.ts)、[React compiler](../packages/plugin-react/src/index.ts)、[浏览器 runtime](../packages/runtime/src/index.tsx)、[Vite bridge](../packages/plugin-react-vite/src/index.ts)。

测试分为 `pnpm check`（框架/测试类型和 Node 回归）、`pnpm typecheck:example`（示例源码）及 `pnpm test:browser`（真实 Chromium 系浏览器）。浏览器命令使用 CORMI_BROWSER_EXECUTABLE，Mac 默认现有 Edge；不下载浏览器，也不连接用户已有 profile。缺少可执行文件时明确失败，不以跳过当通过。

P1c 已增加 Web 命令层的受管 staging/产物替换、类型生成与 inspect/typecheck，边界及故障语义见增量协议。低层 builder 仍只写全新目录。服务端渲染、Linux/Windows、正式 tarball 消费者和长期内存趋势未完成；P1b 的历史测试结果不回写为新阶段结果。
