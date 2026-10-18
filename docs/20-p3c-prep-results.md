# cormi P3c-prep：Windows 兼容性准备与协作关闭结果

日期：2026-10-18。基于 P3b 提交 `de4fdd681f539f1ee2e18e0f81804516c6fa8113`。本轮完成可验证的公共进程控制和 Windows 原生契约准备；**Windows 原生执行数量为 0，尚未验证 Windows 支持。** 最终 Mac 与 Debian12/arm64 各 165 项 Node、10 项浏览器回归通过。精确命令、退出码、原始日志哈希、源文件哈希与未执行范围见 [机器记录](../artifacts/p3c-prep-validation.json)。

## 1. 对执行环境的澄清

Mac 上的 path.win32 只能处理 Windows 形式的路径，不能使 macOS 拥有 Windows 的文件共享、进程或控制台行为。上一阶段的 Linux 是真正运行于 Linux 内核的容器；Windows 也需要真实 Windows 环境。可选目标包括远程 Windows PC、Windows 虚拟机或 Windows CI；Windows on Arm 与 x64 的结果应分别记录。协议依据与细节见 [Windows 验证](19-windows-validation.md)。

本轮只读探测已有 MahooPC 连接，收到 HTTP404 与 tunnel_client_not_seen，表示该连接当前不可用。没有将源码复制过去，也没有安装 Windows、改动虚拟机、创建远端、推送代码或触发 CI。需要先恢复并确认实际 Windows 执行目标，再进行原生验收。

## 2. 本轮已实现

**父进程 IPC 协作关闭。** [control.ts](../packages/cormi/src/control.ts)在 CLI 已经具有 Node fork 父 IPC 通道时接受精确的 `{version:1,type:'cormi:shutdown'}`，转换为原有 AbortSignal，并通过既有 supervisor/worker 路径等待清理。普通控制台 SIGINT/SIGTERM 绑定继续存在。没有新增网络控制端口、共享单例或特殊 Web/Vite 依赖。

只接受消息的两个自有字段及版本/类型，其他消息被忽略，重复请求只触发一次取消。撤销只移除自己的监听器。父通道断开也能发起协作式停止；一次性命令结束主动关闭残余通道，防止命令已经完成但 IPC 仍维持进程。停止期间的非协作 worker 仍必须按期限报错退出，不能把取消请求当作成功清理。

**pnpm 自动化不拼接 shell 命令。** [tool-command.ts](../scripts/tool-command.ts)使用 pnpm 已安装的 JS 入口与当前 Node 构造原生 argv，接入打包工具。pnpm run 下读取 npm_execpath，必要时可显式提供绝对 CORMI_PNPM_CLI；显式 .cmd/相对路径配置被拒绝。空格、中文、引号、百分号、&、感叹号、$()、末尾反斜杠都通过真实 Node 子进程断言为原样数据，没有改成 shell:true。

这不是已经移植完整的 Windows test-package。其原有 POSIX bin、信号退出、权限与路径断言仍需要原生适配；没有通过暂时删掉这些检查来宣布可用。

**Windows 原生契约入口。** 新增 `pnpm test:windows --probe` 和 `pnpm test:windows`。环境检查读取真实 process.platform、系统类型和架构，要求 Windows 版 Node22.14.0 与 pnpm10.6.3。非 Windows 返回 WINDOWS_NATIVE_REQUIRED、退出码 2、nativeTestsRun=0、supportVerified=false，并且不创建 Windows 成功报告。即使探测到 Windows，--probe 也不等于测试通过。

新增的五个 Windows 专属用例描述了实际文件 URL/中文路径、目录切换、junction 别名争用项目锁、已安装 cormi.cmd 经 cmd.exe 启动，以及 PowerShell FileShare.None 持有真实文件句柄时拒绝 rename、释放后再成功。它们只进行了 TypeScript 检查，**未运行于 Windows，不计入 165 项通过数量，也不以 skipped 计为通过**。Windows runner 首轮只覆盖原生契约，完整 Node、浏览器、打包、控制台 Ctrl+C 与架构矩阵仍在报告的 pending 中。

