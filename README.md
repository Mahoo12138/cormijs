# cormi

以 Cordis 为插件宿主、以 Umi 的应用开发体验为参考的 TypeScript 应用框架。默认 React + Vite 由 preset 组合提供，core 不绑定 React 或 Vite。

**开发主线已调整（2026-10-20）：优先吸收 Umi 4 / Max 的应用功能，使用 Cordis 插件实现；构建中断恢复等外围深化暂停。** 具体差距、插件归属和顺序见 [Umi 功能吸收路线](docs/59-umi-feature-roadmap.md)。先补运行时约定/路由、数据流/初始状态、请求、权限、布局与国际化，再覆盖其他工程和渲染能力。本次是路线调整，不把计划中的功能写成已实现。

**当前已实现至 P16，并完成 Umi 吸收路线 F1a-F1f、F2a-F2c、F3a-F3e、F4a-F4k、F5a-F5i：应用运行时约定、配置式嵌套路由、redirect/wrappers、全局布局、404/loading、history/导航入口、model/useModel、初始状态、请求基础、locale、access、路由级访问守卫、自定义 403、菜单/面包屑、配置式 HTML head 与脚本注入、Mock 目录约定与路径别名、编译期常量、内置 `@` 别名、全局样式约定、`src/access.ts` 权限约定、`src/locales` 消息目录与菜单折叠/目录化标题、路由 client loader 与路由级页面头部、路由预取、构建输出策略、微生成器、静态导出外壳与数字/日期/复数格式化、pageview 分析与工程命令包装。** TypeScript领域插件支持solution/project references，用单次内存声明保留项目边界，不写业务编译输出；生成根有明确所属项目。typechecker服务与命令消费者使用原生Cordis组合，core和launcher不增加TS特例。应用可在显式启用的 `src/app.tsx` 中配置首屏初始化、根容器、路由调整和完整路由事件；也可显式启用 `routeConfigPlugin`，用嵌套 `routes` 声明布局、index、动态参数、meta、错误边界、`redirect`/`keepQuery`、`wrappers` 与 `access`，由插件展开为既有扁平 IR，并可用 `clientLoader` 声明页面级浏览器数据加载（`useClientLoaderData` 读取，loader 抛错由该路由的 `errorBoundary` 呈现）；`layoutPlugin` 可发现 `src/layouts/index.*` 并用 `layout:false` 支持顶层退出，根 `src/pages/404.tsx` 自动成为 catch-all，`loadingPlugin` 提供首次路由解析回退；`app.history` 支持 browser/hash/memory，导航与查询 Hook 从 `@cormijs/runtime` 统一导出；`modelPlugin` 可发现 `src/models/**`，通过 `useModel` 在挂载内共享 Hook 模型状态；`initialStatePlugin` 提供 `getInitialState`/`useInitialState` 的 loading、刷新与覆盖；`requestPlugin` 提供可配置 fetch 客户端与 `useRequest` 的自动/手动执行、取消、错误和竞态保护；`localePlugin` 提供 `useIntl`/`FormattedMessage`、切换与持久化，并可用 `directory` 构建期内联 `src/locales/<locale>.json` 消息目录；`accessPlugin` 基于初始状态提供 `useAccess`/`Access` 与路由 access 守卫，`accessForbidden` 可定制 403，权限函数可来自 `src/access.ts` 约定（`app.tsx` 显式配置优先）；`menuPlugin` 从实际路由树与 meta 生成 `useMenu`/`useBreadcrumb`/`useActiveMenuKeys` 并按 access 过滤，标题可用 `meta.locale` 取消息目录，`useMenuCollapse` 提供可持久化的折叠状态；`htmlPlugin` 可在 Vite 桥中配置 title/lang/meta/link/favicon 与受审查的 headScripts/scripts；`mockPlugin` 可发现 `mock/**` 并通过 DevApi 提供开发期自动重载 Mock；`aliasPlugin` 可声明项目内路径别名（可选内置 `@`→src）并合并进 Vite 解析器；`definePlugin` 注入在开发与构建阶段一致的编译期常量；`globalStylePlugin` 发现 `src/global.*` 约定并按 hook 顺序由生成入口副作用导入；`headPlugin` 按 `meta.head` 同步页面标题/meta/link（客户端）；`routePrefetchPlugin` 暴露路由模块注册表供手动或空闲预热；`outputPlugin` 可在构建后复制项目文件并关闭文件名哈希；CLI 支持「命令 + 位置参数」，`generatorPlugin` 提供 `cormi generate page|component|model`；`staticExportPlugin` 为每个字面路径路由输出带 `meta.head` 的 HTML 外壳（非预渲染）；`useIntl()` 提供 `formatNumber`/`formatDate`/`tp`；`usePrefetchOnIntent` 支持悬停/聚焦意图预取；`analyticsPlugin` 发送 GA4 `page_view` 与 `cormi:pageview`；`toolPlugin` 提供 `cormi lint`/`format` 包装。layout UI adapter 和可定制 403 将继续扩展。API、Umi 差异与当前边界见 [F1a](docs/60-f1a-app-runtime.md)、[F1b](docs/61-f1b-config-routes.md)、[F1c](docs/62-f1c-redirects-and-wrappers.md)、[F1d](docs/63-f1d-global-layout.md)、[F1e](docs/64-f1e-404-and-loading.md)、[F1f](docs/65-f1f-history-and-navigation.md)、[F2a](docs/66-f2a-models.md)、[F2b](docs/67-f2b-initial-state.md)、[F2c](docs/68-f2c-request.md)、[F3a](docs/69-f3a-locale.md)、[F3b](docs/70-f3b-access.md)、[F3c](docs/71-f3c-menu.md)、[F3d](docs/72-f3d-route-access.md)、[F3e](docs/73-f3e-custom-403-active-menu.md)、[F4a](docs/74-f4a-html-head.md)、[F4b](docs/75-f4b-mock.md)、[F4c](docs/76-f4c-alias.md)、[F4d](docs/77-f4d-define.md)、[F4e](docs/78-f4e-html-scripts.md)、[F4f](docs/79-f4f-global-styles.md)、[F4g](docs/80-f4g-access-convention.md)、[F4h](docs/81-f4h-locale-catalogs.md) 与 [F4i](docs/82-f4i-menu-collapse.md) 与 [F5a](docs/83-f5a-client-loader.md)、[F5b](docs/83-f5a-client-loader.md) 与 [F5c](docs/84-f5c-route-head.md) 与 [F5d](docs/85-f5d-route-prefetch.md) 与 [F4j](docs/86-f4j-output-policy.md) 与 [F4k](docs/87-f4k-generator.md) 与 [F5e](docs/88-f5e-static-export.md) 与 [F5f](docs/89-f5f-locale-formatting.md) 与 [F5h](docs/90-f5h-analytics.md) 与 [F5i](docs/91-f5i-tool-commands.md)。当前应用入口见 [应用开发指南](docs/49-application-guide.md)，项目引用配置见 [TypeScript协议](docs/57-typescript-projects.md)；高级引导/执行组合仍见 [引导插件](docs/53-bootstrap-plugins.md) 与 [worker执行](docs/55-worker-execution.md)。

