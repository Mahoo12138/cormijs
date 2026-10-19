# cormi P15：原生 worker 执行策略与可复用 CLI

基于 P14 本地提交 `97da0cd9b374da605fc782b8e7106f080afa4cae`。本轮交付 workerExecution 原生服务、普通命令/失败诊断提供者、显式 worker 组合和可复用 CLI 载体，修正会话结果所有权及退出重入问题。接口见 [worker 执行协议](55-worker-execution.md)。最终 macOS arm64 398项Node和19项框架浏览器回归全部通过；原生策略替换、故障与分发均在同一冻结输入下完成。

## 1. 真正拆出的策略

worker.ts 不再 import 诊断构造器、DiagnosticService 或 commandPlugin，也没有 command===diagnose 的执行分支。它只处理配置求值、原生执行会话、IPC 与进程退出。默认命令到执行器的映射属于可替换的 createWorkerProfile，而不是删掉功能或把 diagnose 改成必须完整就绪的业务中间件。

新增 `cormijs/worker` 公开入口和顶层 `worker: Plugin<WorkerProfileOptions>`。默认组合通过 ctx.plugin 安装命令注册表、可选诊断服务和具体执行器；消费者原生 inject workerExecution，应用插件仍由同一 Cordis 宿主挂载。关闭 diagnostics 后不自动补回；缺失/重复执行提供者在业务初始化之前失败。父进程 bootstrap、worker 基础组合和应用 plugins 是不同职责，不是三套生命周期。

同一个 diagnosticExecutionPlugin 已用于 audit：缺失业务依赖时仍能输出原生宿主失败报告，不执行应用命令中间件。反向场景则选择 commandExecutionPlugin 并关闭诊断服务，让普通应用命令自己处理 diagnose。自定义执行器可以明确选择不激活应用；此类结果不自动代表业务就绪。application.initialize() 重复调用共享同一次尝试，作者未 await 但已请求的初始化仍被跟踪到结束。

worker profile 在合法配置求值之后选择；因此不能声称语法错误配置也已经有插件图。原生 profile 模块通过配置静态依赖进入既有重载：测试先服务 first，写坏 profile 后旧 PID/响应保留，修复后第2代返回 repaired，原端口和最终端口都可重绑。没有新增 Node 模块热替换机制。

## 2. 载体入口不再复制一份 CLI

新增 `cormijs/cli` 的 runCormiCli(argv, options)，接受原生 bootstrap、外部取消信号和输出函数，复用标准参数、JSON 输出与控制信号绑定。导入本身不启动命令；help 不加载应用或 bootstrap；非法参数不求值配置。函数结束移除自己的监听器，不修改载体退出码或断开载体已有 IPC。正式 bin 仅负责调用它并处理自己的退出码/IPC。

严格类型和真实执行分别验证只读 argv、mode/no-watch/JSON 标志、company.vars 提供者，以及自定义 workerExecution。日常应用仍可使用原 pnpm dev；高级 launch.mjs 可以直接将 process.argv.slice(2) 交给这个入口，无须再复制 SIGINT/SIGTERM/parseArgs。该接口是同一进程的 CLI 生命周期，不承诺多个并发调用的进程信号隔离。

## 3. 结果、取消与退出所有权

自定义观察消息 execution-report 通过有界 JSON 复制后转发；不能冒充 ready/result/stopped 或覆盖 wire version。执行方法返回后、取消后、关闭后禁止迟到报告。超过64条或2MiB累计预算时明确失败，已发送观察不回滚，也不能把报告发送成功当成命令成功。默认诊断使用已有完整 Diagnosis 构造器；第三方同型消息必须遵守类型协议，外壳检查不等于完整诊断图语义验证或秘密识别。

真实 HTTP 测试覆盖执行器在取消之后才获得服务器：仍等待返回并关闭实际句柄，不对外发布 ready/result。提供者 Fiber 撤回后，既有服务关闭并以 EXECUTION_WITHDRAWN 失败结束，不静默补默认 executor；非法 URL 但有有效 close 的结果也会释放已经获得的服务器。非合作任务仍由已有准确 worker 期限处理，没有自动重放命令。

两项新增所有权测试先失败，原始日志 `.cache/p15-ownership-red.log`。其一，机制在关闭时再次读取提供者原对象的 close，接受后的 URL/方法也可被原对象改写；现改为捕获已接受元数据和准确绑定的方法，包装幂等关闭。测试变更原 handle 后确认返回 URL不变、原 close执行1次、新方法0次。

其二，同步 AbortSignal 回调再次请求 worker停止时，旧 shutdown 在保存 closing Promise 前派发取消，导致两次真正的 stopped消息。测试仅在合成子进程中观察实际 process.send，修复前记录11，修复后记录1。产品修正是先保存唯一关闭任务、再派发取消，不增加固定等待或吞掉清理错误。清理失败仍压制成功 result，大IPC结果和失败诊断的完整交付继续作为回归。

