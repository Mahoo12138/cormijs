# cormi P13：插件优先审查与开发态可靠性基线

日期：2026-10-19。接续 P12 `11141d41f87005bb5614f0f4f231baa53fe30346`。本轮交付一处 launcher 取消边界修正、可重复执行的20次启停/100批文件变更基线、插件依赖边界检查和持续架构约束。DeepSeek Harness 已作为固定源码参考进入本地。本轮没有扩展 Admin、引入第二套 Cordis 生命周期或在产品内核新增监测接口；实现协议见 [插件优先与可靠性](51-plugin-first-reliability.md)。

最终 macOS arm64 **358项Node、19项框架浏览器测试全部通过，0失败、0取消、0跳过**；13个真实框架tgz的独立消费者73阶段、默认插件作者54阶段、完整新应用37阶段满足预期。可靠性默认样本从头执行两轮，两轮各20次原生宿主/Vite启停、20次launcher启停、100批配置/环境/失败混合、100批React页面生成。相对P12新增6项Node测试，不把循环次数、HTTP请求或流程阶段累计成新增单元测试。精确输入、原始日志和报告哈希见 [机器证据](../artifacts/p13-validation.json)。

## 1. “万物皆插件”落实为审查与测试

根目录新增 `AGENTS.md`：每项产品能力必须说明契约、原生Cordis提供者、声明依赖的消费者、可替换组合与资源退出归属；不得新建第二套生命周期，不因测试方便向core添加监控单例、端点或开关。纯函数与无副作用工具无需为了名字而变成服务。

新增依赖边界检查覆盖core、builder、launcher、Web/React编译和浏览器runtime的manifest及源码字面模块边。反向导入具体后端、跨包相对引用、浏览器引入Node模块会失败；类型导入、re-export、字面动态import/require也纳入，不把生成代码中的字符串误认为真实依赖。计算模块路径、第三方副作用和策略耦合仍需源码审查，这个门禁不等于完整架构或安全证明。

本轮审查没有把现状说得过满：**watch默认行为、命令到NODE_ENV的映射、环境文件加载策略，以及diagnose的保留启动分支，仍在bootstrap/launcher中耦合。** 它们不会因为core没有import Vite就自动成为可替换策略。相关接口列为下一处设计工作，而不是永久以“启动必须提前执行”免除插件化审视。

## 2. DeepSeek Harness 已保存并核对设计

位置为 `/Users/mahoo/Projects/cormijs/references/deepseek-harness`；官方仓库为 `deepseek-ai/deepseek-harness`，浅克隆固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。工作树干净，没有安装上游依赖、执行上游脚本或将源码纳入cormi的workspace/归档。已有Cordis、Umi、Koishi、WebUI、Satori仍保持各自已记录提交。

实际参考了其architecture中的profile/bundle组合、能力定义/provider/consumer三角色，Hmr Service的loader/timer依赖、变更序列化和可等待注销，以及scope纯库的作用域归属。测试监测也按这一分层：原生父插件组合资源provider和HTTP consumer，外部脚本负责驱动文件事件及采样，不把监测放进框架核心。

必须区分版本：该checkout的vendor文档记载Cordis上游基础为rc.7，包自身使用 `@deepseek-ai/cordis@4.0.5` 分发标识并包含运行时改动；cormi继续使用npm `cordis@4.0.0-rc.11` 和仅声明补丁。这里没有复制Harness运行时或承诺其插件可直接安装。读取范围及文件SHA见 [参考清单](../artifacts/deepseek-harness-reference.json)。

## 3. 修复的真实问题：刚启动就取消，父进程异常退出

公开 `runCormi` 的调用者可以在 `starting` 回调中同步调用AbortController.abort。旧 `cancellable()` 发现已经取消就立即拒绝，未观察底层就绪Promise；随后worker正常退出0，却使该Promise以WORKER_EXITED拒绝并成为未处理异常，严格模式下父进程退出1。

原断言在修复前真实失败，保存在 `.cache/p13-start-stop-red.log`。修复只位于 `packages/cormi/src/supervisor.ts`：取消终止等待，但始终观察底层任务的最终结果并释放自己的取消监听器。不加固定sleep，不重新执行命令，不将真实失败包装为成功。修复后原测试通过，又补了“旧worker已关闭、替换worker开始发布时立即取消”的组合回归；独立tarball消费者也验证相同公开入口，新增阶段名为 `packed-starting-cancellation`。

## 4. 默认可靠性样本实际完成了什么

**宿主与后端。** 每轮先预热3次，再进行20次完整Cordis宿主、Web consumer、真实Vite provider启停，实际请求转换后的模块、触发文件watcher和timer。每第五次在资源释放之后故意使清理器抛错，要求返回CLEANUP_INCOMPLETE且其余资源继续清理。每次端口可重新绑定，Vite临时目录不残留，退出后的原生挂载UID为空。

**launcher与混合变更。** 每轮先预热，再20次启动和关闭独立worker；随后一个监视会话完成100批输入。包含三次紧邻的原子替换、选定环境文件更换/删除、语法错误保旧和修复、插件初始化失败与显式watch输入变化。每批读取真实HTTP的version/env/stamp核对最新输入，不仅查ready日志。相同坏输入保旧期间另观察三个轮询周期，确认没有新的starting风暴。

两轮分别记录 **142次资源登记与142次关闭**，142个已记录worker全部退出；监视会话的101个就绪端口逐一验证可重绑，前面的独立启停端口也在各自退出时检查。每个活跃探针只有自己的一个watcher和一个timer，清理后均归零，关闭记录之后没有其watcher迟到回调。锁与run缓存均清理。PID数量是这次实际代际的观察结果，不写死为未来任何调度都必须恰好142。