P16 最终 macOS arm64 **423项Node、19项框架浏览器**通过；13个tgz消费99阶段、默认插件作者54阶段、新应用37阶段和两轮20/100可靠性样本通过。生成归属、旧声明拒收、取消与输入变更的实际范围见 [P16结果](docs/58-p16-results.md)，精确源码/日志/归档身份见 [机器证据](artifacts/p16-validation.json)。不宣称完整1.0、长期无泄漏、任意平台兼容或公开发布；Admin继续仅作框架验证负载。

名称约定：框架、CLI、配置和运行时均为 **cormi**；`cormijs` 仅用于发布包名及 `@cormijs/*` 命名空间。源码 import 使用真实包名；现有项目目录仍为 `/Users/mahoo/Projects/cormijs`。

## 本地运行

本机使用 Node 22.14.0、pnpm 10.6.3、macOS arm64；`.nvmrc` 固定当前实验 Node，不修改全局环境。

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm cormi dev --root examples/basic
```

React 示例默认监听 `127.0.0.1:8001`。首页包含可点击计数器，导航演示静态页面、嵌套布局、动态参数和 catch-all。组件修改由 Fast Refresh 处理；页面新增/删除会重算路由、提交入口、失效后端缓存并整页刷新。Ctrl+C 关闭 worker 和自己的资源后释放锁。

```sh
# 只准备路由和生成入口，然后退出
pnpm cormi prepare --root examples/basic

# 检查业务源码与生成入口；读取上次成功生成的快照
pnpm cormi typecheck --root examples/basic --startup-timeout 30000
pnpm cormi inspect --root examples/basic --json

