# cormi P3c-prep：Windows 验证边界与协作式进程控制

日期：2026-10-18。状态：兼容性准备；不是 Windows 原生验收通过。实际执行记录另见本轮结果文档。

## 1. Mac 可以准备，但不能代替 Windows 内核

上一阶段验证的是 Mac 上真实运行的 Debian 12 arm64 容器，不是把 macOS 假装成 Linux。Windows 同样需要 Windows 内核与 Windows 版 Node：可以来自远程 Windows 电脑、Windows 虚拟机，或者 GitHub Actions Windows runner。改变 process.platform、测试 path.win32 字符串、Wine 或 WSL 中的 Linux 版 Node 都不作为 Windows 原生 API 的验收依据。

Mac 上可以验证纯路径策略、参数传递、状态机及公共 IPC 协议。文件占用与删除共享、junction/reparse point、实际 .cmd 启动、控制台 Ctrl+C 等必须在 Windows 上执行。Windows on Arm 与 Windows x64 的 OS/Node/CPU 架构应分别记录，不能用其中一个结果代替另一个。

本轮对已连接 MahooPC 发起一次只读状态检查，返回 tunnel_client_not_seen（隧道未在线）；没有进入该机器、复制代码、安装虚拟机或向远端推送。原生验收目标仍待用户确定并提供可用连接。

## 2. 分开正常停止与强制终止

Node 22.14 官方文档说明 Windows 上 child.kill('SIGTERM') 会强制终止，而不是触发 Unix 式优雅清理。已有 POSIX 测试里的 SIGTERM 不能直接移植为 Windows 的正常退出用例。CLI 控制台 Ctrl+C 与 programmatic kill 也不是同一测试。

新增 [控制绑定](../packages/cormi/src/control.ts)。父进程使用 Node fork 启动 CLI，并建立已有 IPC 通道时，可以发送精确消息 `{version:1,type:'cormi:shutdown'}`。CLI 将消息转换成现有 AbortSignal，继续走 supervisor → worker 的停止、清理、退出与释放项目锁流程。不存在 IPC 父进程时不安装 message/disconnect 控制监听，也不创建网络端口或公共管理服务。

协议只接受两个自有字段及精确版本/类型，忽略其他消息；重复请求只触发一次 abort。绑定的撤销只删除自身监听器。父 IPC 断开同样发起协作关闭；一次性命令结束会关闭剩余父通道，不能因为测试进程持有 IPC 而永远不退出。配置执行陷入死循环时，仍由现有有界 worker 停止策略产生非零退出；不把发出停止请求当作完成清理。

正常程序化关闭应优先发送消息并等待实际退出，不应为了关闭而先手工 child.disconnect。新断开连接用例在 Mac 的 Node22.14 上遇到 ChildProcess.close 不交付，测试只在这个特定场景改为同时等待实际 exit、stdout close、stderr close；普通关闭继续等待实际 ChildProcess.close。没有伪造 close、修改 Node 内部字段或把 exit 单独视为管道已经关闭。类似上游报告见 [Node #65646](https://github.com/nodejs/node/issues/65646)。这是测试端连接收尾问题，不将它当作 Windows API 已验证。

## 3. 命令参数不变成 shell 代码

新增 [工具调用计划](../scripts/tool-command.ts)，将 pnpm 的已安装 JavaScript 入口交给当前 Node 原生 argv 执行，供打包工具使用。通过 pnpm run 调用时使用 npm_execpath；独立调用者也可以显式设置绝对 CORMI_PNPM_CLI。显式设置必须是受支持的 pnpm JS 文件，不能是 .cmd 或相对路径。

不为通过 Windows 测试而将所有 spawn 改成 shell:true。参数中的空格、中文、引号、百分号、感叹号、&、$() 和末尾反斜杠应保留为数据。Windows 无法确定 pnpm JS 入口时明确失败，不猜测用户全局安装路径。非 Windows 的无入口情况保留原有 pnpm 可执行文件调用。

这只处理 pnpm 自动化调用边界；既有 test-package 的 POSIX bin/信号假设仍需 Windows 专项适配和真实回归。不要把这个小修正表述为整个 Windows 打包链路已经完成。

## 4. 原生契约入口

```sh
pnpm test:windows --probe
pnpm test:windows
```

使用 Windows 版 Node22.14.0、pnpm10.6.3，在单独的可写 Windows 工作副本中先安装锁定依赖。本轮不自动安装系统或升级全局工具。--probe 只报告当前平台/系统/进程架构/机器架构；非 Windows 或错误 Node 基线退出 2，nativeTestsRun=0，supportVerified=false，不创建成功报告。探测到环境满足要求也不是测试通过。

真正运行时，驱动检查源文件哈希、包管理器版本和类型编译，然后显式执行 [Windows 原生契约](../tests/windows/native.test.ts)、[共享 IPC 测试](../tests/launcher-control.test.ts)、[参数测试](../tests/tool-command.test.ts)。Windows 专属文件不会被 Mac/Linux 的普通测试 glob 执行；这不是 skipped 通过，它们在本轮原生结果中计为未执行。误在非 Windows 直接执行专属测试会明确失败。

五个专属契约涵盖真实文件 URL/中文路径、目录 rename、junction 别名争用 cormi 锁、已安装 cormi.cmd 通过 cmd.exe 启动、PowerShell FileShare.None 持有真实文件句柄时拒绝 rename，并在释放后成功。所有创建/清理对象限于本轮临时目录与准确持有的子进程，不按名称杀进程；文件共享测试的 PowerShell 程序固定，文件路径通过环境变量传递。

结果落在 `.cache/windows-contracts-*`。即使契约全部通过，报告仍标记 coverage=native-contracts-only、supportVerified=false，列出尚未完成的整套 Node、浏览器、tarball、交互控制台和架构矩阵。命令或前置条件失败必须保留失败，不跳过为绿灯。

## 5. 原生执行时继续检查的清单

现有仓库仍有待真实确认的边界，包括 test-package 的 POSIX bin 与停止方式、测试目录 symlink 权限、O_NOFOLLOW 与文件身份验证、Vite 规范化路径与原生路径比较、占用目录的发布回滚、不同大小写和盘符/UNC 行为。不能仅凭静态阅读宣布这些地方都已修复，也不能为取得一个绿色摘要而禁用它们。

原生契约通过后再适配完整验收：先真实 CLI/worker 与受管文件保护，再浏览器/Fast Refresh 与两轮打包消费，最后补控制台 Ctrl+C 和其他架构。短期可由已有 Windows PC 执行；长期可以在授权远端仓库后准备 Windows CI。创建远端、上传代码或触发 CI 不是本地开发指令自动包含的动作。

## 6. 外部依据

[Node22.14 child_process](https://nodejs.org/download/release/v22.14.0/docs/api/child_process.html)区分 .cmd、信号、IPC 与退出事件；[Node22.14 path](https://nodejs.org/download/release/v22.14.0/docs/api/path.html)解释 path.win32 及每盘工作目录；[Microsoft Windows containers 要求](https://learn.microsoft.com/en-us/virtualization/windowscontainers/deploy-containers/system-requirements)说明 Windows 宿主前提；[WSL 版本](https://learn.microsoft.com/en-us/windows/wsl/compare-versions)说明 WSL2 Linux 内核；[GitHub runner](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)列出可用 Windows 执行环境。接口按项目固定版本核对，不将滚动网页的最新依赖当作本项目已升级。
