# cormi P3b：Linux 构建、生命周期与独立消费结果

日期：2026-10-17。基于 P3a 提交 `9e712b0f8b0786ae213936a0afa5a03881ee7a80`。本轮完成隔离 Linux 验证工具及真实执行，没有为取得平台通过而改动框架运行时代码、放宽断言或移除失败用例。最终 **Linux 与 macOS 各 151 项 Node、10 项真实浏览器测试通过，0 失败、0 取消、0 跳过**。Linux 的独立 tgz 消费者完整执行两轮，每轮 36 阶段满足预期；Mac 另执行一轮 36 阶段。精确环境、命令、日志、哈希和失败历史见 [机器记录](../artifacts/p3b-validation.json)。

## 1. 实测环境，而不是概括性的 Linux 支持

| 项目 | 本轮实际环境 |
| --- | --- |
| Linux 用户空间 | Debian GNU/Linux 12（bookworm） |
| 架构 | arm64；未模拟或宣称验证 x64 |
| 容器引擎 | Mac 上已有 OrbStack Docker；没有重启引擎或已有服务 |
| Linux kernel | 7.0.14-orbstack-00374-gbbca68e8d741 |
| Node / pnpm | 22.14.0 / 10.6.3 |
| Linux 浏览器 | Chromium 155.0.8059.79，独立无头上下文 |
| 中文字体 | Noto Sans CJK SC，只安装于测试镜像 |
| 用户和进程 | UID 1000，docker-init 作为 PID 1 |
| 文件系统 | 容器原生可写层；实测大小写敏感，不在 macOS 共享源码目录运行测试 |

最终验证镜像为 `sha256:acf0fa5b16b3f27f73c35c640e2efadb7a13e4fc6461cb2dfb5cbdd759f686ee`。基础 Node 镜像由摘要固定，Debian 浏览器/字体依赖按构建时仓库解析，因此保存最终镜像身份和版本；不把重新 apt 安装说成字节级可重现构建。所有框架依赖沿用项目锁文件，没有升级 Cordis、React 或 Vite。

## 2. 新增实现

新增 `pnpm test:linux`，入口为 [驱动](../scripts/test-linux.ts)。驱动提取允许的构建/测试输入，创建只读源码快照，启动本轮专用容器，准备依赖，断开外部网络后执行完整测试，最后取回证据并删除自己的容器。验证工具不进入 core、默认 preset 或浏览器运行时，不引入 Docker 产品依赖。

[源码快照](../scripts/linux/snapshot.ts)只收集 packages、examples、tests、scripts、patches 中的允许类型和少数根配置。reference checkout、历史 artifacts、文档、node_modules、生成目录、主机 .env/.npmrc 均不复制；容器使用明确生成的最小 .npmrc。已知私有路径、符号链接、祖先链接、硬链接及超预算输入会拒绝进入。三个新回归覆盖输入范围、独立副本和哈希校验，以及链接拒绝/已有目标保护。151 项是在原 148 项基础上增加这三项，不将跨平台重复执行算作新增用例。

容器仅挂载这份只读快照到 `/input`；执行前复制到 `/home/node/work`。没有挂载用户 home、Docker socket 或主机依赖树，没有 privileged/host network，也没有向主机发布测试端口。容器用户非 root，限制为 2 CPU、3 GiB 内存和 512 MiB 共享内存；这些是测试资源设置，不是 cormi 的最低配置或性能结论。

## 3. 首轮真正失败的冷缓存场景

最初 Linux 的 151 项 Node 和 10 项浏览器测试已经通过，但独立消费者第一步安装失败：`ERR_PNPM_NO_OFFLINE_META`，缺少 `@types/node@22.13.10` 的注册表解析元数据。原失败证据保存在 `.cache/linux-run-UDaL5W`，机器记录保存报告哈希，没有删除该次失败或将其写成预期负向用例。

原因是全新环境中 frozen workspace install 可以直接按锁文件下载包内容，却不保证准备无锁新消费者所需的全部元数据。Mac 缓存已有历史解析信息，之前的离线消费者测试没有揭示这个准备条件。它不是框架运行时代码在 Linux 出错，也不是应该跳过独立消费者的理由。

修正增加显式 [缓存准备](../scripts/linux/warm-cache.ts)：联网阶段为 raw/core/launcher/SDK/React 五种安装形态创建临时 seed 消费者，保存解析日志和锁文件，随后删除 seed 安装目录。驱动再断开容器 bridge 网络，主机 inspect 和容器网卡检查都确认没有外部网络后，才执行正式测试。正式消费仍创建全新临时项目并使用 `--offline`；没有复用 seed 的 node_modules，也没有把联网准备计作功能验收通过。