## 3. 新增共享测试与实际发现

本轮新增 14 项可跨平台执行的测试：launcher-control 8 项、tool-command 4 项、windows-environment 2 项。包含真实 fork CLI、HTTP 可服务、错误控制消息不关闭服务、请求关闭后的端口重绑/锁与缓存清理、父通道断开、一次性命令自然退出，以及先确认 worker 进入死循环后再停止并检查非零结果。

首次定向执行有两个配置 fixture 语法错误，原因是测试字符串缺少一个闭合括号，修正后继续运行，没有为 fixture 调整产品配置解析器。

随后父进程显式 disconnect 的场景出现 ChildProcess.close 不交付，导致等待它的测试被取消。类似上游报告见 [Node #65646](https://github.com/nodejs/node/issues/65646)。本轮只在这个特定测试中同时等待真实 exit、stdout close、stderr close；正常消息关闭仍等待真实 ChildProcess.close。没有合成事件、修改 Node 内部字段或只用 exit 代替管道清理。原失败日志保留，后续完整回归及两轮定向重复全部通过。这是实测进程测试边界，不是 Windows 原生结论。

## 4. 最终执行范围

| 检查 | macOS arm64 | Debian12 / arm64 |
| --- | --- | --- |
| pnpm check，包括框架/测试/脚本类型检查 | 165/165 | 165/165 |
| pnpm test:browser | 10/10 | 10/10 |
| pnpm test:package | 一轮，36 个阶段 | 两轮，各36个阶段 |
| 新增共享测试定向重复 | 两轮，各14项 | 已包含完整165项，不单独重复 |
| 既有生命周期/发布故障定向重复 | 未另执行 | 27/27 |
| 示例源码类型检查 | 退出0 | 退出0 |
| 严格声明、P0 demo、应用typecheck/inspect | 包消费覆盖相关链路；未另执行四条命令 | 分别退出0 |
| Windows --probe 与普通执行拒绝 | 两条分别退出2，原生用例0 | 预检回归包含于165项 |
| 真正的 Windows 原生用例 | 未执行 | 未执行 |

Node 与浏览器回归均无失败、取消、跳过。消费者的无补丁类型错误、缺少必要 peer、坏源码构建及业务类型错误仍是明确的负向预期，不将每轮36个步骤当成36个新增 Node 用例。165 项相对上一阶段151项增加14项，不按两个平台重复累加。

Mac 结果位于 `.cache/p3c-mac-993db8c0bbe84df4957013740e3acc08`；Linux 结果位于 `.cache/linux-run-nDvU6B`。Linux 复用既有验证镜像，完成在线缓存准备后断开外部网络，在非 root 容器原生文件系统执行测试，并取回证据、删除本轮容器。镜像与框架依赖没有升级。

Mac 最终检查126份源码/配置哈希，并在每条命令前后比对文件集合与内容；Linux 快照126项中包含专用生成 .npmrc，其余125项与主机源文件一致。最终执行期间未修改覆盖的实现、测试或锁定依赖。之后仅新增结果文档、汇总证据并更新文档导航，历史 P0–P3b JSON 不覆盖。

## 5. 下一步仍需要真实 Windows

在目标 Windows 的独立可写工作副本安装锁定依赖后，先执行 `pnpm test:windows --probe`，再执行 `pnpm test:windows`。不要在 Mac 反复运行这个命令试图得到 Windows 通过，也不要把 WSL 的 Linux Node 当作 Windows 版 Node。原生契约通过后，再逐项推进完整 CLI、文件保护、浏览器和 tarball 验证；Mac/Linux 回归只是防止这次公共改动破坏已有平台。

公开许可、包名归属、Cordis 消费者根声明补丁、完整平台矩阵和长期资源趋势仍是原有门槛。包保持 private；这轮没有推送、发布、部署或创建新的常驻服务。
