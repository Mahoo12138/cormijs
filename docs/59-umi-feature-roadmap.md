# cormi：Umi 4 / Max 功能吸收路线

日期：2026-10-20。当前代码基线：`727b6b978291f2c23491c22b3bed29b0b45aa8ec`（P16）。本文保留路线建立时的优先级、功能差距和实现计划；后续 F1a-F1f 已按此路线交付，见各状态段与独立结果文档。路线建立轮次没有新增产品运行代码，本文不是 P17 功能完成报告。

## 1. 目标与优先级纠正

用户明确要求：先不做构建恢复等外围深化，先吸收 Umi 的功能，利用 Cordis。目标从“继续打磨插件宿主和失败机制”调整为“使 cormi 具备完整、好用的应用开发能力”。既有运行、生成、构建、取消和资源回收保留为基础，不再以完善所有异常路径为由推迟 model、request、access、layout、locale 等功能。

**全量盘点、分批实现、功能等价优先。** Umi 基础框架和 Max 官方插件都在盘点范围；SSR、静态导出、MPA、微前端与其他构建后端不再被早期 MVP 的非目标条款永久排除。吸收的对象是开发者可用的行为和工作流，不是 Umi 的 Service/PluginAPI、私有 loader、历史版本兼容层或所有优化算法本体。某项采用不同后端的等价实现时，必须说明行为边界，不能宣称对应 Umi API 已完全兼容。

暂停新增构建中断恢复、自动锁接管、诊断 UI/历史记录、与应用功能无关的启动器抽象和长时间内存归因专项。实际功能遇到现有缺陷时做必要修正；没有授权删除旧保护、忽略失败测试或把权限组件当作后端授权。Windows 继续挂起，Admin 仍是验收负载。

## 2. 依据及盘点边界

本地参考现位于 `references/umi`，固定 HEAD 为 `2d368e378d10831e7a56b6eaa6e2ae705b1f3c78`，其 `packages/umi/package.json` 为 **4.7.25**；这不是对 npm 最新版本的断言。本轮发现该参考工作树已有八处修改，保持原样，不 reset、不 install。注册项库存从该 HEAD 的 Git 对象读取，避免把工作树改动当成上游基线。

盘点入口为 `packages/preset-umi/src/index.ts`、`packages/max/src/preset.ts`、`packages/plugins/src`、配置 schema 与官方文档。完整静态入口/目录清单在 [机器库存](../artifacts/umi-feature-inventory.json)。入口被列出不代表默认已经启用，目录存在也不代表独立功能；`__sample.ts`、工具目录和配置兼容实现单独区分。此轮完整枚举这些入口，重点阅读运行时、routes、model、initial-state、access、request、layout、locale；**没有逐行审计整个 Umi 仓库或执行上游测试**。