因此这里的承诺是“准备环境后，功能验收在断网状态下完整通过”，而不是“从零启动无需联网”。消费者可能按照自身范围解析不同的传递依赖；每轮实际锁文件均保存，不把独立消费者解析结果冒充 workspace 的同一锁文件。

## 4. 最终执行结果

| 检查 | Linux arm64 | macOS arm64 |
| --- | --- | --- |
| pnpm check（含框架/测试/脚本类型） | 151/151 | 151/151 |
| pnpm test:browser | 10/10 | 10/10 |
| pnpm test:package | 两轮，各 36 阶段 | 一轮，36 阶段 |
| 生命周期/发布故障定向重复 | 27/27 | 包含于完整回归；本轮未额外重复 |
| 示例源码类型检查 | 退出 0 | 退出 0 |
| 严格声明、P0 demo、应用 typecheck/inspect | 各退出 0 | 本轮未单独执行这四条命令；声明与应用检查另由包消费覆盖 |
| Linux offline/frozen 安装 | 退出 0 | 不以 Mac 代替此项 |

包消费的四个负向断言继续保留：无根补丁的严格 NodeNext 退出 2、缺少必要 React peer 的安装退出 1、坏源码构建退出 1、业务类型错误检查退出 1。每轮 36 阶段是检查步骤，不等于 36 个新增 Node 用例，也不是全部命令都应退出 0。

Linux 实际执行了 worker 启动/关闭、配置恢复、父进程强杀后的合作式 worker 退出及 stale 锁拒绝、发布切换/回滚故障、受管文件保护、真实监听端口释放、React Fast Refresh、开发诊断恢复、子路径深链接、连续 build 与 preview。独立消费者使用自己的 tgz 安装、CLI bin、类型与运行时；整个 kit 重定位并删除其 node_modules 后，按未变化的锁文件重新安装仍通过。故障注入不是断电实验，短时回归不是长期无泄漏证明。

## 5. 视觉检查与证据完整性

首个功能通过后的 Linux 截图显示中文为方块，原因是精简镜像缺少 CJK 字体。DOM 文本断言正常不能证明字形正确，因此镜像补充字体，并在正式验证前运行 fc-match 检查。使用更新后的镜像重新执行全部 Linux 验收；截图不通过修改页面文案、使用替换图片或复用 Mac 截图解决。

最终 Linux 结果目录为 `.cache/linux-run-Ej0JvE`，其中 results 保存全部阶段日志、两轮包消费者的结果/锁文件和截图。Linux 输入清单为 118 个文件（含生成的专用 .npmrc），其中 117 份原项目输入在运行前后与宿主再次核对；Mac 则核对 118 份选定源码/配置（包含真实主机 .npmrc 的哈希但不导出内容）。框架源码和锁定依赖在整个最终验证期间不变；后续只补结果文档与审查记录。

最终两轮独立消费者均无未预期 pageerror。截图保存于 `results/package-2/packed-consumer.png`，哈希纳入机器记录。测试不读取用户浏览器 profile；字体安装不改变主机，不作为框架包内容交付。跨浏览器/字体环境的像素一致性与真机移动端仍不是本轮验收范围。

成功和失败的测试容器都已按完整 ID 删除。最终检查没有遗留本轮带验证 label 的容器；开始时记录的 10 个其他运行中容器仍在运行。没有重启、清理或更新它们。验证镜像及本项目缓存日志保留用于复现，没有新增常驻演示服务。两个上游 reference checkout 保持干净和原提交。

## 6. 如何复现及下一步

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm test:linux
```

可复用已记录的本地镜像以跳过镜像构建：

```sh
pnpm test:linux --image sha256:acf0fa5b16b3f27f73c35c640e2efadb7a13e4fc6461cb2dfb5cbdd759f686ee
```

驱动不会启动或重启 Docker 引擎，执行前需已有 Docker 可用；它仍会为新的隔离容器联网准备依赖。项目原有 `pnpm cormi dev --root examples/basic` 使用方式不变，不要求日常应用开发进入 Docker。

下一切片重点是 Windows 原生的 CLI/bin、路径/大小写、信号/IPC、目录替换和真实包消费，再以一个小型应用验证可复用业务插件。当前没有验证 Windows、Linux x64、Alpine/musl、其他发行版或长期资源趋势。Cordis 消费者根声明补丁、公开包名归属、项目许可和正式发布审批仍未解决；包保持 private。没有推送、发布 npm 或部署。

协议与代码入口：[Linux 协议](17-linux-validation.md)、[Dockerfile](../scripts/linux/Dockerfile)、[容器内验证](../scripts/linux/verify.ts)、[源码快照回归](../tests/linux-snapshot.test.ts)。