# 停止 dev 后，构建并预览应用
pnpm cormi build --root examples/basic
pnpm cormi preview --root examples/basic
```

**同项目只允许一个 CLI 会话。现在可以重复 build，但只替换由本协议创建且内容未被修改的 dist。** 没有 `.cormi-build.json` 的旧目录、或新增/修改了用户文件的产物目录会被拒绝；先保管旧产物或改用另一个 app.outDir，不自动清空未知目录。构建先写 staging，失败保留旧结果；切换使用两个目录 rename 并有失败回滚，不是无间隙原子交换。preview 只服务已有产物，不重新扫描或生成。`examples/p0` 保留原 HTML+TypeScript 示例；`pnpm demo` 仍是一次性原始 builder 验证。

## 验证

```sh
pnpm check
pnpm typecheck:example
pnpm test:browser
```

check 包含框架与测试的类型检查、构建和 Node 测试；typecheck:example 检查示例业务源码。browser 测试用 playwright-core 启动独立的无头浏览器，不接入个人浏览器 profile。Mac 默认使用现有 Microsoft Edge，其他环境通过 `CORMI_BROWSER_EXECUTABLE` 指定 Chromium 系可执行文件；未找到时明确失败，不下载浏览器或静默跳过。应用级 `cormi typecheck` 先 prepare，再检查业务及生成代码；即使 tsconfig 排除 .cormi，也会检查必要生成入口。`cormi inspect` 读取上次成功快照，不重新计算源文件，不表示当前源文件已验证。

## 配置来源

```sh
pnpm cormi config --root examples/features --for dev --json
pnpm cormi config --root examples/features --for build --mode staging --json
```

该命令报告当前 preset/user/derive 的字段赋值来源，未知值与 runtime options 默认不展示；不执行目标 build、不改写生成快照。它仍要求配置求值、插件初始化和项目写锁，且不包含构建器内部默认值的完整来源。示例的 staging base 由普通 Cordis 配置派生插件调整为 /staging/。

## 功能插件示例

```sh
pnpm build
pnpm cormi dev --root examples/features
```

默认监听 `127.0.0.1:8002/workspace/`。状态页面、Provider 与元数据来自 `features/status/plugin.ts`；修改组件保留 Fast Refresh，配置中停用插件则撤销贡献并重启 worker。停止 dev 后可用同样 root 执行 typecheck/build/preview。`pnpm pack:local --template features` 可生成仓库外试用 kit；默认 basic 模板不变。

`pnpm cormi dev --root examples/app-runtime` 演示 `src/app.tsx` 运行时约定（默认 `/runtime/`）：异步首屏初始化、根容器、运行时加入路由和带 action/isFirst 的路由事件。约定插件在配置中显式启用，不改变既有应用把 `src/app.tsx` 当作普通组件的语义。

`pnpm cormi dev --root examples/config-routes` 演示配置式嵌套路由（默认 `/routes/`）：根布局、index 首页、`team/:id` 动态参数、路由 meta、错误边界、参数化重定向、`keepQuery`、外层/内层 wrapper 与 `src/layouts/index.tsx` 全局布局都由配置显式组合，`routeConfigPlugin` 和 `layoutPlugin` 通过原生 React hook 贡献；`/routes/bare` 演示 `layout:false` 退出全局布局。`app.routes: []` 明确关闭约定扫描。

`pnpm cormi dev --root examples/conventions` 演示约定式 404 与 loading（默认 `/conventions/`）：根 `src/pages/404.tsx` 成为 catch-all，`src/layouts/index.tsx` 和 `src/loading.tsx` 分别提供全局布局与首次路由加载回退；`slow`/`missing` 路径可观察页面行为。

`pnpm cormi dev --root examples/history` 演示 hash history（默认 `/history/`）：导航路径位于 `#` 之后，刷新保留路由；`Link`、`useNavigate`、`useSearchParams` 全部从 `@cormijs/runtime` 导入。

`pnpm cormi dev --root examples/model` 演示共享模型（默认 `/models/`）：`src/models/counter.ts` 与 `user.ts` 由 `modelPlugin` 发现，两个组件通过 `useModel` 读取同一状态，selector 读取派生值，路由切换后状态保留。

`pnpm cormi dev --root examples/initial-state` 演示初始状态（默认 `/initial-state/`）：`src/app.tsx` 的 `getInitialState` 返回启动数据，`useInitialState` 展示 loading/data/error，并支持 refresh 与 setInitialState。

