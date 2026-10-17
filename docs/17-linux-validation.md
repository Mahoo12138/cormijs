# cormi P3b：隔离 Linux 验证协议

本协议描述 `pnpm test:linux` 的执行边界，实际平台、版本、通过数量和问题另见阶段结果。它是测试工具，不是生产部署方案；不因为 Docker 启动成功就宣称 cormi 已通过 Linux 验收。

## 1. 环境与输入

验证镜像使用固定摘要的 Node 22.14.0 Debian bookworm slim 基础镜像，安装 pnpm 10.6.3、Debian Chromium 和 CJK 字体；验证前确认中文字体可用，避免仅 DOM 正确而截图全是缺字方块。系统浏览器及其库由构建时 Debian 仓库解析，镜像 ID 与实测版本写入记录；重新构建不承诺字节级复现。复用相同环境时传入 `--image sha256:<本地完整镜像ID>`，不使用浮动 tag 冒充固定环境。镜像只包含测试工具，不包含应用源码或个人配置。

驱动从 Git 已跟踪与非忽略文件中选取明确的源码、配置、测试、补丁和示例范围，逐文件记录 SHA-256。生成物、node_modules、参考仓库、历史 artifacts、文档和主机 .npmrc 不进入快照。容器内使用脚本生成的最小 .npmrc，不传入主机包注册表认证。已知敏感文件、路径穿越、链接、硬链接与超预算输入会被拒绝。这是受信任项目的输入筛选，不是任意源码内容的密钥检测或第三方插件沙箱。

快照只读挂载到 `/input`，执行用户将源文件复制到 `/home/node/work` 后才安装和运行。代码、依赖、构建和临时消费者都在 Linux 原生容器文件系统，不直接在 macOS bind mount 上测试目录原子替换、大小写或 watcher。测试程序先验证大小写敏感行为及实际 UID，不把宿主上的路径函数测试当作 Linux 文件系统验证。

## 2. 权限、网络与资源

容器使用非 root 的 node 用户、`--init`、独立 PID/网络命名空间，关闭额外 capabilities，不挂载 Docker socket，不使用 host network 或 privileged。不映射开发端口到主机；浏览器与应用只在容器内访问 loopback。默认限制 2 CPU、3 GiB 内存和 512 MiB 独立共享内存，不改动其他服务配置。

镜像构建和依赖缓存准备需要网络。首次 workspace 安装使用 frozen-lockfile 与 ignore-scripts；随后在临时 seed 消费者中显式准备各安装形态的解析元数据与依赖内容，并删除 seed 安装目录。冻结锁文件安装不保证准备无锁新消费者所需的注册表元数据，不能只下载 workspace 依赖就宣称冷环境已具备离线消费条件。准备成功后，驱动主动断开该容器的 bridge 网络，检查没有外部网络连接，再启动正式验证。容器内也检查网卡仅剩内部接口。正式验证中的安装命令全部 offline，浏览器只访问本轮本地测试应用。依赖缺失、网络配置未隔离或浏览器不可执行时明确失败，不跳过对应测试。

`--init` 用于收养及回收被强杀父进程遗留的已退出子进程，不能取代 cormi 自身的 IPC disconnect、端口释放和锁策略。测试依然必须验证合作式 worker 退出及 stale 锁不被擅自抢占。

## 3. 验证顺序与证据

容器依次运行离线冻结安装、框架/测试类型与 Node 回归、真实 Chromium 回归、两轮独立 tgz 消费者、生命周期/发布故障定向重复、示例类型、严格声明检查、原 P0 demo、应用 typecheck 与 inspect。消费者仍由此前的打包验收工具创建于 workspace 外，包含中文/空格路径、重定位后干净安装及明确的负向断言。

每一步保存退出码、原始日志 SHA-256；有 Node TAP 输出的步骤必须实际执行用例，且没有 fail/cancel/skip。每步执行前后比较源文件内容；宿主收尾再次核对输入快照，不能在源码变动后沿用旧报告。运行期间的未知失败立即使结果为失败，不将部分通过写成整套通过。

结果放在本项目 `.cache/linux-run-<随机值>`。容器内证据复制到该目录的 results，包含完整命令日志和每轮消费者的报告、锁文件与截图；正式阶段结果可以引用这些日志。历史阶段 JSON 不覆盖。报告内含容器 kernel、平台、浏览器和镜像 ID，必须区分 arm64 与 x64，也必须区分容器 Linux、WSL 与 Windows 原生执行。

## 4. 关闭与失败

只有本轮创建并持有完整 ID 的测试容器可以被停止和删除。成功或失败都先尽可能取回证据，再删除该容器；清理失败使本轮非零退出并保留可诊断身份。不使用 docker system prune、模糊进程名终止或重启 Docker daemon。主机测试镜像作为本地构建缓存保留，不作为常驻服务。

源文件、配置错误和依赖失败必须修复后重新验证。某一平台暂时无法运行时记录阻塞，不用宿主回归代替该平台结果。强杀驱动导致 finally 无法执行时，可能留下以 cormi-linux- 命名且带本轮随机 label 的容器；人工处理前应核对完整 ID/label，不清理同名前缀的其他资源。

## 5. 运行与支持边界

```sh
nvm use
pnpm test:linux
# 复用已建立并核对的本地验证镜像：
pnpm test:linux --image sha256:<完整镜像ID>
```

需要本机 Docker Engine 或兼容环境已经运行；命令不会自动启动/重启 Docker。驱动目前明确拒绝包含逗号的仓库根路径，避免 Docker mount 参数歧义；中文和空格仍可作为普通路径。可用 CORMI_DOCKER 显式指定 CLI 路径。初次环境准备会下载基础镜像、Linux 系统包和依赖，这不是完全离线启动工具。容器内测试不读取主机浏览器 profile，也不要求主机安装 Chromium。

Windows 仍须独立验证 .cmd/bin 启动、信号与强制关闭、目录 rename、文件占用、符号链接权限及大小写行为。当前驱动只接受 macOS/Linux 宿主，不暗示 Windows 原生支持；也不支持凭一次容器通过宣称任意 Linux 发行版、musl/Alpine、x64 或长时间运行均可靠。

官方依据：[Docker run](https://docs.docker.com/reference/cli/docker/container/run/)、[network disconnect](https://docs.docker.com/reference/cli/docker/network/disconnect/)、[Playwright Docker](https://playwright.dev/docs/docker)。具体命令按本轮实际版本验证，不使用滚动文档中的最新版号替换项目依赖。
