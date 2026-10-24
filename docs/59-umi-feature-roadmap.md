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
| U09 | model/useModel、命名空间、selector、extraModels | 部分已有（F2a/U09-1..4）：modelPlugin 发现 src/models、路径命名空间、Hook 模型共享与 selector；对象模型 `state/reducers/effects/subscriptions`、`useModelDispatch`/全局派发、跨模型 put、`extraModels`、`dependencies` 依赖排序与循环检测、选择器 `isEqual` 优化已交付；热替换保留 store 待后续 | model 插件 + React Provider | F2 |
| U10 | getInitialState、@@initialState、refresh/setInitialState | 部分已有（F2b）：initialStatePlugin 登记 getInitialState，提供 useInitialState/loading/error/refresh/set；@@initialState 模型集成、首屏阻塞与 SSR 待后续 | initial-state 插件，依赖 model/应用 runtime | F2 |
| U11 | request、运行时配置、拦截器、统一错误 | 部分已有（F2c）：requestPlugin 注册 app.tsx request 配置和每挂载 fetch 客户端；拦截器、统一错误协议、dataField 待后续 | request 契约/客户端实现适配 | F2 |
| U12 | useRequest、手动/自动、分页/加载更多等 | 已交付（F2c/U12-1–12）：自动/手动、loading/error、refresh、cancel、竞态保护；失败重试与 retryDelay、成功后轮询（可含隐藏页）、refreshDeps、`usePagination` 分页/加载更多、GET `cacheTime` 短缓存与并发去重（`cacheBust`）、`cacheLimit` LRU、`cacheTags` 与 `invalidateCache`、`debounceWait` 防抖（`debounceMaxWait`/`debounceLeading`/`debounceTrailing`）、`throttleWait` 前沿/尾调用节流（`throttleLeading`/`throttleTrailing`）、`useCursorPagination` 游标分页与可选 Web Storage 缓存持久化（`cachePersist`/`cachePersistKey`）与跨标签页失效（storage 事件 + epoch）已交付；自定义节流键/跨组件共享为扩展，不阻断 | 请求 Hooks 插件，可复用成熟库 | F2 |
| U13 | clientLoader/useClientLoaderData/routeProps | 部分已有（F5a/F5b/F5j/F5u）：配置式与约定式页面都可用 `clientLoader`（编译期词法扫描），映射到静态 route loader，loader 抛错由本路由 `errorBoundary` 呈现；生成 `.cormi/loaders.d.ts` 提供按路由 id 的 `CormiLoaderData.Data` 返回类型，约定扫描支持值形式的重导出；数据预取与 SSR loader 待后续 | 路由数据插件 | F3 |
| U14 | access.ts/useAccess/Access、路由访问控制 | 基础已有（F3b/F3d/F3e/F4g）：accessPlugin 从 initialState 计算权限，useAccess/Access、路由 access 守卫、自定义 accessForbidden 与 `src/access.ts` 约定（配置优先于约定）可用；服务端授权边界与权限类型生成待后续 | access 插件，依赖初始状态与路由扩展 | F3 |
| U15 | layout、菜单、面包屑、403/404、插槽 | 部分已有（F3c/F3e/F4i/U17-2）：布局容器/meta、useMenu/useBreadcrumb、useActiveMenuKeys、access 过滤、`meta.locale` 目录化标题与 `useMenuCollapse` 折叠状态；ProLayout 外壳见 U17-2；路由级 layout 插槽待后续 | layout/menu 插件，UI adapter 可选 | F3 |
| U16 | locale、消息文件、切换/持久化、useIntl/FormattedMessage | 部分已有（F3a/F4h/F5f/F5l/F5m/U16-1/U16-2）：内联消息、default/fallback、切换/持久化、useIntl/FormattedMessage、`src/locales` 目录，`formatNumber`/`formatDate`/`tp`，生成的 `CormiLocale.Code`/`MessageKey` 类型，ICU 子集、`formatRelativeTime`、ICU 富文本标签、locale 变更订阅；UI locale 归一化/回退链/资源解析与 `direction`（RTL 检测+覆盖）已交付；按请求 locale、RTL 样式/组件封装待后续 | locale 插件 + 客户端 i18n provider | F3 |
| U17 | Antd/ProLayout、图表集成、主题与 locale 联动 | 部分已有（U17 增量/U17-1/U17-2/U17-3）：`toAntdMenuItems`/`toLayoutRoutes` 菜单适配；可选 `@cormijs/plugin-antd` 通过 runtime 贡献接入 Antd `ConfigProvider`，复用 UI locale 回退链/RTL direction，支持 JSON token 与暗色算法，内置 11 个官方 locale；可选 `ProLayoutShell` 在全局 layout 中接入 ProLayout 菜单/导航/折叠持久化，`proLayoutPlugin` 负责预打包与选项校验；菜单 `meta.icon` 可经 `icons` 注册表映射到任意图标组件（U17-3/U24）；ProLayout `SettingDrawer` + `useProLayoutSettings` 提供可持久化主题/布局编辑（U17-4）；应用侧图表库经 `@ant-design/plots` 2.6.8 在 dev/build/preview 与安装包消费中验证（U17-5）；`ClientOnly` 为图表提供 SSR fallback + hydration 边界（U17-6）；活动 locale 经 `g_locale` 桥接 ProLayout 五个内置 locale 与 SettingDrawer 文案，`formatMessage` 可覆盖主文案（U17-7）；服务端图表内容与自定义 SettingDrawer 文案待后续 | 可选 UI adapter/集成指南，不绑定 core | F3 |
| U18 | Mock 约定发现、目录、方法/路径、代理配置 | 部分已有（F4b/F5s）：mockPlugin 发现 mock/**、映射 METHOD/路径并开发期重载；proxyPlugin 把路径前缀代理到 http(s) 上游，dev 与 preview 一致；req/res 兼容与统一配置入口待后续 | 复用 DevApiService，新增约定/后端 bridge | F4 |
| U19 | .umirc/config、环境分层/覆盖、alias/@/@@、define | 部分已有（F4c/F4d）：aliasPlugin 支持项目内相对别名与可选内置 `@`→src，definePlugin 在 dev 与 build 替换 JSON 常量；`@@`、环境分层自动映射与 define 类型生成待后续 | 配置/约定插件 + 后端专属桥接 | F1/F4 |
| U20 | HTML title/metas/links/headScripts/scripts/favicon | 部分已有（F4a/F4e）：可选 htmlPlugin 注入 title/lang/meta/link/favicon，并按 Umi 位置约定注入 headScripts/scripts（封闭属性集合、转义与逃逸消解）；每路由 head 与任意 raw head HTML 待后续 | HTML/head 插件 | F4 |
| U21 | helmet、页面标题/SEO 元数据 | 部分已有（F5c/F5t/F5x）：可选 headPlugin 按 `meta.head` 在导航后同步标题/meta/link/JSON-LD，并提供 `<Helmet>` 组件级贡献（路由→组件合并、受管节点可替换、卸载恢复）与 SSR 头部收集 | head 客户端插件 | F3/F4 |
| U22 | global 样式、CSS Modules、Less/Sass/PostCSS/SVGR | 部分已有（F4f/F4m）：globalStylePlugin 发现 src/global.{css,scss,sass,less} 并由生成入口按 hook 顺序副作用导入；可选 styleTypesPlugin 生成 CSS Modules/静态资源的环境类型声明；精确类名类型、PostCSS/Tailwind/SVGR 仍待后续 | 样式/资源插件 + backend adapter | F4 |
| U23 | Tailwind、UnoCSS、styled-components | 待实现可选集成 | 各生态 adapter | F4 |
| U24 | icons | 部分已有（U17-3）：`meta.icon` + `icons` 注册表由 `toLayoutRoutes`/`ProLayoutShell` 解析，图标库由应用提供；自动发现、SVG 资源管线与代码生成待后续 | 图标资源/代码生成插件 | F4 |
| U25 | publicPath/runtimePublicPath、CDN、hash、copy/externals | 部分已有（F4j）：base 表达部署前缀，可选 outputPlugin 在构建后复制文件并支持 `hash:false` 稳定文件名；externals、runtimePublicPath 与 CDN 运行时切换待后续；Vite 7 的 `renderBuiltUrl` runtime 只覆盖 JS 内资源引用，不覆盖代码分割 chunk 导入，未交付等价 runtimePublicPath | 输出/资源策略插件，差异显式 | F4 |
| U26 | targets、polyfill、legacy、ReactCompiler/SWC/transform | 可用既有 Vite 原生插件口；未交付对应官方配置面 | 可选转换 provider/bridge | F4/F6 |
| U27 | page/component/mock/API 等微生成器 | 部分已有（F4k/F5r/F5w）：通用「命令+位置参数」协议、内置 `generate page/component/model/api/mock` 与 16 个自定义静态模板（含 --force/--dry-run 与路径白名单）；交互式提问与模板函数待后续 | generators 插件与模板贡献 | F4 |
| U28 | lint/format/test/precommit/deadcode 等工程命令 | 部分已有（F5i）：可选 toolPlugin 包装项目已安装的 lint/format 二进制（参数透传、错误码、stderr 转发）；文件发现、subcommand 模式与 precommit/deadcode 待后续 | 可选命令插件 | F4 |
| U29 | request/接口代码生成与类型工作流 | 待实现；API generator 入口已登记，具体协议/规范需读实现 | API generator 插件 | F4 |
| U30 | TypeScript、prepare、导出类型、monorepo | 基础已有至 P16；仍需配合新功能生成类型与别名 | 既有 TS/prepare + monorepo adapter | 随功能 |
| U31 | code splitting、routePrefetch、routePreloadOnLoad | 部分已有（F5d/F5g/F5p）：页面按路由懒加载，注册表支持手动、`mode:"idle"` 空闲全量、`usePrefetchOnIntent()` 悬停/聚焦与 `usePrefetchOnVisible()` 视口触发预取；数据预取与 SSR 侧预取待后续 | 路由加载插件 + backend bridge | F5 |
| U32 | SSR、服务端 loader/渲染入口 | 部分已有（F5y/F5z/U32-1/U32-2）：`app.ssr: true` + `ssrPlugin` 在 dev（Vite ssrLoadModule）与 preview（构建 bundle）执行 static handler/clientLoader、注入 hydration 并由客户端 hydrateRoot 接管；servePlugin 提供 `cormi serve`；SSR 输出路由/Helmet head；serverLoader 仅在服务端执行、hydration 对齐，客户端导航经 `<base>.cormi/server-loader` 回退取数；`streaming: true` 时 dev/preview/serve 用 React 流式渲染，Suspense 边界继续流入，hydration 脚本移出挂载根；压缩/TLS/背压/代理缓冲与流中错误恢复待生产化 | 独立 SSR renderer/profile，复用可共享契约 | F5 |
| U33 | exportStatic/预渲染/静态导出 | 部分已有（F5e/U33-1..7）：可选 staticExportPlugin 为每个字面路径路由生成带 `meta.head` 的 HTML 外壳，notFound 可生成 404.html；`ssrPlugin.prerender` 用已构建 SSR bundle 真正预渲染字面路由与 `prerenderPaths`（数组/异步函数、对象条目可每页关闭），执行 clientLoader/serverLoader、写入 hydration 与 head，跳过 Response/≥400，`prerenderIgnoreErrors` 跳过单页异常，`prerenderIncremental` 跳过未变化 HTML，可选 sitemap 并包含 app.base，`robots` 输出 robots.txt（`{{sitemap}}` 替换），`prerenderConcurrency` 支持并行渲染；`sitemapChunkSize` 分片并生成 `sitemap-index.xml`（robots 指向索引）；sitemap lastmod/压缩/按语言拆分待后续 | 静态导出插件 | F5 |
| U34 | MPA | 部分已有（F5q）：mpaPlugin 按 `src/pages` 顶层目录生成独立 HTML 与 React 入口，dev/build/preview 可用，与 SPA 共存；App/Provider 包装与热更新待后续（全局/页面级 layout 与自定义 HTML 模板已交付） | 独立 MPA profile | F5 |
| U35 | apiRoute | 部分已有（F5n）：apiRoutePlugin 将 `src/api/**` 的 Fetch 处理器注册为路由，dev 由 Vite 中间件运行、build 用 esbuild 编译、preview 提供编译产物；独立生产服务、中间件链与流式响应待后续 | 独立服务端路由插件 | F5 |
| U36 | qiankun、Module Federation | 待实现 | 可选主/子应用与 federation adapter | F6 |
| U37 | dva、valtio、react-query | 部分已有（F6-1）：可选 `@cormijs/plugin-react-query` 挂载 `QueryClientProvider`，应用直接使用 `@tanstack/react-query`；dva/valtio 未实现 | 各状态库/服务端状态 adapter | F6 |
| U38 | analytics、moment2dayjs、confetti 等官方插件 | 部分已有（F5h）：可选 analyticsPlugin 在路由变化时发送 GA4 `page_view` 与 `cormi:pageview`（不注入脚本、不做 consent）；moment2dayjs/confetti 等仍未移植 | 独立可选插件 | F6 |
| U39 | analyze、MFSU、depsOnDemand、esmi 等优化 | 部分有 Vite 原生优化；无 Umi 功能等价结论 | 构建优化插件，按真实后端分别验证 | F6 |
| U40 | webpack/Vite/Mako/Utoopack/bundler 选择 | 只有 Vite 实现；契约可替换不等于多后端已实现 | 独立 builder provider/preset | F6 |
| U41 | monorepo redirect/phantomDependency/overrides/check | 部分已有包边界校验，非 Umi 等价全套 | 工程/依赖策略插件 | F4/F6 |
| U42 | clickToComponent/devTool/terminal/UI/aiDev/stagewise/hmrGuardian | 库存已登记，细节待各项源码/使用流程核对 | 可选开发工具插件，不进内核 | F6 |
| U43 | lowImport/okam/classPropertiesLoose 及其他版本特定入口 | 只确认登记，不根据名字猜行为 | 在该后端/转换领域逐项决定 | F6 |

Umi 文档与源码的来源定位，见下一节及机器库存。F1/F4 的基础配置项在阻塞首批应用时前移，不把“一次做完所有配置项”作为前置。模型、权限、国际化等条目的“待实现”基于当前包/运行时/贡献接口核对，不根据几百项测试的总数推导完成率。

### 已交付索引（2026-10-21，按切片顺序）

| 切片 | 提交 | 能力 | 文档 |
| --- | --- | --- | --- |
| F1a–F1f | 早期提交 | app runtime、配置式路由、redirect/wrappers、全局布局、404/loading、history | docs/60–65 |
| F2a–F2c | 早期提交 | model、initial-state、request/useRequest | docs/66–68 |
| F3a–F3e | 早期提交 | locale、access、menu/面包屑、路由守卫、自定义 403 | docs/69–73 |
| F4a | b72593a 前 | HTML head | docs/74 |
| F4b | b72593a | Mock 目录约定 | docs/75 |
| F4c | 69d35d0 | 路径别名 | docs/76 |
| F4d | 4d86029 | 编译期常量与内置 `@` | docs/77 |
| F4e | 3ee2dda | headScripts/scripts | docs/78 |
| F4f | 75bbd67 | 全局样式约定 | docs/79 |
| F4g | b3574bf | `src/access.ts` 约定 | docs/80 |
| F4h | 95a46a3 | 消息目录 | docs/81 |
| F4i | 49255c8 | 菜单折叠与目录化标题 | docs/82 |
| F5a/F5b | 30e556d、586ddc3 | clientLoader 与错误边界 | docs/83 |
| F5c | cf1637f | 路由级 `meta.head` | docs/84 |
| F5d/F5g | 5198867、6241abf | 路由预取（手动/空闲/意图） | docs/85 |
| F5e | a25e9c5 | 静态导出外壳 | docs/88 |
| F5f | ac9b43d | 数字/日期/复数格式化 | docs/89 |
| F5h | a6924fa | GA4/自定义 pageview | docs/90 |
| F5i | 331a445 | lint/format 包装命令 | docs/91 |
| F5j | 78d518f | 约定式 clientLoader 识别 | docs/92 |
| F5k | f82c2e3 | locale key 类型 | docs/93 |
| F5l | 803bf94 | ICU 消息子集 | docs/94 |
| F5m | 8a91da3 | 相对时间格式化 | docs/95 |
| F5n | 13e8270 | 生产 API 路由 | docs/96 |
| F5o | 875f2be | ICU 富文本消息 | docs/97 |
| F5p | 125e037 | 视口可见预取 | docs/98 |
| F5q | 74d0b3a | 目录约定 MPA | docs/99 |
| F5r | 61cf848 | API/Mock 生成器 | docs/100 |
| F5s | a200b8c | 开发与预览代理 | docs/101 |
| F5t | 06f9623 | 路由 JSON-LD | docs/102 |
| F5u | 1a2dbb8 | loader 返回类型 | docs/103 |
| F5v | 65120e9 | 重导出 clientLoader 识别 | docs/104 |
| F5w | bb1a8c5 | 自定义生成模板 | docs/105 |
| F5x | f97adb0 | `<Helmet>` 组件级 head | docs/106 |
| F5y | 5cc6c4f | SSR（dev/preview + hydration） | docs/107 |
| F5z | d27c980 | 独立 serve 命令 | docs/108 |
| U17-1 | edf6d6e | Antd/ProLayout 菜单适配器 | docs/109 |
| U17-2 | 9acec53 | 可选 ProLayout 外壳 | docs/134 |
| U17-3 | 3d469c7 | 菜单图标注册表 | docs/135 |
| U17-4 | 5120373 | ProLayout 主题编辑器 | docs/142 |
| U17-5 | 5120373 | 图表集成验证 | docs/143 |
| F6-1 | b873e99 | React Query 适配 | docs/144 |
| U17-6 | 1f0e755 | ClientOnly 图表 SSR 边界 | docs/145 |
| U12-7 | bfd60d4 | 游标分页 | docs/133 |
| U12-8 | 4c72183 | 尾调用节流 | docs/136 |
| U33-7 | 7b9e44c | sitemap 分片与索引 | docs/137 |
| U12-9 | ab70c4c | GET 缓存持久化 | docs/138 |
| U12-10 | 09f4cd7 | 防抖 maxWait | docs/139 |
| U12-11 | 76b99fd | 防抖 leading/trailing | docs/140 |
| U12-12 | 7fe916d | 跨标签页缓存失效 | docs/141 |
| F4m | abbe5aa | CSS Modules/资源类型声明 | docs/110 |
| U16-1 | ba6ea1f | locale 变更订阅 | docs/111 |

最新冻结验证（2026-10-22）：`pnpm check` 572/572、`pnpm test:browser` 56/56、`pnpm test:package` 359 阶段通过；证据见 `artifacts/u17-7-prolayout-locale-validation.json`、`artifacts/u17-6-chart-ssr-validation.json`、`artifacts/f6-react-query-validation.json`、`artifacts/u17-5-charts-validation.json`、`artifacts/u17-4-theme-editor-validation.json`、`artifacts/u12-12-cross-tab-cache-validation.json`、`artifacts/u12-11-debounce-edges-validation.json`、`artifacts/u12-10-debounce-maxwait-validation.json`、`artifacts/u12-9-cache-persistence-validation.json`、`artifacts/u33-7-sitemap-index-validation.json`、`artifacts/u12-8-trailing-throttle-validation.json`、`artifacts/u17-3-menu-icons-validation.json`、`artifacts/u17-2-pro-layout-validation.json`、`artifacts/u12-7-cursor-pagination-validation.json`、`artifacts/u33-6-prerender-concurrency-validation.json`、`artifacts/u33-5-robots-validation.json`、`artifacts/u12-6-throttle-validation.json`、`artifacts/u09-4-selector-equality-validation.json`、`artifacts/u33-4-prerender-control-validation.json`、`artifacts/u12-5-debounce-validation.json`、`artifacts/u17-antd-validation.json`、`artifacts/u12-4-cache-tags-validation.json`、`artifacts/u16-2-rtl-validation.json`、`artifacts/u33-3-dynamic-paths-validation.json`、`artifacts/u09-3-dependencies-validation.json`、`artifacts/u12-3-cache-validation.json`、`artifacts/u16-ui-locale-validation.json`、`artifacts/u12-2-pagination-validation.json`、`artifacts/u09-2-subscriptions-validation.json`、`artifacts/u12-request-retry-validation.json`、`artifacts/u09-object-models-validation.json`、`artifacts/u32-streaming-validation.json`、`artifacts/u33-2-prerender-paths-validation.json`、`artifacts/u33-prerender-validation.json`、`artifacts/u32-server-loader-validation.json` 及此前的 f4a…f5z、u16、u17、f4m、f5e 产物。仍未覆盖的大项见 F6、U09 热替换、U16 按请求 locale/RTL 样式、SSR 生产化与 U33 lastmod/压缩；逐项完成度见 [路线完成度审计](112-roadmap-audit-2026-10-21.md)。最新特性提交 1f0e755（U17 ClientOnly 图表 SSR 边界）。

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
**U09-1 状态（2026-10-22）：** 对象模型已交付：默认导出 `{ state, reducers, effects }`（可用 `defineModel` 推断类型），store 按挂载创建，`useModel` 通过 `useSyncExternalStore` 订阅；reducer 必须返回新 state，effect 获得 `put/call/state`，`put` 可派发其他对象模型；`useModelDispatch(namespace)` 绑定派发，`useGlobalModelDispatch()` 使用 `namespace/action`。Hook 模型与对象模型共存；仍无 subscriptions、extraModels、依赖排序、effect 取消与状态持久化。用法与边界见 [U09-1 对象模型](116-u09-object-models.md)。
**U09-2 状态（2026-10-22）：** 对象模型 `subscriptions` 已交付：挂载后执行，可返回清理函数，收到 dispatch/state；SSR 不执行，错误记录不阻断应用。`modelPlugin.extraModels` 可追加目录外模型文件，参与生成、类型检查、观察与 inspect，namespace 仍按路径派生。仍无跨模型依赖排序与选择器等值优化。用法与边界见 [U09-2 subscriptions/extraModels](118-u09-subscriptions-extra-models.md)。
**U09-3 状态（2026-10-22）：** 对象模型 `dependencies` 与初始化顺序已交付：`modelInitializationOrder` 做稳定拓扑排序，Provider 先创建全部 store，再按依赖顺序启动 subscriptions；缺失依赖/自依赖/循环以 `MODEL_DEPENDENCY_*` 失败。subscription 的裸 dispatch 作用于本模型，带 namespace 的动作走全局。仍无异步依赖、热替换保留 store 或选择器等值优化。用法与边界见 [U09-3 依赖排序](122-u09-model-dependencies.md)。
**U09-4 状态（2026-10-22）：** `useModel(namespace, selector, isEqual?)` 等值优化已交付：默认 Object.is，可传自定义比较；选择结果相等时不通知/重渲染，派生对象需显式 isEqual。Hook 模型无 store，不适用该优化。仍无热替换保留 store 或默认深比较。用法与边界见 [U09-4 选择器等值](129-u09-selector-equality.md)。

**F2b 状态（2026-10-20）：** U10 的初始状态基础已交付：`initialStatePlugin` 登记 `getInitialState` 与 runtime Provider，`useInitialState` 提供 loading/error/data、refresh 和 setInitialState；首次渲染不阻塞，卸载与并发刷新有防护。`@@initialState` 模型集成、首屏阻塞与 SSR/hydration 仍待后续。用法、差异与验证见 [F2b getInitialState](67-f2b-initial-state.md)。

**F2c 状态（2026-10-20）：** U11/U12 的请求基础已交付：`requestPlugin` 注册 request 配置和每挂载 fetch 客户端；`useRequest` 支持自动/手动、loading/error/data、refresh、cancel、HTTP 错误和 generation 竞态保护。拦截器、统一错误协议、重试/轮询/分页仍待后续。用法、差异与验证见 [F2c request 与 useRequest](68-f2c-request.md)。F2 基础链路（初始状态 → 共享模型 → 请求）已具备。
**U12-1 状态（2026-10-22）：** `useRequest` 补齐 `retry`/`retryDelay`、成功后 `pollingInterval`（含 `pollingWhenHidden`）与 `refreshDeps`；重试/轮询在取消、卸载和竞态替换时停止，最终失败才写 error/onError，非法选项以 `REQUEST_INVALID` 失败。仍无分页/加载更多、缓存/去重与防抖节流。用法与边界见 [U12-1 请求自动化](117-u12-request-retry-polling.md)。
**U12-2 状态（2026-10-22）：** `usePagination` 已交付：首屏加载、`loadMore` 追加、`hasMore`（显式/total/pageSize 推断）、`reload` 替换、`merge` 自定义合并、`cancel` 与卸载中止；同一时刻只允许一个分页请求，错误保留已有列表。仍无游标分页、缓存/去重、防抖节流与 SSR 注水。用法与边界见 [U12-2 分页](119-u12-pagination.md)。
**U12-3 状态（2026-10-22）：** GET 短缓存已交付：`RequestOptions.cacheTime`（0–3600000ms）按 method+URL+headers 缓存，`cacheBust` 跳过读取且不写入；同键并发共享一个请求。缓存属于单个请求客户端实例，无容量/LRU、按标签失效、SWR 或持久化。用法与边界见 [U12-3 请求缓存](121-u12-request-cache.md)。
**U12-4 状态（2026-10-22）：** 缓存容量与失效已交付：`RequestConfig.cacheLimit`（1–10000，默认 100）按最近使用淘汰，命中会刷新 LRU 顺序；`cacheTags` 标记缓存，`invalidateCache(tags?)` 返回删除数量并支持清空全部。仍无后台过期清理、标签通配、持久化与在途请求取消。用法与边界见 [U12-4 缓存容量](125-u12-cache-tags.md)。
**U12-5 状态（2026-10-22）：** `useRequest` 的 `debounceWait` 已交付：窗口内 run/refresh 合并为一次请求，被合并调用立即解析 undefined；初始自动请求与 refreshDeps 也经过防抖，轮询绕过防抖保持节奏；取消/卸载清理计时器。仍无 leading/maxWait、throttle 或服务端去重。用法与边界见 [U12-5 防抖](127-u12-debounce.md)。
**U12-6 状态（2026-10-22）：** `useRequest.throttleWait` 前沿节流已交付：窗口内后续 run/refresh 立即解析 undefined，轮询绕过节流，与 debounceWait 互斥；cancel 重置窗口。无 trailing/maxWait。用法与边界见 [U12-6 节流](130-u12-throttle.md)。
**U12-7 状态（2026-10-22）：** `useCursorPagination` 已交付：无游标首载、`nextCursor` 追加、hasMore 推断、reload/cancel、单请求并发保护与 merge；无双向游标、缓存或自动去重。用法与边界见 [U12-7 游标分页](133-u12-cursor-pagination.md)。
**U12-8 状态（2026-10-22）：** 尾调用节流已交付：`throttleLeading`（默认 true）/`throttleTrailing`（默认 false）支持前沿、尾调用与仅尾调用；窗口内被丢弃调用合并为窗口结束的一次执行，排队 Promise 共享结果；非法组合与并发竞态语义已明确。无 maxWait、按参数分键或缓存持久化。用法与边界见 [U12-8 尾调用节流](136-u12-trailing-throttle.md)。
**U12-9 状态（2026-10-22）：** GET 缓存持久化已交付：`cachePersist: 'session' | 'local'` 与 `cachePersistKey` 把 `cacheTime` 内的 GET 条目写入 Web Storage，刷新后继续命中；加载过滤过期/损坏数据，`invalidateCache` 同步清理，容量仍受 `cacheLimit` 约束。仅 JSON 数据、无加密/跨标签页同步/容量估算；不持久化非 GET、失败或 cacheBust。用法与边界见 [U12-9 缓存持久化](138-u12-cache-persistence.md)。
**U12-10 状态（2026-10-22）：** 防抖 maxWait 已交付：`debounceMaxWait`（1–60000ms，需 debounceWait）将合并执行截止时间限制为 `min(now+wait, burstStart+maxWait)`；持续触发时按上限执行一次并开始新 burst，未设置时保持原防抖行为。无 leading/trailing 开关或自定义防抖键。用法与边界见 [U12-10 防抖 maxWait](139-u12-debounce-maxwait.md)。
**U12-11 状态（2026-10-22）：** 防抖边沿已交付：`debounceLeading`（默认 false）/`debounceTrailing`（默认 true）支持仅前沿、仅尾调用与前沿+尾调用；burst 内后续调用按尾调用合并，仅前沿时窗口内调用丢弃；两者都关闭会以 `REQUEST_INVALID` 失败。无自定义防抖键或跨组件共享。用法与边界见 [U12-11 防抖边沿](140-u12-debounce-edges.md)。
**U12-12 状态（2026-10-22）：** 跨标签页缓存失效已交付：持久化载荷带 epoch；`invalidateCache` 实际删除条目后递增 epoch 并写回，其他同源标签页收到 storage 事件时清空内存缓存。监听由 `activate`/`dispose` 管理，`RequestProvider` 负责挂载/卸载；只传播失效、不复制数据，接收端保守清空全部缓存。用法与边界见 [U12-12 跨标签页缓存](141-u12-cross-tab-cache.md)。

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

**F5b 状态（2026-10-20）：** U13 的错误呈现缺口已闭环：loader 从 `lazy()` 返回值改为路由的静态属性，修复了“loader 抛错后 lazy 未合并、匹配被截断到根路由而整页空白”的行为；错误现在落到该路由自己的 `errorBoundary`（导航与深链接一致），`useClientLoaderError` 可读取原始错误对象。代价是页面模块被 loader 与 lazy 各导入一次（浏览器模块缓存复用），约定式路由识别、类型生成与预取仍待后续。见 [F5a 路由 client loader](83-f5a-client-loader.md)。

**F5c 状态（2026-10-20）：** U21 的配置侧能力已交付：`headPlugin` 注册 `routeHeadRuntime`，每次导航合并根→深的 `meta.head`（标题取最深、meta 按 name/property 覆盖、link 按 rel+href 去重），写入带 `data-cormi-head` 标记的受管节点，卸载时移除并恢复挂载时标题；运行时 `onRouteChange` 新增可选 `{options, signal}` 第三参数（向后兼容）。`<Helmet>` 式组件、JSON-LD、多语言标题与 SSR 头部收集仍待后续。用法、差异与验证见 [F5c 路由级页面头部](84-f5c-route-head.md)。

**F5d 状态（2026-10-20）：** U31 的模块预取已交付：生成入口为每个带模块的路由生成惰性注册表并传给 `mountApplication`，`routePrefetchPlugin` 提供 `usePrefetch()`（`ids`/`prefetch`/`prefetchAll`，在途复用、失败返回 false）与 `mode: "idle"` 的空闲全量预热（`requestIdleCallback`，2 秒超时，卸载取消）。链接 intent/视口预取、client loader 数据预取与 SSR 侧预取仍待后续。用法、差异与验证见 [F5d 路由预取](85-f5d-route-prefetch.md)。

**F4j 状态（2026-10-20）：** U25 的构建输出能力已交付：可选 `outputPlugin` 在 `closeBundle` 把项目内文件/目录复制进输出目录（路径与符号链接校验、默认目标为 basename），并用 `hash:false` 生成稳定资源名（保留 `assets/` 目录，与自定义命名冲突时失败）；复制只在构建发生，preview 直接提供复制后的文件。externals、runtimePublicPath、CDN 与按 chunk 命名策略仍待后续。用法、差异与验证见 [F4j 构建输出策略](86-f4j-output-policy.md)。

**F4k 状态（2026-10-20）：** U27 的首批生成器已交付，同时把 CLI 的入参协议扩展为「命令 + 至多 32 个位置参数」（`CommandRequest.positionals` 经 CLI → supervisor → worker 传递，全局选项仍严格）。`generatorPlugin` 注册 `generate` 命令，内置 page/component/model 模板，默认拒绝覆盖、`--force` 覆盖、`--dry-run` 只返回计划，名称与路径校验齐全。mock/API 生成器、模板贡献面与交互式提问仍待后续。用法、差异与验证见 [F4k 微生成器](87-f4k-generator.md)。

**F5e 状态（2026-10-20）：** U33 的第一步已交付：`staticExportPlugin` 在构建后读取路由 IR，为字面路径的模块路由生成 `dist/<path>/index.html`，按运行时相同规则合并祖先 `meta.head` 并追加 `titleTemplate`；`/` 的 head 写回 `dist/index.html`，动态段/catch-all/redirect 跳过。外壳不是预渲染：没有 SSR 内容与数据，静态页面仍依赖 JS 挂载。prerender、404.html 与 SSR 组合仍待后续。用法、差异与验证见 [F5e 静态导出](88-f5e-static-export.md)。

**F5f 状态（2026-10-20）：** U16 的格式化部分已交付：`useIntl()` 新增 `formatNumber`、`formatDate` 与复数感知的 `tp`；复数类别由 `Intl.PluralRules` 决定，消息按 `${key}_${category}` → `${key}_other` → `${key}`（含 fallback 语言）解析，插值与既有 `t` 一致；纯函数 `formatNumberFor`/`formatDateFor`/`selectPluralKey` 从 `@cormijs/runtime` 导出。ICU 复数语法、相对时间、富文本与 locale key 类型仍待后续。用法、差异与验证见 [F5f 格式化与复数](89-f5f-locale-formatting.md)。

**F5g 状态（2026-10-20）：** U31 的意图预取已交付：`usePrefetchOnIntent(id, { delayMs })` 提供 `onMouseEnter`/`onFocus` 延迟加载与 `onMouseLeave`/`onBlur` 取消（默认 50ms，0–5000 校验），复用既有注册表与在途 Promise；浏览器用例验证悬停即取模块且随后导航正常。视口触发、数据预取与 SSR 侧预取仍待后续。见 [F5d 路由预取](85-f5d-route-prefetch.md)。

**F5h 状态（2026-10-20）：** U38 的 analytics 已交付：`analyticsPlugin` 在每次路由变化（含首屏）发送 page-view；配置 `measurementId` 时维护 GA4 `dataLayer`/`gtag` 队列并发送 `page_view`（`page_path` 含 base、referrer 为上一个实际路径），`dispatch: true` 时额外发出 `cormi:pageview`（detail 中的 `path` 不含 basename）。不注入第三方脚本、不做 Cookie 同意；其他官方插件仍未移植。用法、差异与验证见 [F5h pageview 分析](90-f5h-analytics.md)。

**F5i 状态（2026-10-20）：** U28 的最小形态已交付：`toolPlugin` 注册 `cormi lint`/`cormi format`，从项目 `node_modules/.bin` 解析二进制（默认 eslint/prettier），位置参数透传、输出转发 stderr、`TOOL_MISSING`/`TOOL_FAILED`/`TOOL_CANCELLED` 语义明确，不安装依赖也不生成配置。文件发现、stylelint/utoo 模式与 precommit/deadcode 仍待后续。用法、差异与验证见 [F5i 工程命令](91-f5i-tool-commands.md)。

**F5j 状态（2026-10-20）：** U13 的约定式识别已交付：`detectClientLoader` 在去除注释/字符串后的源码上识别页面导出的 `clientLoader`（function/async function/const），`pageLoaders` 读取页面源并在 `routesFromFiles` 装配进 IR；配置式路由继续用显式字段（F5a）。重导出、loader 数据类型生成与 SSR 侧 loader 仍待后续。用法、差异与验证见 [F5j 约定式 loader](92-f5j-conventional-loader.md)。

**F5k 状态（2026-10-20）：** U16 的类型部分已交付：启用 `src/locales` 目录时生成 `.cormi/locale.d.ts`，提供 `CormiLocale.Code` 与 `CormiLocale.MessageKey` 字面量联合（排序、去重、JSON 转义；无目录时为 `never`），并加入类型检查生成输入白名单；运行时 `t`/`tp` 仍收 `string`，内联消息不参与生成。ICU、相对时间、富文本与 UI 联动仍待后续。用法、差异与验证见 [F5k locale 类型](93-f5k-locale-types.md)。

**F5l 状态（2026-10-21）：** U16 的 ICU 子集已交付：零依赖的 `formatIcu` 支持 `{name}`、`number/date/time`（`integer`/`percent` 与 `short`–`full` 样式）、`plural`/`selectordinal`/`select`（可嵌套、`offset:N`）、`#` 与单引号字面量；`=N` 匹配原始值，offset 只影响类别与 `#`（与 FormatJS 10.7.18 一致）。`t()` 在传值时使用该解析器，`tp()`/`FormattedMessage` 随之获得 ICU 能力；未传值时 `t` 仍原样返回目录文本，缺失简单参数保留 `{name}`，格式化/选择参数缺失或语法错误抛 `LOCALE_INVALID`。富文本标签见 F5o、货币/骨架格式与编译期消息校验仍待后续（相对时间见 F5m）。用法、差异与验证见 [F5l ICU 子集](94-f5l-icu.md)。

**F5m 状态（2026-10-21）：** U16 的相对时间已交付：`useIntl().formatRelativeTime` 与纯函数 `formatRelativeTimeFor` 基于平台 `Intl.RelativeTimeFormat`，跟随当前语言与切换，支持 `numeric: 'auto'` 等 options；`value` 必须有限，`unit` 限合法单位，非法输入抛 `LOCALE_INVALID`。时间差由调用方计算，格式化不读取当前时间、不自动刷新；富文本见 F5o，Antd/dayjs 语言联动见 U16-1。用法、差异与验证见 [F5m 相对时间](95-f5m-relative-time.md)。
**U16-1 状态（2026-10-22）：** UI locale 连接层已交付：`normalizeLocaleTag` 统一标签，`localeCandidates`/`dayjsLocaleCandidates` 给出回退链，`resolveLocaleResource` 归一化资源键并按链匹配，`useLocaleResource` 随当前 locale 重新渲染；应用提供 Antd locale 对象或 dayjs 加载函数，cormi 不分发这些依赖。未提供 Script→Region 官方别名表、RTL、主题、按请求 locale 或 Antd 组件封装。用法与边界见 [U16-1 UI locale](120-u16-ui-locale.md)。
**U16-2 状态（2026-10-22）：** `localeDirection` 已交付：基于语言表检测 RTL（ar/he/fa/ur 等），支持归一化键覆盖；`useLocaleResource` 返回 `direction`，可传给 Antd ConfigProvider 或根节点 dir。不提供 RTL 样式、组件封装、CLDR 数据或请求 locale 协商。用法与边界见 [U16-2 RTL](124-u16-rtl.md)。

**F5n 状态（2026-10-21）：** U35 的第一个完整形态已交付：`apiRoutePlugin`（`cormi:api`，`inject: ['vite']`）把 `src/api/**` 的默认导出 Fetch 处理器映射为 `[param]` 路由；开发期由 Vite 中间件经 `ssrLoadModule` 运行，构建期用 esbuild 打包到 `dist/.cormi/api` 并写 manifest，预览期从 manifest 动态导入；请求/响应各 1 MiB/8 MiB 上限，错误返回稳定的 JSON 码而不泄漏细节，`/.cormi/*` 被拒绝。新增/删除路由文件需重启、无中间件链/流式响应/独立生产服务。用法、差异与验证见 [F5n API 路由](96-f5n-api-routes.md)。

**F5o 状态（2026-10-21）：** U16 的富文本已交付：ICU 消息中的 `<tag>` 在显式提供渲染器时由 `useIntl().rich()`/`FormattedMessage.tags` 渲染为 React 节点，支持嵌套、标签内 ICU 参数与 `#`；`t()`/`tp()` 仍把标签当普通文本，未列出/错配/未闭合标签抛 `LOCALE_INVALID`，纯函数 `formatIcuParts`/`richNodes` 可脱离 React 使用。富文本只支持成对字母数字标签、无属性/HTML 字符串，`defaultMessage` 在 `tags` 模式不生效。U16 剩余 Antd/dayjs 语言联动。用法、差异与验证见 [F5o 富文本消息](97-f5o-rich-text.md)。

**F5p 状态（2026-10-21）：** U31 的视口触发已交付：`usePrefetchOnVisible(id, { rootMargin, threshold, delayMs })` 返回 ref 回调，元素首次进入视口后经注册表预取路由模块并断开观察；ref 变化/卸载释放观察器与定时器，无 `IntersectionObserver` 时为空操作，参数越界抛 `PREFETCH_INVALID`。只预取模块，不预取 loader 数据。用法、差异与验证见 [F5p 视口预取](98-f5p-viewport-prefetch.md)。

**F5q 模板增量（2026-10-21）：** MPA 支持插件级自定义 HTML 模板（项目内真实文件、≤1 MiB），要求 `{{mountElementId}}` 与 `{{entry}}` 占位符，`{{title}}` 转义；与 layout 组合生成多页入口。

**F5q layout 增量（2026-10-21）：** MPA 支持插件级与 `config.json.layout` 页面级 React 布局包装（项目内源码、真实文件校验，页面覆盖全局），入口生成 `<Layout><Page /></Layout>`；App/Provider 包装与热更新仍待后续。

**F5q 状态（2026-10-21）：** U34 的目录约定 MPA 已交付：`mpaPlugin` 把 `src/pages` 顶层目录（含可选 `config.json` 的 title/mountElementId）生成为独立 `<name>.html` 与 React 入口；dev 通过内部重写提供，build 以 Vite 多 HTML 输入构建并把页面移到 `dist/<name>.html`，preview 直接静态提供；`index` 保留给 SPA，页面不继承 SPA 路由/Provider，App/Provider 包装与热更新待后续（全局/页面级 layout 与自定义 HTML 模板已交付）。用法、差异与验证见 [F5q MPA](99-f5q-mpa.md)。

**F5r 状态（2026-10-21）：** U27 的 API/Mock 模板已交付：沿用 `generatorPlugin` 与「命令+位置参数」协议，`generate api <name>` 写 `src/api/<name>.ts`（Fetch 骨架），`generate mock <name>` 写 `mock/<name>.ts`（`GET /api/<name>` 示例）；覆盖/试运行/路径限制沿用既有规则，生成器不注册路由或 Mock，文件由 `apiRoutePlugin`/`mockPlugin` 按约定发现。模板贡献与交互式提问仍待后续。用法、差异与验证见 [F5r API/Mock 生成器](100-f5r-generators.md)。

**F5s 状态（2026-10-21）：** U18 的代理已交付：`proxyPlugin`（`cormi:proxy`，`inject: ['vite']`）接受 1–32 个路径前缀到 http(s) 上游的映射，校验前缀/目标/布尔选项，合并进 Vite 的 `server.proxy` 与 `preview.proxy`；开发与预览一致，构建产物不含代理，生产仍需网关。rewrite 函数、headers 与凭据被拒绝/未提供。用法、差异与验证见 [F5s 代理](101-f5s-proxy.md)。

**F5t 状态（2026-10-21）：** U21 的 JSON-LD 已交付：路由 `meta.head.jsonLd`（对象或 ≤32 个对象）经 `headPlugin` 同步为受管 `<script type="application/ld+json" data-cormi-head>`，最深路由整体替换祖先块，切换/卸载移除；`staticExportPlugin` 把同一数据写入静态 HTML 外壳。只接受 ≤64 KiB 的 JSON 数据，`<` 序列化为 `\u003c` 防闭合脚本；`<Helmet>` 组件与 SSR 头部收集仍待后续。用法、差异与验证见 [F5t JSON-LD](102-f5t-json-ld.md)。

**F5u 状态（2026-10-21）：** U13 的类型部分已交付：编译生成 `.cormi/loaders.d.ts`，按路由 id 暴露 `Awaited<ReturnType<clientLoader>>` 为 `CormiLoaderData.Data<'id'>`，加入 typecheck 生成输入白名单；没有 loader 时为空接口/`never`，删除 loader 导出会在 typecheck 中暴露。运行时 `useClientLoaderData<T>()` 不变；重导出识别、数据预取与 SSR loader 仍待后续。用法、差异与验证见 [F5u loader 类型](103-f5u-loader-types.md)。

**F5v 状态（2026-10-21）：** U13 的重导出识别已交付：词法扫描在原有函数/const 形式之外识别静态 `export { … }` 与 `export { … } from '…'` 值导出（含 `x as clientLoader`），`export type` 与 `clientLoader as other` 不计入；生成入口仍调用页面的 `clientLoader` 绑定，`loaders.d.ts` 通过页面导出得到正确返回类型。`export *`/运行时拼接仍不支持。用法、差异与验证见 [F5v 重导出 loader](104-f5v-reexport-loaders.md)。

**F5w 状态（2026-10-21）：** U27 的模板贡献面已交付：`generatorPlugin` 的 `templates` 接受最多 16 个 `{ path, content }` 静态模板，支持 `{{name}}`/`{{kebab}}`/`{{pascal}}` 占位符，禁止覆盖内置类型与写入 `node_modules/.git/.cormi/.env*/cormi.config.ts` 等受保护路径；覆盖、试运行与项目内校验沿用原生成器。交互式提问、模板函数与目录树模板仍待后续。用法、差异与验证见 [F5w 自定义生成模板](105-f5w-generator-templates.md)。

**F5x 状态（2026-10-21）：** U21 的组件 API 已交付：`@cormijs/runtime` 导出 `<Helmet>`、`HeadProvider` 与 `headRuntime`，headPlugin 的 runtime 贡献改为带 Provider；页面组件可声明 title/metas/links/jsonLd，按路由 head→组件挂载顺序合并（标题/JSON-LD 后者胜、meta/link 按选择器替换），卸载/导航移除受管节点，首帧用当前地址 seed 路由 head。对象 props API，SSR 头部收集仍待后续。用法、差异与验证见 [F5x Helmet](106-f5x-helmet.md)。

**F5y head 增量（2026-10-21）：** SSR 渲染后收集路由 `meta.head` 与页面 `<Helmet>` 条目，合并 titleTemplate，并把 title/meta/link/JSON-LD 以受管标签写入 shell（dev/preview/serve 共用），客户端 hydration 后接管；SEO 首屏与服务端渲染一致。

**U16 增量状态（2026-10-21）：** 新增 `useIntl().subscribe(listener)` 与浏览器 `cormi:localechange` 事件（detail `{locale, previous}`），在 `setLocale` 成功后同步通知，供 dayjs/Antd 联动；监听器异常隔离，Provider 卸载清空。框架不引入这些 UI 库，初始挂载不回调。用法、差异与验证见 [U16 locale 订阅](111-u16-locale-subscription.md)。

**U17 增量状态（2026-10-21）：** 新增无 UI 库依赖的菜单适配器：`toAntdMenuItems`（key=path、label=本地化标题、routeId、children）与 `toLayoutRoutes`（path/name/routes），供应用传给 Antd Menu/ProLayout；不引入 antd/ProLayout，主题、图标、图表与 dayjs/Antd locale 联动仍待后续。用法、差异与验证见 [U17 菜单适配器](109-ui-menu-adapters.md)。
**U17-1 状态（2026-10-22）：** 可选 `@cormijs/plugin-antd` 已交付：通过 `ctx.react.runtime` 贡献 Antd `ConfigProvider`，用 U16 locale 回退链选择 11 个官方 Antd locale（含语言级别名），自动传入 RTL direction，支持 JSON 主题 token 与暗色算法；localePlugin 需先于 antdPlugin 挂载。安装 Antd 6.6.7 后在 dev/build/preview 与安装包消费中验证。未提供 ProLayout、图标/图表、主题编辑器、自定义 locale 对象或 Antd SSR 样式抽取；Antd 6 的部分声明需 `skipLibCheck`。用法与边界见 [U17-1 Antd](126-u17-antd.md)。
**U17-2 状态（2026-10-22）：** 可选 `ProLayoutShell` 与 `proLayoutPlugin` 已交付：shell 在应用的全局 layout 中读取 menuPlugin 的本地化菜单/折叠状态与当前路由，用 `<Link>` 做 SPA 导航并透传 title/logo/layout/fixedHeader/siderWidth；插件把 `@ant-design/pro-layout` 加入 Vite 预打包并校验 id。默认关闭 ProLayout 的 `breakpoint`，避免挂载时覆盖持久化折叠。ProLayout 7.22.7 仍声明 antd 4/5 peer，antd 6.6.7 组合已验证但严格 peer 安装需对该可选集成关闭校验；图表/主题编辑器/内置文案 locale/SSR 未覆盖。用法与边界见 [U17-2 ProLayout](134-u17-pro-layout.md)。
**U17-3 状态（2026-10-22）：** 菜单图标注册表已交付：`toLayoutRoutes(items, icons?)` 按 `meta.icon`（未设置时回退路由 id）解析 `icons` 自有键，`ProLayoutShell` 透传注册表；图标库由应用显式导入（验证用 `@ant-design/icons` 6.3.4），不引入自动发现/代码生成。用法与边界见 [U17-3 菜单图标](135-u17-menu-icons.md)。
**U17-4 状态（2026-10-22）：** ProLayout 主题编辑器已交付：`settingDrawer` 接入上游 SettingDrawer，`useProLayoutSettings` 提供 `settings/update/reset`，支持 layout/navTheme/colorPrimary/fixedHeader/fixSiderbar/siderWidth/contentWidth；`settingsStorageKey` 持久化到 localStorage，挂载后读取、忽略 SettingDrawer 首次默认同步，dark 主题同时作用于 Sider。仅 ProLayout 设置，不做全量 Antd token/服务端保存；SettingDrawer 在 antd 6 下有上游弃用警告。用法与边界见 [U17-4 主题编辑器](142-u17-theme-editor.md)。
**U17-5 状态（2026-10-22）：** 图表集成已验证：不新增 cormi 图表插件，应用直接安装 `@ant-design/plots` 2.6.8 并在页面渲染；dev/typecheck/build/preview 与安装包 charts consumer 均验证 canvas 输出。图表是应用依赖，主题联动由应用传给库的 theme；pnpm 隔离安装需显式 tslib 处理上游未声明依赖。用法与边界见 [U17-5 图表集成](143-u17-charts.md)。
**U17-6 状态（2026-10-24）：** 图表 SSR 边界已交付：`@cormijs/runtime` 导出 `<ClientOnly>`，服务端与 hydration 首帧渲染 fallback，effect 后才渲染浏览器内容；图表用 lazy import + Suspense + ClientOnly 组合，SSR HTML 无 canvas/图表模块执行，hydration 后绘制。无服务端图表渲染/数据快照，fallback 由应用提供。用法与边界见 [U17-6 图表 SSR](145-u17-chart-ssr.md)。
**U17-7 状态（2026-10-24）：** ProLayout 内置文案 locale 已交付：活动 cormi locale 映射到 ProLayout 的 zh-CN/zh-TW/en-US/it-IT/ko-KR，通过 `window.g_locale` + `languagechange` 同步主文案与 SettingDrawer，卸载/locale 切换恢复原值；`syncLocale={false}` 可关闭，`formatMessage` 覆盖主文案。只覆盖上游五个语言，SettingDrawer 不读取 formatMessage；`localStorage.umi_locale` 优先。用法与边界见 [U17-7 ProLayout locale](146-u17-prolayout-locale.md)。

**F5z 状态（2026-10-21）：** U32 的独立服务已交付：`servePlugin`（`cormi:serve`）注册 `cormi serve`，从已完成构建的 `dist` 读取 SSR bundle 与静态资产，原生 Node HTTP 服务对 HTML 导航执行 SSR/hydration、对静态请求做输出目录白名单式提供，支持 app.base 前缀；不启动 Vite，不执行 API/Mock/proxy，无流式、压缩或 TLS。用法、差异与验证见 [F5z cormi serve](108-f5z-serve.md)。
**U32-1 状态（2026-10-22）：** serverLoader 已交付：路由声明/约定导出 `serverLoader` 后，SSR 由 static handler 按匹配链执行并写入 hydration，客户端 hydration 不重复请求；客户端导航经 `<base>.cormi/server-loader` 端点回退取数，dev/preview/serve 均实现。serverLoader 与 clientLoader 互斥，需要 `app.ssr: true`；数据必须 JSON 可序列化，鉴权在 loader 内完成；不剥离页面源码，不提供流式。用法与边界见 [U32-1 serverLoader](113-u32-server-loader.md)。
**U32-2 状态（2026-10-22）：** 流式 SSR 已交付：`ssrPlugin`/`servePlugin` 的 `streaming: true` 使用 `renderToReadableStream`，shell 就绪后先发送 head 与同步外壳，Suspense 内容继续流入；React Router hydration script 从流末尾剥离并在挂载根之后写入。dev/preview/serve 一致；预渲染仍用缓冲渲染。无压缩/TLS/背压/代理缓冲与流中错误恢复。用法与边界见 [U32-2 流式 SSR](115-u32-streaming.md)。
**U33-1 状态（2026-10-22）：** 预渲染与 sitemap 已交付：`ssrPlugin` 的 `prerender: true` 在构建后用同一 SSR bundle 渲染字面路由，执行 clientLoader/serverLoader 并写入 hydration/head；`prerenderPaths` 枚举动态路径（对应 extraRoutePaths）；loader Response 或状态 ≥400 的页面跳过；可选 `sitemap` 输出带 app.base 的绝对 URL。构建同时保存 `dist/.cormi/shell.html`，preview/serve 不再复用被填满的 index.html。自动路径发现、增量和 robots 未提供。用法与边界见 [U33-1 预渲染](114-u33-prerender-sitemap.md)。
**U33-3 状态（2026-10-22）：** `prerenderPaths` 支持异步函数在生产阶段产出路径（构建时调用一次），`prerenderIgnoreErrors` 可将单页渲染异常记录到 skipped 并继续；默认仍严格失败，sitemap 只含成功页面。仍无每页关闭、并发渲染、增量与 robots。用法与边界见 [U33-3 动态路径](123-u33-dynamic-paths.md)。
**U33-4 状态（2026-10-22）：** 每页关闭与增量预渲染已交付：`prerenderPaths` 对象条目 `{path, prerender:false}` 跳过该路径；`prerenderIncremental` 在最终 HTML 未变化时不写文件，结果返回 `unchanged`，sitemap 仍包含。SSR 仍完整执行（不节省渲染时间），渲染仍顺序。用法与边界见 [U33-4 预渲染控制](128-u33-prerender-control.md)。
**U33-5 状态（2026-10-22）：** `robots` 选项在预渲染后写 `dist/robots.txt`，`{{sitemap}}` 替换为带 app.base 的绝对 sitemap URL；需要 prerender，占位需要 sitemap。无 sitemap index/动态 robots。用法见 [U33-5 robots](131-u33-robots.md)。
**U33-6 状态（2026-10-22）：** `prerenderConcurrency`（1–16，默认 1）支持并行预渲染，结果/sitemap 保持页面顺序；单页容错不终止其他 worker，未容错时首个异常停止调度并等待在途页面。无每页超时/取消或线程隔离。用法见 [U33-6 并发预渲染](132-u33-prerender-concurrency.md)。
**U33-7 状态（2026-10-22）：** sitemap index 已交付：`sitemapChunkSize`（1–50000）把预渲染 URL 按页面顺序拆成 `sitemap-N.xml`，写 base 感知的 `sitemap-index.xml` 并删除旧单文件；robots `{{sitemap}}` 指向索引；`PrerenderResult.sitemapChunks` 返回分片路径。无 lastmod/压缩/按语言拆分，也不清理切换分片大小后的旧分片。用法与边界见 [U33-7 sitemap index](137-u33-sitemap-index.md)。

**F5y 状态（2026-10-21）：** U32 的首个 SSR 切片已交付：应用设置 `app.ssr: true` 并启用 `ssrPlugin` 后，dev 通过 Vite `ssrLoadModule` 对 HTML 导航执行服务端渲染，build 用 Vite SSR 产出 `dist/.cormi/ssr/ssr.mjs` 供 preview 使用；两者都以 `createStaticHandler` 执行 client loader、注入 hydration 数据并由客户端 `hydrateRoot` 接管；hydration 前只解析当前匹配链的 lazy 组件，其他路由保持拆包；`app.base` 前缀由服务端剥离并以 basename 对齐。无 serverLoader、流式或独立 server 命令。用法、差异与验证见 [F5y SSR](107-f5y-ssr.md)。

### F3：权限、布局、菜单和国际化

access 对应 `packages/plugins/src/access.ts` 和 [权限文档](https://umijs.org/docs/max/access/)；useAccess/Access、access.ts、路由访问策略应随初始状态变化。按钮隐藏与路由阻止分别验证，服务端授权仍由后端实施。

layout/menu 对应 `packages/plugins/src/layout.ts`：菜单从路由元数据形成，覆盖嵌套、隐藏、选中、面包屑、layout:false、权限过滤和插槽。路由/菜单能力与 Antd/ProLayout adapter 分开，不能为了提供 layout 让每个应用强制依赖 Antd。应用可用自有布局。 官方 [图表文档](https://umijs.org/docs/max/charts/) 推荐按需安装 Ant Design Charts/Plots 等库；这类生态集成也纳入 U17，但不据此捏造一个固定 Max preset 中不存在的 charts 插件，更不自行重写图表库。

locale 对应 `packages/plugins/src/locale.ts` 与模板：消息发现、默认/回退语言、运行时切换、持久化、格式化和类型；菜单、标题及 UI 库语言联动通过可选 adapter 完成。实际测试两种语言、首次加载及动态切换，不只替换一段静态文案。

### F4：日常工程功能

补齐 Mock 目录、配置/alias/define 便利入口、HTML 注入、样式及资源、微生成器、lint/test 等应用工具。底层能力已有则复用，不再为框架自身完善构建恢复或通用诊断。配置选项需要归属特定后端时保持专属接口；不能把全部 Umi/webpack 配置类型塞进公共 BuildPlan。

### F5：加载与渲染模式

在共享应用功能后推进 client loader、路由预取/拆包策略、SSR、静态导出、MPA、生产 API route；U13 可因页面数据需求提前到 F3。各模式由插件/profile 组合，运行契约不同处不强行等同 SPA。SPA dist 复制成功不能作为 SSR/SSG 已完成的证据。

### F6：生态集成及其他后端能力

**F6-1 状态（2026-10-22）：** 可选 React Query 适配已交付：`reactQueryPlugin` 通过 runtime 贡献挂载 `QueryClientProvider`，应用直接使用 `@tanstack/react-query` 的 hooks；`defaults` 仅支持 staleTime/gcTime/retry/refetchOnWindowFocus 并由 Node 插件校验，QueryClient 每次应用挂载独立。无 query key 生成、SSR dehydration、devtools、持久化；dva/valtio、qiankun/MF、多 builder 仍待后续。用法与边界见 [F6-1 React Query](144-f6-react-query.md)。

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