`pnpm cormi dev --root examples/request` 演示请求客户端（默认 `/request/`）：`requestPlugin` 读取 `src/app.tsx` 的 request 配置，`useRequest` 自动加载 `public/data.json`，并演示 refresh、错误与取消。

`pnpm cormi dev --root examples/locale` 演示 locale（默认 `/locale/`）：`src/app.tsx` 内联中英文消息，`useIntl`/`FormattedMessage` 支持切换、占位符、fallback 与 localStorage 持久化。

`pnpm cormi dev --root examples/access` 演示 access（默认 `/access/`）：`getInitialState` 返回角色，`access` 计算 `canAdmin`，`useAccess`/`Access` 控制管理员面板，`setInitialState` 改变角色后权限即时更新。

`pnpm cormi dev --root examples/menu` 演示菜单与面包屑（默认 `/menu/`）：路由 meta 生成排序/嵌套菜单，无标题布局被折叠，`meta.access` 过滤管理项，`useBreadcrumb` 显示当前路径。

`pnpm cormi dev --root examples/html` 演示 HTML head 与脚本注入（默认 `/html/`）：`htmlPlugin` 配置 title、lang、meta、canonical、favicon 以及受审查的 `headScripts`/`scripts`，开发与构建使用同一变换。

`pnpm cormi dev --root examples/mock` 演示 Mock 目录（默认 `/mock/`）：`mock/users.ts` 映射 `GET /api/users` 等接口，开发期修改文件自动重载，生产预览不提供 Mock。

`pnpm cormi dev --root examples/alias` 演示路径别名（默认 `/alias/`）：`aliasPlugin` 声明 `@` 与 `@shared`，页面通过别名导入共享模块，tsconfig paths 保持对齐。

`pnpm cormi dev --root examples/define` 演示编译期常量与内置别名（默认 `/define/`）：`definePlugin` 注入 `APP_NAME`/`APP_FLAGS`/`process.env.APP_MODE`，`aliasPlugin` 的 `builtins` 提供 `@`→src，类型由 `src/defines.d.ts` 声明。

## Linux 验证

```sh
pnpm test:linux
```

需要 Docker 已在本机运行。首次构建验证镜像、安装依赖和准备新消费者解析缓存需要网络；随后自动断开测试容器的外部网络，执行 offline 安装、Node/浏览器回归、两轮 tgz 消费者和故障重复。源码快照只读挂载后复制到 Linux 原生工作目录，不直接使用主机 node_modules 或在 macOS 共享文件系统上代替 Linux 文件测试。

测试不向主机暴露服务端口、不挂载 Docker socket、不传入主机 .npmrc。容器非 root、只读输入、限制资源，结束后删除本轮容器并取回日志；镜像留作缓存，不修改已有服务。可用 `pnpm test:linux --image sha256:<完整本地镜像ID>` 复用记录的镜像。工具只接受 macOS/Linux 宿主，Windows 原生验收尚待进行。

## Windows 验证准备（已挂起）

2026-10-18 起暂停原生 Windows 工作，保留以下入口供以后恢复；这不是本轮框架功能的验收前置条件。

`pnpm test:windows --probe` 只探测真实执行环境；Mac/Linux 返回 WINDOWS_NATIVE_REQUIRED、退出 2、原生用例数 0。Windows 版 Node22.14.0 + pnpm10.6.3 下可运行 `pnpm test:windows` 的专项契约，结果仍不等于完整 Windows 支持。MahooPC 在 P3c-prep 时探测为隧道离线；后续功能阶段没有继续探测或在其他机器执行原生验收，也未安装虚拟机或上传 CI。

父进程需要程序化正常关闭时，可 fork CLI 并发送 `{version:1,type:'cormi:shutdown'}`，不要把 Windows child.kill('SIGTERM') 当作优雅关闭。普通控制台启动方式不变；详细作用域、退出和待测项见 [协议](docs/19-windows-validation.md)。

## 创建新应用

先运行 `pnpm pack:local` 获取 kit 路径，再执行 `pnpm create:app <尚不存在的新目录> --kit <kit路径> --template react-api`。创建器会把 tarball 和 Cordis 声明补丁复制到新项目 `.cormi-local/`，因此新项目不依赖原 kit 或本仓库位置。进入新目录运行 `pnpm install --ignore-scripts`、`pnpm dev`；停止 dev 后可 `pnpm typecheck`、`pnpm build`、`pnpm preview`。