**React生成。** 在没有挂载builder/Vite provider的宿主中各执行100批真实页面删除/创建；每批检查最终清单只有首页和当前页面，并由readInspection核对生成集一致。每十批引入一次相同路径的JSX/TSX冲突：失败时旧入口字节不变，移除冲突后同内容修复不改mtime、不发送额外更新。该driver使用同一workspace安装环境，且进程其他阶段载入过Vite；这里证明无后端实例的领域服务运行，不冒充整个依赖树里物理没有Vite。

这些是三个分别执行的有限契约，不是一个贯穿浏览器的100轮压力场景。原19项浏览器全套和真实包消费另外执行，未拿计数器首页或旧Admin截图替代可靠性证据。

## 5. 资源回落不等于堆内存完全持平

活跃资源按类型与预热基线比较，不能用少几个PipeWrap抵销新留下的TCPServerWrap或FSEventWrap。新观察回归实际创建HTTP监听器，确认采样能发现它、关闭后回落。原生阶段20次结束后的样本均只剩原有两个PipeWrap；生成运行阶段保留自己的一个Timeout，关闭后回落。这里只观察Node报告的活跃资源类和明确拥有的资源，不覆盖全部文件描述符、unref对象或任意第三方内部监听器。

**内存并非完全平坦，不能报告“无泄漏已证明”。** 第一轮原生20次同阶段GC后heapUsed从30.067MiB到31.892MiB，第二轮30.063MiB到31.888MiB；生成100批分别从33.232到33.607MiB、33.226到33.601MiB。报告保留了序列，没有设置宽阈值把增长判为正常。

接续复核因此增加一个不修改产品代码的独立探针：cormi包装与裸Vite各在单独进程中预热3次、执行40次启停，使用WeakRef观察准确的server/host对象，并比较process监听器数量。cormi样本heapUsed从14.120到15.685MiB，裸Vite从14.026到15.698MiB；两边被观察server最终均无存活目标，cormi host也为0，所测process监听器数量未增长。探针源码与完整序列保存在 `.cache/p13-memory-probe-30ef846011` 并纳入机器记录，没有导出包含任意进程内数据的堆快照。

这说明增长不是“这些被观察的整个server/host对象一直存活”的证据，**并未定位全部retainer或证明增长都来自某个上游库**；裸Vite与框架配置并非完全相同，也不是性能对比结论。更长时间和对象级归因仍保留为门槛，不能将有限样本通过扩张成长期稳定认证。

## 6. 最终验证及接续证据

| 检查 | 结果 |
| --- | --- |
| pnpm check，含框架/测试/脚本类型检查 | 358/358 Node |
| 新取消/边界/资源观察定向重复 | 6/6 |
| pnpm test:reliability | 默认20/100配置，两轮通过 |
| pnpm test:browser | 19/19 |
| pnpm test:package | 13个tgz，73阶段满足预期 |
| pnpm test:plugin | 默认分支54阶段，未执行可选字体分支 |
| pnpm test:application | 37阶段满足预期 |
| 冻结锁离线安装、重新pack本地kit | 均退出0 |

最终完整目录 `.cache/p13-final-477a962170`，10条顶层命令全部退出0；每条前后检查238份源码、测试、脚本、配置和约束文件哈希。会话中断后先取回原Job的完成结果并重新核对这些输入与日志，没有盲目重复启动原执行。13份最终tgz中55份框架源码与当前packages逐字一致。暂存差异检查随后发现 `tests/launcher-stop-race.test.ts` 末尾多一个空行，仅删除该LF；在 `.cache/p13-closeout-node` 重新执行全部类型/358项Node及6项新增定向回归，均通过。机器记录保留这一字节差异与两组输入哈希，不将它们写成完全相同。产品实现、可靠性驱动、浏览器和打包消费脚本没有变化，其他完整验收仍对应同一实现；除此之外只补文档、参考与汇总证据。

早期driver存在一个测试辅助类型问题：脚本工作区没有将cordis声明为直接依赖，直接做module augmentation失败。仅在测试探针中改用已有ctx.get并检查注入值，不修改产品依赖或放宽业务类型。该失败、最小取消红色断言、小样本和完整pilot均保留，不拼接成一轮不存在的全绿。

本轮采用现有Node22.14.0、pnpm10.6.3、macOS arm64和项目已有隔离无头浏览器。不升级依赖、不读取个人浏览器资料、不改旧Admin和试用项目、不推送/发布/部署。测试使用合成文件值和临时loopback服务；正常完成的可靠性fixture自行回收，kit和验收日志保留。

## 7. 可复现入口与下一项

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm test:reliability
```

默认20次启停和100批变更。调试可加 `--cycles 3 --batches 5 --out .cache/新的结果目录`，报告会将baselineProfile标为false；输出目录须不存在。低层fixture使用workspace链接，独立分发应另跑test:package/test:application，不混淆两者。

下一项是 **launcher引导/重载策略的可装配接缝**：把机制层的子进程、写锁、取消和最终退出，与可替换的watch/环境/诊断产品策略区分，同时保留坏配置下继续观察和一次性命令不重放的契约。不会直接搬入Harness的模块HMR，也不创建第二套Cordis生命周期。Linux/Windows、其他浏览器、数小时资源趋势、Cordis无消费者补丁的公开分发、TS项目引用与中断发布恢复仍未在本轮完成。