## 4. 实际打包消费

独立消费者从自己的安装树使用 cormijs/worker 与 cormijs/cli。无 Web 消费者执行 audit失败诊断、应用自有diagnose，以及原生自定义executor的观察/结果交付；NodeNext严格声明包含必须失败的错误参数和非插件worker值，不用any或skipLibCheck隐藏接口缺失。公共导入扫描包含两个新增入口，未开放内部深路径。

另一真实React消费者同时使用自定义company.vars引导、原生measuredExecution和复用CLI。执行器先初始化应用、发出公开观察、再调用注入的commands；实际dev/build/preview继续执行原应用流程。页面核对URL、标题、Node/HTML/浏览器公开值、Count交互、无开发覆盖层及基址内私有文件403。构建后扫描私有测试标记，修改环境再preview仍显示原产物的值，生成入口不改写。只临时包装该轮独立应用配置并恢复，不扩展Admin业务。

首次包消费在 `.cache/package-test-1792433862554` 的83阶段后被测试脚本拒绝，原因是新观察断言读了此前默认入口的environment-dev-server.log，而实际自定义入口保存为environment-dev-bootstrap-server.log。读取正确的dev/preview日志可见fixture:worker观察，两者都正常退出0。仅修正精确日志路径，断言没有放宽；该失败与最终全套分开保留。

## 5. 最终验证

| 检查 | 实际结果 |
| --- | --- |
| pnpm check，包含框架/脚本/测试类型 | 398/398 Node，0失败/取消/跳过 |
| P15新增契约定向重复 | 22/22，不重复计入新增测试 |
| pnpm test:browser | 19/19，0失败/取消/跳过 |
| pnpm test:package | 13个tgz，84阶段满足预期 |
| pnpm test:plugin | 默认54阶段，未执行可选字体分支 |
| pnpm test:application | 37阶段满足预期 |
| pnpm test:reliability | 默认20/100样本完整执行两轮 |
| 冻结锁离线安装、生成新的本地kit | 均退出0 |

相对P14新增22项Node：执行策略9、生命周期6、CLI载体3、依赖边界1、结果所有权/重入2、profile源码重载1。公共消费从79到84阶段，阶段包含安装/检查/浏览器及明确负向预期，不是84项新增单元测试。Node和浏览器数量分别统计，可靠性循环和重复执行不累加。

每轮可靠性仍分别执行20次原生宿主/Vite启停、20次launcher启停、100批配置/环境/失败混合和100批React生成；各记录142次资源登记与142次关闭，对应worker全部退出，101个监视会话就绪端口可重绑，最终观察资源回到原有两个PipeWrap。此有限回归不能替代长期堆内存归因，P13已有增长观察仍保留。

最新完整目录 `.cache/p15-final-539ec2bbeb` 的10条顶层命令全部退出0，每条前后检查257份源码/测试/脚本/配置/约束输入的集合与SHA。最终13个归档中61份框架源码与当前packages逐字相同；原始结果和哈希见 [机器证据](../artifacts/p15-validation.json)。之后仅补文档与证据，没有修改通过验证的实现。最终验证前已处理新增测试末尾空行，未在验收后更改被测输入。

实际打开本轮生产预览截图，custom-bootstrap、staging/production、Count:1及私有标记false与现有fixture一致；截图不用于证明executor身份，后者由本轮精确-bootstrap服务日志中的execution-report断言验证。没有改变UI设计或复用旧运行截图替代执行。

复现命令为根目录 `pnpm check`、`pnpm test:package` 和 `pnpm test:reliability`。本地kit在 `.cache/p15-final-539ec2bbeb/kit`；默认成功的临时应用按各自工具回收，没有常驻演示服务。采用自定义执行器和简化载体见协议，普通旧应用无需新增worker字段。

## 6. 生态、边界与下一步

再次按需读取固定 DeepSeek Harness 的 boot、cmdline README 和 cmdline源码，参考其应用参数归属、就绪后退出与原生 effect 注销；SHA仍是687f282e8625c6b8d11ff58211a90524be2e4317。未搬入其 vendored Cordis、commander 或 app-boot；所有既有参考checkout保持原提交和干净状态。cormi仍使用npm Cordis RC.11与已有声明补丁。

本轮不增加框架包、不升级依赖、不改core、React/Vite provider或浏览器runtime，也不改变Admin产品。所有包仍private，不推送、发布或部署；旧试用项目和无关服务未被用于故障注入。父进程引导与子进程执行插件均为可信代码，Context/超时/报告预算不构成恶意代码沙箱。

下一项聚焦 TypeScript 插件的 solution/project references：这是已有真实应用的工具链缺口，应在领域插件完成多项目依赖、生成根与失败传播验证，而不是继续扩大bootstrap抽象或新增演示。Windows继续挂起；其他平台、数小时资源趋势、P13堆增长归因、无消费者声明补丁的公开分发、中断发布恢复均不因有限回归自动关闭。