`react` 模板不包含开发 API，`react-api` 自带可点击的 Mock 请求示例。创建命令不自动安装、不初始化 Git、不覆盖已有目录。当前公共包仍未发布，--kit 是明确的本地交付约束，不是假装 npm create 已可以公开使用。新项目的 pnpm-workspace.yaml 防止外层 workspace 自动接管；下文旧式 kit/app 试用仍需整个 kit 移出框架仓库。

## 仓库外试用

`pnpm pack:local` 生成全新的 `.cache/cormi-kit-<uuid>`，包含 13 个真实 tgz、声明兼容补丁、上游许可、哈希清单和独立 app 示例。**将整个 kit 移出本 workspace 后，再进入 app 安装**，不要在仓库内的 kit/app 执行 pnpm install。也可以 `pnpm pack:local --out <尚不存在的外部目录>` 直接指定目的地。

试用环境固定 pnpm 10.6.3，先 `pnpm install --ignore-scripts`，然后 `pnpm exec cormi typecheck`、`pnpm dev`。build/preview 先停止 dev 再执行。包不包含第三方依赖缓存，首次安装可能需要网络。`pnpm test:package` 自动创建带空格/中文路径的仓库外消费者，离线使用本机下载缓存独立安装，验证 Node/类型/CLI 和实际浏览器行为；缺少缓存或浏览器时明确失败。

Cordis RC.11 暂时仍要求**消费者根**配置 `pnpm.patchedDependencies`。本地 kit 已明确提供，不使用 postinstall、不修改上游 JavaScript、不引入第二个 Context。原始无补丁包的严格 NodeNext 失败作为负向测试保留；公开发布的透明安装方案尚待确定。

包检查和示例复制拒绝已知私有文件及链接；示例先检查完整源文件快照再创建目标。pack:local 不安装第三方依赖，也不附带已解析的应用锁文件；首次安装后应保留 pnpm-lock.yaml。两轮独立消费验证包含移动整个 kit 后的 frozen/offline 干净安装，不会依赖原位置残留的 node_modules。

## 模块

```text
packages/
├── core/                    # Cordis 宿主、就绪屏障、基础诊断和命令协议
├── builder/                 # 后端无关构建/会话/开发失效契约
├── routes/                  # 路由 IR、约定扫描与冲突验证
├── plugin-web/              # Web consumer、应用命令、OrderedHooks、生成队列
├── plugin-vite/             # builder 与 vite 服务的 Cordis provider
├── plugin-dev-api/          # 可选 Node Mock/HTTP 代理；/vite 为专属桥接
├── create/                  # create-cormi 独立项目创建器
├── plugin-react/            # application 编译服务与 react 贡献入口；无 Vite
├── runtime/                 # 仅浏览器 React/Router 生命周期
├── plugin-react-vite/       # React 原生 Vite 集成和客户端边界
├── plugin-typescript/       # 可选应用类型检查命令；TypeScript 按需加载
├── preset-react-vite/       # 可审阅、可替换的默认组合
└── cormi/                   # 包名 cormijs；CLI/config/preset/锁/worker
```

core 的物理独立消费者测试验证没有 Vite 仍可运行；React compiler 也可在没有 builder 的宿主中准备入口。Vite 仍是唯一真实后端，可替换测试 provider 不代表其他构建器的原生插件自动兼容。生成型开发应用需要后端提供 `ServerHandle.invalidate`；不支持时明确报错。

## 文档与记录

[架构 Draft 0.11](docs/02-architecture.md)描述完整目标，[MVP 计划](docs/03-mvp-plan.md)记录进度，[插件优先 ADR](docs/04-plugin-first-adr.md)记录边界原则。[命名和启动协议](docs/06-naming-and-launcher.md)、[路由与 React 协议](docs/08-routes-and-react.md)、[受管发布与检查](docs/10-publication-and-tools.md)和[开发恢复](docs/12-development-recovery.md)描述各层接口。历史 [P0](docs/05-p0-results.md)、[P1a](docs/07-p1a-results.md)、[P1b](docs/09-p1b-results.md)、[P1c](docs/11-p1c-results.md) 保留各阶段实际结果，不改写历史验证 JSON。

## 固定依赖与参考