官方 [Max 简介](https://umijs.org/docs/max/introduce/) 明确把多个工程实践插件组合在 Max 中；[运行时配置](https://umijs.org/docs/api/runtime-config/) 描述浏览器 app.tsx 入口及 render/rootContainer/patchClientRoutes/onRouteChange；[路由](https://umijs.org/docs/guides/routes/) 区分路由配置、wrappers、redirect 和全局布局。下面的“Umi 对象”来自这些文档/固定源码，“cormi 现状”来自当前源码，“归属/下一步”是本项目设计，不把三者混为事实。

### 当前 cormi 基础与明显缺口

已重新读取 `packages/runtime/src/index.tsx`、`packages/plugin-react/src/{index,generate,feature,types}.ts`、`packages/routes/src/index.ts`。这是盘点时基线：当时 runtime 只有 Provider、setup 和位置通知式 onRouteChange，路由 IR 只有 path/index/module/errorBoundary/meta，没有 wrappers、redirect、clientLoader/action。**当时也不等于有 Umi 的 src/app.tsx 运行时约定。** F1a-F1f 已补齐 app 运行时、配置式嵌套路由、redirect/keepQuery、wrappers、全局布局、404/loading 与 history/导航入口；clientLoader/action 仍待 U13。用普通 React 组件手工做得到，不等于框架已吸收对应功能。

已有状态示例只是局部 state/Provider，并非自动发现 models 或 useModel；已有开发 Mock/代理并非浏览器 request/useRequest；已有 `_layout` 与路由 meta 并非 Layout/Menu/Access 套件。已有 CSS Modules/SVG 资源可用，也不能直接等同于 Antd/Tailwind/UnoCSS 集成。

## 3. 功能差距矩阵

状态只用“基础已有”“部分已有”“待实现”“登记待细读”。基础已有也不代表与 Umi 的每项配置/API 完全一致。归属是逻辑插件，不要求一行对应一个 npm 包；新的包和服务在具体实现时再创建。

| ID | Umi 功能对象 | cormi 当前状态及缺口 | Cordis/领域归属 | 批次 |
| --- | --- | --- | --- | --- |
| U01 | plugins/presets、配置启用、编译扩展 | 基础已有：原生插件、preset、贡献；不兼容 Umi PluginAPI | 原生 Cordis + 配置/preset | 保留 |
| U02 | src/app.ts(x)、defineApp、runtime config keys | 基础已有（F1a）：显式启用的独立约定插件识别单体 app 文件，defineApp 与扩展 key 注册；默认 preset 未内置约定 | 应用约定插件 + React runtime 接入 | F1 |
| U03 | render、rootContainer、patchClientRoutes、完整 onRouteChange | 基础已有（F1a）：Promise once-only next 的 render、rootContainer、patchClientRoutes、含 routes/clientRoutes 的完整事件；hash/memory history 未实现 | React 应用 runtime 扩展 | F1 |
| U04 | 配置式 routes、component、子路由 | 基础已有（F1b/F1c/F1d）：嵌套 `ConfigRoute` 由原生插件展开为扁平 IR，component/errorBoundary/meta/index/动态参数/redirect/wrappers/layout:false 可用；稳定路径 ID | 路由配置插件，输出既有 IR | F1 |
| U05 | redirect/keepQuery、wrappers、layout:false | 基础已有（F1c/F1d）：redirect/keepQuery、wrappers 与 `layout:false` 均已进入配置和扁平 IR；`layout:false` 由可选全局布局插件消费 | 路由/布局领域插件 | F1 |
| U06 | 约定路由、全局 layouts/index、404/loading | 部分已有（F1d/F1e）：可选 layoutPlugin 发现 src/layouts/index.*；根 src/pages/404.tsx 成为 catch-all；loadingPlugin 提供首次路由解析回退。导航期 Suspense loading 待 U13/F5 | 可选择的约定扫描插件 | F1 |
| U07 | history browser/hash/memory、查询与导航公共入口 | 基础已有（F1f）：app.history 选择 browser/hash/memory；`@cormijs/runtime` 导出 Link、useNavigate、useSearchParams 等导航/查询入口 | Router 适配插件/客户端 SDK | F1 |
| U08 | runtime 模块/生成导出/类型提示 | 部分已有（F1a）：应用配置模块随入口生成、仅在浏览器求值并参与类型检查；按启用功能生成应用侧导出仍待 F2 | 应用编译插件，不混合 Node/client barrel | F1 |
| U09 | model/useModel、命名空间、selector、extraModels | 部分已有（F2a）：modelPlugin 发现 src/models、路径命名空间、Hook 模型共享与 selector；对象模型、reducers/effects、extraModels 和依赖排序待后续 | model 插件 + React Provider | F2 |
| U10 | getInitialState、@@initialState、refresh/setInitialState | 部分已有（F2b）：initialStatePlugin 登记 getInitialState，提供 useInitialState/loading/error/refresh/set；@@initialState 模型集成、首屏阻塞与 SSR 待后续 | initial-state 插件，依赖 model/应用 runtime | F2 |
| U11 | request、运行时配置、拦截器、统一错误 | 部分已有（F2c）：requestPlugin 注册 app.tsx request 配置和每挂载 fetch 客户端；拦截器、统一错误协议、dataField 待后续 | request 契约/客户端实现适配 | F2 |
| U12 | useRequest、手动/自动、分页/加载更多等 | 部分已有（F2c）：自动/手动、loading/error、refresh、cancel、竞态保护；重试/轮询/分页/加载更多待后续 | 请求 Hooks 插件，可复用成熟库 | F2 |
| U13 | clientLoader/useClientLoaderData/routeProps | 部分已有（F5a）：配置式路由的 `clientLoader` 导出名映射到 React Router loader，页面用 `useClientLoaderData`/`useRouteLoaderDataFor`/`useClientLoaderError` 读取；约定式路由识别、loader 失败的边界呈现契约与数据类型生成待后续 | 路由数据插件 | F3 |
| U14 | access.ts/useAccess/Access、路由访问控制 | 基础已有（F3b/F3d/F3e/F4g）：accessPlugin 从 initialState 计算权限，useAccess/Access、路由 access 守卫、自定义 accessForbidden 与 `src/access.ts` 约定（配置优先于约定）可用；服务端授权边界与权限类型生成待后续 | access 插件，依赖初始状态与路由扩展 | F3 |
| U15 | layout、菜单、面包屑、403/404、插槽 | 部分已有（F3c/F3e/F4i）：布局容器/meta、useMenu/useBreadcrumb、useActiveMenuKeys、access 过滤、`meta.locale` 目录化标题与 `useMenuCollapse` 折叠状态；无 ProLayout/Antd adapter 与路由级 layout 插槽 | layout/menu 插件，UI adapter 可选 | F3 |
| U16 | locale、消息文件、切换/持久化、useIntl/FormattedMessage | 部分已有（F3a/F4h）：localePlugin 提供内联消息、default/fallback、切换/持久化、useIntl/FormattedMessage，并可用 `directory` 构建期内联 `src/locales/<locale>.json` 消息目录；复数/日期格式化、按语言懒加载与 UI 联动待后续 | locale 插件 + 客户端 i18n provider | F3 |
| U17 | Antd/ProLayout、图表集成、主题与 locale 联动 | 待实现官方集成；应用可自行依赖 UI/图表库 | 可选 UI adapter/集成指南，不绑定 core | F3 |
| U18 | Mock 约定发现、目录、方法/路径、代理配置 | 部分已有（F4b）：mockPlugin 发现 mock/**、映射 METHOD/路径并开发期重载；req/res 兼容与统一代理配置待后续 | 复用 DevApiService，新增约定/后端 bridge | F4 |
| U19 | .umirc/config、环境分层/覆盖、alias/@/@@、define | 部分已有（F4c/F4d）：aliasPlugin 支持项目内相对别名与可选内置 `@`→src，definePlugin 在 dev 与 build 替换 JSON 常量；`@@`、环境分层自动映射与 define 类型生成待后续 | 配置/约定插件 + 后端专属桥接 | F1/F4 |
| U20 | HTML title/metas/links/headScripts/scripts/favicon | 部分已有（F4a/F4e）：可选 htmlPlugin 注入 title/lang/meta/link/favicon，并按 Umi 位置约定注入 headScripts/scripts（封闭属性集合、转义与逃逸消解）；每路由 head 与任意 raw head HTML 待后续 | HTML/head 插件 | F4 |
| U21 | helmet、页面标题/SEO 元数据 | 待实现官方能力；手改 document.title 不算 | head 客户端插件 | F3/F4 |
| U22 | global 样式、CSS Modules、Less/Sass/PostCSS/SVGR | 部分已有（F4f）：globalStylePlugin 发现 src/global.{css,scss,sass,less} 并由生成入口按 hook 顺序副作用导入，dev 新建/删除可触发生成；CSS Modules 类型声明、PostCSS/Tailwind/SVGR 与预处理集成仍待后续 | 样式/资源插件 + backend adapter | F4 |
| U23 | Tailwind、UnoCSS、styled-components | 待实现可选集成 | 各生态 adapter | F4 |
| U24 | icons | 待实现公共图标方案 | 图标资源/代码生成插件 | F4 |
| U25 | publicPath/runtimePublicPath、CDN、hash、copy/externals | 部分已有 base/静态资源与原生 Vite 扩展；无统一完整公开配置 | 输出/资源策略插件，差异显式 | F4 |
| U26 | targets、polyfill、legacy、ReactCompiler/SWC/transform | 可用既有 Vite 原生插件口；未交付对应官方配置面 | 可选转换 provider/bridge | F4/F6 |
| U27 | page/component/mock/API 等微生成器 | 仅新建 app/插件模板；缺项目内增量生成器 | generators 插件与模板贡献 | F4 |
| U28 | lint/format/test/precommit/deadcode 等工程命令 | 框架自身有测试；不是面向用户的完整工具集成 | 可选命令插件 | F4 |
| U29 | request/接口代码生成与类型工作流 | 待实现；API generator 入口已登记，具体协议/规范需读实现 | API generator 插件 | F4 |
| U30 | TypeScript、prepare、导出类型、monorepo | 基础已有至 P16；仍需配合新功能生成类型与别名 | 既有 TS/prepare + monorepo adapter | 随功能 |
| U31 | code splitting、routePrefetch、routePreloadOnLoad | 部分已有页面 lazy；无预取策略/配置面 | 路由加载插件 + backend bridge | F5 |
| U32 | SSR、服务端 loader/渲染入口 | 待实现 | 独立 SSR renderer/profile，复用可共享契约 | F5 |
| U33 | exportStatic/预渲染/静态导出 | 当前只有 SPA 静态产物，不等于逐路由预渲染 | 静态导出插件 | F5 |
| U34 | MPA | 待实现多入口应用编排 | 独立 MPA profile | F5 |
| U35 | apiRoute | 当前只开发 Mock，不是生产 API route | 独立服务端路由插件 | F5 |
| U36 | qiankun、Module Federation | 待实现 | 可选主/子应用与 federation adapter | F6 |
| U37 | dva、valtio、react-query | 待实现可选集成，不全塞入默认数据流 | 各状态库/服务端状态 adapter | F6 |
| U38 | analytics、moment2dayjs、confetti 等官方插件 | 登记待细读；不把存在文件当作已移植 | 独立可选插件 | F6 |
| U39 | analyze、MFSU、depsOnDemand、esmi 等优化 | 部分有 Vite 原生优化；无 Umi 功能等价结论 | 构建优化插件，按真实后端分别验证 | F6 |
| U40 | webpack/Vite/Mako/Utoopack/bundler 选择 | 只有 Vite 实现；契约可替换不等于多后端已实现 | 独立 builder provider/preset | F6 |
| U41 | monorepo redirect/phantomDependency/overrides/check | 部分已有包边界校验，非 Umi 等价全套 | 工程/依赖策略插件 | F4/F6 |
| U42 | clickToComponent/devTool/terminal/UI/aiDev/stagewise/hmrGuardian | 库存已登记，细节待各项源码/使用流程核对 | 可选开发工具插件，不进内核 | F6 |
| U43 | lowImport/okam/classPropertiesLoose 及其他版本特定入口 | 只确认登记，不根据名字猜行为 | 在该后端/转换领域逐项决定 | F6 |

Umi 文档与源码的来源定位，见下一节及机器库存。F1/F4 的基础配置项在阻塞首批应用时前移，不把“一次做完所有配置项”作为前置。模型、权限、国际化等条目的“待实现”基于当前包/运行时/贡献接口核对，不根据几百项测试的总数推导完成率。

## 4. 实施顺序与可审阅交付

### F1：应用运行时与路由使用体验——下一开发批次

以 Umi `src/app.ts(x)`/defineApp 与完整路由使用为入口。优先补 app 文件识别、运行时配置接入、rootContainer/初始化与路由事件，再补应用侧嵌套路由、redirect、wrappers、全局 layout、404/loading、history 选择及公共导出。保留 cormi 原显式 runtime/IR 为低层口，提供独立约定插件；禁用约定不影响手动贡献。

**首个编码切片 F1a** 是 app 运行时模块与导出/Hook 接入，不是一次改完启动器。交付应让应用在 src/app.tsx 中添加 Provider、执行首屏初始化、观察带 location/action/basename/isFirst 的路由变化，并能在渲染前调整路由；客户端模块不能在 Node 配置阶段被 import 执行。是否保留 Umi render(oldRender) 回调形式、是否提供 Promise 优先替代，在接口文档明确，不能只实现 setup 后声称相同协议。

需要模型等插件登记额外 runtime config keys 时，扩展注册必须归属原生插件，卸载后撤回；不往 core 添加 request/access/layout 的白名单。只补实际生成所需的最小接缝，不为“未来所有插件”再造万能流水线。

**F1a 状态（2026-10-20）：** 已交付并通过验证；API、Umi 行为差异、应用方式和测试结果见 [F1a 应用运行时](60-f1a-app-runtime.md)。约定插件为显式启用，默认 preset 不接管既有 src/app.tsx 组件。

**F1b 状态（2026-10-20）：** U04 的配置式嵌套路由已交付；`ConfigRoute`/`expandRouteConfig` 输出既有扁平 IR，`routeConfigPlugin` 通过 `inject: ['react']` 与 `ctx.react.routes.tap()` 贡献，卸载撤回。用法、Umi 差异、约定路由关闭方式和验证见 [F1b 配置式嵌套路由](61-f1b-config-routes.md)。

**F1c 状态（2026-10-20）：** U05 的 `redirect`/`keepQuery` 与 `wrappers` 已交付；redirect 生成 `RedirectRoute` 做参数替换与 replace 导航，wrappers 展开为普通父路由记录，二者都进入既有扁平 IR。用法、值与路径规则、Umi 差异和验证见 [F1c redirect 与 wrappers](62-f1c-redirects-and-wrappers.md)。

**F1d 状态（2026-10-20）：** U06 的全局布局部分已交付：可选 `layoutPlugin` 发现 `src/layouts/index.*`，在全部路由贡献合并后包裹未退出的顶层路由；`layout:false` 已由配置、低层 IR 和 wrapper 链共同支持。用法、差异和验证见 [F1d 全局布局](63-f1d-global-layout.md)。

**F1e 状态（2026-10-20）：** U06 的 404/loading 约定已交付：根 `src/pages/404.tsx` 成为终端 catch-all；可选 `loadingPlugin` 发现 `src/loading.*` 并作为首次路由解析回退。导航期间的 Suspense loading 仍待 U13/F5。用法、边界和验证见 [F1e 404 与 loading](64-f1e-404-and-loading.md)。

**F1f 状态（2026-10-20）：** U07 的 history 选择与公共导航/查询入口已交付：`app.history` 支持 browser/hash/memory，`@cormijs/runtime` 重导出 Link、useNavigate、useSearchParams 等应用面；事件新增 history 字段。用法、差异与验证见 [F1f history 与导航](65-f1f-history-and-navigation.md)。F1 全部计划能力已交付，下一阶段进入 F2。

验收从真实应用文件出发：app.tsx/tsx 文件冲突、命名/默认导出形式、Hook 次序、异步初始化、路由修改及导航事件、模块停用和源码更新、生产构建、严格类型与独立安装。不是只测试注册表返回了一段字符串。

### F2：数据流、初始状态和请求

model 对应官方 `packages/plugins/src/model.ts` 与 `libs/model.tsx`：自动发现模型、命名空间、单实例共享、selector、extraModels 和推导类型。模型函数若使用 React Hooks，应在 React 执行规则内运行，不能直接塞进 Node Cordis apply。

initial-state 对应 `packages/plugins/src/initial-state.ts`；Umi 通过特殊 model 保存 getInitialState 的值，提供 loading/error/refresh/setInitialState，并控制首次加载。cormi 采用可替换的客户端状态实现，明确首次阻塞、失败呈现和刷新竞态，不给每个使用者重复发初始化请求。功能声明和生成由 Node Cordis 插件贡献。

request 对应 `packages/plugins/src/request.ts` 和 [请求文档](https://umijs.org/docs/max/request/)；当前 Umi 以 axios 与其 useRequest 集成为基础，包含运行时拦截器、错误协议、dataField、局部配置和取消。cormi 可复用成熟依赖或提供不同传输 adapter，但要列出对应行为；只写 fetch+loading 不算完整 useRequest。验收至少包含并发/乱序、错误重试、取消/卸载、手动/自动、分页或加载更多及类型推导。

这批能力完成后应能写“初始化用户 → 多处读取共享模型 → 请求业务接口 → 更新状态”的应用，而非需要开发者自己搭一套全局上下文。

**F2a 状态（2026-10-20）：** U09 的 Hook 模型基础已交付：显式 `modelPlugin` 发现 `src/models/**`，按路径生成稳定 namespace，每个挂载执行一次模型 Hook；`@cormijs/runtime` 的 `useModel(namespace, selector?)` 共享状态并提供 selector，模型在路由切换间保留、刷新后重建。对象模型、reducers/effects、extraModels、依赖排序、initial-state 与 request 仍待后续 F2 切片。用法、差异与验证见 [F2a model 与 useModel](66-f2a-models.md)。

**F2b 状态（2026-10-20）：** U10 的初始状态基础已交付：`initialStatePlugin` 登记 `getInitialState` 与 runtime Provider，`useInitialState` 提供 loading/error/data、refresh 和 setInitialState；首次渲染不阻塞，卸载与并发刷新有防护。`@@initialState` 模型集成、首屏阻塞与 SSR/hydration 仍待后续。用法、差异与验证见 [F2b getInitialState](67-f2b-initial-state.md)。

**F2c 状态（2026-10-20）：** U11/U12 的请求基础已交付：`requestPlugin` 注册 request 配置和每挂载 fetch 客户端；`useRequest` 支持自动/手动、loading/error/data、refresh、cancel、HTTP 错误和 generation 竞态保护。拦截器、统一错误协议、重试/轮询/分页仍待后续。用法、差异与验证见 [F2c request 与 useRequest](68-f2c-request.md)。F2 基础链路（初始状态 → 共享模型 → 请求）已具备。

**F3a 状态（2026-10-20）：** U16 的 locale 基础已交付：`localePlugin` 登记 locale 配置与 runtime Provider，`useIntl`/`FormattedMessage` 支持内联消息、default/fallback、切换和 localStorage 持久化。消息目录、复数/日期/数字格式化、UI 库语言联动与 SSR 仍待后续。用法、差异与验证见 [F3a locale](69-f3a-locale.md)。

**F3b 状态（2026-10-20）：** U14 的权限基础已交付：`accessPlugin` 登记 access 函数，从 `initialState` 计算布尔权限并随状态变化重算；`useAccess`/`Access` 可用于页面与按钮级渲染控制。`src/access.ts` 约定、路由级 access 与菜单过滤仍待后续。用法、差异与验证见 [F3b access](70-f3b-access.md)。

**F3c 状态（2026-10-20）：** U15 的菜单基础已交付：`menuPlugin` 从实际挂载的路由树与 meta 生成嵌套菜单，`useBreadcrumb` 生成面包屑，启用 access 时按 `meta.access` 过滤；Runtime Provider 契约新增 routes/basename。ProLayout/Antd adapter、选中/折叠 helper、路由级 access 与布局插槽仍待后续。用法、差异与验证见 [F3c menu](71-f3c-menu.md)。

**F3d 状态（2026-10-20）：** U14 的路由级 access 已交付：ConfigRoute/RouteRecord 的 `access` 经生成器变为 AccessRoute 守卫，权限不足渲染内置 403 且不加载页面；有 wrappers 时守卫位于 wrapper 链之外，菜单读取同一 key 过滤。可定制 403、src/access.ts 约定与 UI adapter 仍待后续。用法、差异与验证见 [F3d route access](72-f3d-route-access.md)。

**F3e 状态（2026-10-20）：** access 路由守卫可通过 app 配置的 `accessForbidden` 渲染自定义 403；菜单新增 `useActiveMenuKeys`，按当前 location 返回选中项和祖先 key。菜单折叠状态、ProLayout/Antd adapter 与 src/access.ts 自动发现仍待后续。用法与验证见 [F3e 自定义 403 与菜单选中](73-f3e-custom-403-active-menu.md)。F3 剩余为 UI adapter/折叠 helper。

**F4a 状态（2026-10-20）：** U20 的配置式 HTML head 已交付：可选 `htmlPlugin` 在 React–Vite 桥中替换/注入 title、lang、favicon、meta 与 link，值经过转义和边界校验，index.html 仍归应用所有。headScripts/scripts、每路由 head 与非 Vite 后端仍待后续。用法、差异与验证见 [F4a HTML head](74-f4a-html-head.md)。

**F4b 状态（2026-10-20）：** U18 的 Mock 约定已交付：显式 `mockPlugin` 扫描 `mock/**`，将 default-export 的 `METHOD /api/path` 映射注册到既有 DevApiService，并在开发期轮询重载；新增只读 `projectRoot` 服务供文件约定插件使用。生产预览不提供 Mock，req/res 兼容与代理统一待后续。用法、差异与验证见 [F4b Mock](75-f4b-mock.md)。

**F4c 状态（2026-10-20）：** U19 的别名部分已交付：`aliasPlugin` 接受项目内相对路径映射并合并进 Vite 解析器，TypeScript paths 由应用显式对齐。用法、差异与验证见 [F4c alias](76-f4c-alias.md)。

**F4d 状态（2026-10-20）：** U19 的编译期常量与内置别名便利已交付：`definePlugin` 把 JSON 字面量注入 Vite 构建，并在 Vite 不处理 define 的开发阶段由同一插件用 esbuild 完成同名替换，dev/build/preview 结果一致；`aliasPlugin` 的 `builtins` 增加 `@`→`src`，位于显式别名之后且不截获作用域包。define 类型声明、`@@`、环境分层映射、样式与微生成器仍待后续。用法、差异与验证见 [F4d define](77-f4d-define.md)。

**F4e 状态（2026-10-20）：** U20 的 headScripts/scripts 已交付：`htmlPlugin` 接受字符串或对象条目，按 Umi 的位置约定把 head 脚本插在 `<head>` 末尾、body 脚本插在 `</body>` 之前；属性走封闭白名单并转义，内联内容消解 `</script` 逃逸。每路由 head（U21）、CSP/nonce 与函数式贡献仍待后续。用法、差异与验证见 [F4e HTML scripts](78-f4e-html-scripts.md)。

**F4f 状态（2026-10-20）：** U22 的第一步已交付：可选 `globalStylePlugin` 通过新增的 `ctx.react.styles` 贡献全局样式表约定，`generateApplication` 在生成入口顶部插入受校验的相对副作用导入，候选文件的出现/消失参与 dev 观测与重生成，`summary.styles` 报告所有者与文件。预处理器仍由 Vite 原生处理（应用安装 less/sass），CSS Modules 声明、PostCSS/Tailwind/SVGR 与资源约定待后续。用法、差异与验证见 [F4f 全局样式](79-f4f-global-styles.md)。

**F4g 状态（2026-10-20）：** U14 的约定入口已交付：`accessPlugin` 通过新增的 `ctx.react.access` hook 发现 `src/access.{ts,tsx}`，生成入口以 `applyAccessConvention(resolveAppConfig(...), accessConvention.default)` 合并权限函数，`app.tsx` 显式 `access` 优先；候选出现/消失参与 dev 观测，`summary.access` 报告归属。权限 key 的类型生成、层级/后端同步与服务端授权边界仍待后续。用法、差异与验证见 [F4g access 约定](80-f4g-access-convention.md)。

**F4h 状态（2026-10-20）：** U16 的消息文件已交付：`localePlugin` 的 `options.directory`（新增 `ctx.react.locale-catalog` hook）在 Node 侧读取 `src/locales/<locale>.json`，校验 locale code、扁平字符串表与容量上限，按 locale 合成为构建期内联 JSON，运行时 `applyLocaleCatalogs` 合并且 `app.tsx` 配置逐 key 优先；目录文件增删改参与 dev 观测，`summary.localeCatalogs` 报告各 locale 的 key 数。复数/日期/数字格式化、locale key 类型生成、按语言懒加载与 UI 库联动仍待后续。用法、差异与验证见 [F4h 消息目录](81-f4h-locale-catalogs.md)。

**F4i 状态（2026-10-20）：** U15 的折叠与目录化标题已交付：`menuPlugin` 的 `collapse` 选项经 RuntimeContribution options 传入 `MenuProvider`，`useMenuCollapse()` 提供 `{collapsed,setCollapsed,toggle}` 并可选 `localStorage` 持久化；菜单与面包屑标题按 `meta.locale` → `meta.title` → `meta.name` 解析，`IntlApi.peek` 保证未命中时不显示原始 key。ProLayout/Antd adapter、图标/徽章与布局插槽仍待后续。用法、差异与验证见 [F4i 菜单折叠与标题](82-f4i-menu-collapse.md)。

**F5a 状态（2026-10-20）：** U13 的核心已交付：`ConfigRoute.clientLoader` 与扁平 IR 校验导出名，`generateApplication` 让该路由一次性解析页面模块并用 `clientLoaderOf` 把同名导出交给 React Router loader，深链接/重载/前进后退都会取数；`@cormijs/runtime` 新增 `useClientLoaderData`、`useRouteLoaderDataFor`、`useClientLoaderError`。约定式路由识别、loader 失败的边界呈现契约（该呈现实测未挂载，原因尚未定位，故回退相关改动）、SSR 数据注水与预取（U31）仍待后续。用法、差异与验证见 [F5a 路由 client loader](83-f5a-client-loader.md)。

### F3：权限、布局、菜单和国际化

access 对应 `packages/plugins/src/access.ts` 和 [权限文档](https://umijs.org/docs/max/access/)；useAccess/Access、access.ts、路由访问策略应随初始状态变化。按钮隐藏与路由阻止分别验证，服务端授权仍由后端实施。

layout/menu 对应 `packages/plugins/src/layout.ts`：菜单从路由元数据形成，覆盖嵌套、隐藏、选中、面包屑、layout:false、权限过滤和插槽。路由/菜单能力与 Antd/ProLayout adapter 分开，不能为了提供 layout 让每个应用强制依赖 Antd。应用可用自有布局。 官方 [图表文档](https://umijs.org/docs/max/charts/) 推荐按需安装 Ant Design Charts/Plots 等库；这类生态集成也纳入 U17，但不据此捏造一个固定 Max preset 中不存在的 charts 插件，更不自行重写图表库。

locale 对应 `packages/plugins/src/locale.ts` 与模板：消息发现、默认/回退语言、运行时切换、持久化、格式化和类型；菜单、标题及 UI 库语言联动通过可选 adapter 完成。实际测试两种语言、首次加载及动态切换，不只替换一段静态文案。

### F4：日常工程功能

补齐 Mock 目录、配置/alias/define 便利入口、HTML 注入、样式及资源、微生成器、lint/test 等应用工具。底层能力已有则复用，不再为框架自身完善构建恢复或通用诊断。配置选项需要归属特定后端时保持专属接口；不能把全部 Umi/webpack 配置类型塞进公共 BuildPlan。

### F5：加载与渲染模式

在共享应用功能后推进 client loader、路由预取/拆包策略、SSR、静态导出、MPA、生产 API route；U13 可因页面数据需求提前到 F3。各模式由插件/profile 组合，运行契约不同处不强行等同 SPA。SPA dist 复制成功不能作为 SSR/SSG 已完成的证据。

### F6：生态集成及其他后端能力

推进 qiankun/Module Federation、状态库 adapter、分析/优化与不同 builder；保留低频官方插件/实验入口的逐项清单。MFSU 等与特定后端相关的实现，以解决同一开发问题为目标，记录复用、适配、等价替代或待实现决定，不造一个无效的同名开关。若放弃某个上游功能，必须给出具体理由供用户决策，不能直接从表中消失。

## 5. Cordis 如何承担这些功能

**插件装配层**：一个功能入口通过 ctx.plugin() 安装领域服务、约定发现与生成适配，消费者通过 inject 声明依赖。preset 只组合常用插件并提供默认值；不在 preset 中藏不可替换业务实现，也不让用户配置几十个内部模块。

**Node 与客户端分开**：Node 插件拥有配置、扫描、模块贡献与生成；浏览器拥有 request/model/access/i18n 的实际运行数据。Node Context 和私有配置不被序列化进前端。客户端如果需要动态服务依赖，可以使用浏览器兼容的 Cordis 服务；这是具体功能设计选择，不能为了“万物”先重做整个浏览器宿主，也不能声称 Cordis 无法在浏览器使用。

**客户端框架能力仍可选择**：API/模块应随插件启停和实际安装输出，类型由同一来源生成。React Provider 负责渲染层上下文，Cordis 负责插件/服务及受管资源；二者不互相冒充。纯类型、函数和 DTO 不必登记为服务；也不另造 pending/active/disposed 插件管理器。

**复用现有接缝**：优先沿 ctx.react 的贡献、application 编译、原生 backend bridge 和既有 runtime 清单扩展；只有新功能确实需要时才增加通用接口。已证明能够替换的能力不再为抽象更漂亮而整体重写。

## 6. 验收与进度汇报的改变

每个能力写清 Umi 源码/行为基线、cormi API、插件开关/依赖、实际应用使用方式、差异与测试。汇报优先回答“现在开发者能做什么”“下一项还缺什么”，测试计数附后，不能用总通过数掩盖应用功能缺口。

新增客户端能力必须通过真实浏览器、类型检查、开发/生产及必要的独立包消费。复杂测试聚焦该功能：初始状态与权限联动、请求竞态、路由深链接、语言切换等。现有框架回归按影响范围执行；只有改变对应生命周期机制时才扩大该领域压力测试，不把每个文档改动或 Hook 都扩张成新的可靠性项目。

本轮是主线重排与源码盘点，只验证文档/库存/工作区边界，没有新增产品代码，也没有重跑或增加 P16 的 423/19 测试。P16 历史成绩仍见 [原结果](58-p16-results.md)。构建恢复已从当前任务移走。

## 7. 源码定位与后续维护

固定 Umi 对象中的重点入口：

| 参考路径（相对 references/umi） | 用途 |
| --- | --- |
| packages/preset-umi/src/index.ts | 基础 preset 注册入口，包括功能和命令；不是所有项默认启用 |
| packages/max/src/preset.ts | Max 官方插件组合 |
| packages/core/src/route/routesConfig.ts、routesConvention.ts | 配置/约定路由语义，编码前逐项细读 |
| packages/preset-umi/src/features/tmpFiles/tmpFiles.ts | runtime/app/路由/导出生成接入 |
| packages/preset-umi/src/features/configPlugins/{configPlugins,schema}.ts | 配置默认值与 schema 注册，不照抄全量类型 |
| packages/renderer-react/src/browser.tsx、routes.tsx | 客户端渲染、路由事件、wrapper/redirect 适配 |
| packages/plugins/src/{model,initial-state,request,access,layout,locale}.ts | 首批应用能力的生成与运行时衔接 |

库存同时保存全部 preset 字面注册项、features 目录、官方 plugins 文件、命令目录和 schema 参考路径；目录覆盖不是功能完成率。新增、移除或发现版本差异时更新库存和对应矩阵行，不靠记忆选下一项。参考工作树的既有修改保留，后续仍先核对 HEAD/状态；本轮不改变依赖、分发或平台支持承诺。
