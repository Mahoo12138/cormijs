# cormi

以 Cordis 为插件宿主、以 Umi 的应用开发体验为参考的 TypeScript 应用框架。默认 React + Vite 由 preset 组合提供，core 不绑定 React 或 Vite。

**当前阶段：P15 原生 worker 执行策略与可复用 CLI。** workerExecution由原生Cordis组合提供，普通命令和失败诊断不再由worker传输层硬编码选择；可替换诊断器、由应用接管同名命令或关闭诊断基础设施。cormijs/cli复用标准参数/信号入口，默认CLI使用方式不变。当前应用入口见 [应用开发指南](docs/49-application-guide.md)，高级组合见 [引导插件](docs/53-bootstrap-plugins.md) 与 [worker执行](docs/55-worker-execution.md)。

最终 macOS arm64 **398项Node、19项框架浏览器**通过；13个tgz消费84阶段、默认插件作者54阶段、新应用37阶段和两轮20/100可靠性样本通过。实际范围、句柄/退出重入修正见 [P15结果](docs/56-p15-results.md)，精确源码/日志/归档身份见 [机器证据](artifacts/p15-validation.json)。不宣称完整1.0、长期无泄漏、任意平台兼容或公开发布；Admin继续仅作框架验证负载。

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