| 对象 | 本机验证基线 |
| --- | --- |
| Cordis npm | 4.0.0-rc.11，gitHead 0b96d9fd517b998e44e2209560c9e5f0671ce933 |
| Vite / React Vite plugin | 7.3.2 / 5.1.4 |
| React / React DOM / React Router | 19.3.1 / 19.3.1 / 7.18.2 |
| TypeScript / tsx / esbuild | 5.9.3 / 4.23.15 / 0.28.2 |
| playwright-core / 本轮实测 Edge | 1.58.2 / 155.0.4283.62 |

直接依赖固定版本，间接依赖使用 pnpm-lock.yaml；以上不表示最新版本。Cordis npm 声明文件仍使用仅声明的 pnpm patch，不修改运行时 JavaScript；该补丁已提供本地 pnpm 显式试用配置，但透明公共分发问题尚未解决，包保持 private，见 [补丁说明](patches/README.md)。

`cordis/` 与 `umi/` 是独立 depth-1 参考 checkout，不进入 workspace 或本仓库提交。固定 HEAD 见 [源码研究](docs/01-source-study.md)。本地 Git 已初始化为 main，P1a 初始提交为 `a4e3384`；没有配置远端、推送或发布。

## 明确限制与下一步

单入口 rename 不等于多文件事务或业务源码回滚。开发态可修复的路由/模块错误会保留监听会话，并通过独立 Shadow DOM 面板展示；有效修复自动清除诊断。首次失败没有当前有效输出，后续失败可以保留上次生成入口，刚修改/删除的业务模块仍可能报错。基础配置、HTML 入口和受管文件所有权错误仍需明确失败；prepare/build/typecheck 不采用容错成功策略。未带 from 的相对引用仍按项目根解析；功能插件可用 clientModule 显式按作者文件位置解析。完整跨包源码重载和跨盘符导入仍未实现。

正常 CLI 退出移除自己的 run 缓存与锁；强杀父进程可能留下 stale 锁，不按 PID/时间猜测自动抢锁。恢复前核实相关会话及 worker 均已结束。低层编译 API 不自动取得 CLI 锁，调用者应确保单写入者。

生成集包含 app.tsx、routes.d.ts 和 inspect.jsonc，文件哈希用于发现混合状态，不声称跨文件事务。typecheck 暂不支持 tsconfig solution/project references；build 转译通过不代表类型正确。发布锁和事务目录在崩溃后可能保留，人工恢复前核实所属进程及旧产物位置，不自动删锁或备份。

Linux 验证限定已记录的 Debian 12 / arm64 容器与依赖组合；Windows 原生工作已挂起。项目创建、开发 Mock/HTTP 代理和应用配置来源链路现已交付；下一切片进入固定版本 Material Kit React Admin 迁移，用真实页面和交互检验框架，不继续以抽象完备性拖延应用试用。正式发布前仍须确认项目许可、包名归属和声明兼容策略。SSR/RSC、Windows、Linux x64/musl、真机移动浏览器、断电持久性及长期资源趋势仍无通过保证。

`pnpm cormi dev --root examples/global-style` 演示全局样式约定（默认 `/global-style/`）：`globalStylePlugin` 发现 `src/global.css`，生成入口自动导入，dev 期新增或删除该文件会重新生成。

`pnpm cormi dev --root examples/access-convention` 演示 `src/access.ts` 约定（默认 `/access-convention/`）：初始状态来自 `app.tsx`，权限映射来自约定文件，降级后管理面板隐藏。

`pnpm cormi dev --root examples/locale-catalog` 演示消息目录（默认 `/locale-catalog/`）：文案来自 `src/locales/en.json`、`src/locales/zh-CN.json`，`app.tsx` 同名 key 优先。

`pnpm cormi dev --root examples/route-head` 演示路由级页面头部（默认 `/route-head/`）：切换路由时标题、description 与 canonical 由 `meta.head` 同步，受管标签不会累积。

`pnpm cormi dev --root examples/prefetch` 演示路由预取（默认 `/prefetch/`）：`mode: 'idle'` 在首屏空闲预热全部路由，页面也可用 `usePrefetch()` 手动预取。

`pnpm cormi build --root examples/output` 演示输出策略：`static/` 被复制到 `dist/extras/` 与 `dist/robots.txt`，`hash:false` 生成 `dist/assets/index.js`。

`pnpm cormi build --root examples/static-export` 演示静态导出：`dist/index.html` 与 `dist/guide/index.html` 各自带路由标题与 canonical，仍由浏览器挂载页面。
