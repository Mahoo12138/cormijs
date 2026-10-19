# cormi：插件优先复核与开发态可靠性基线

日期：2026-10-19。本文记录 P13 的设计来源、边界审查和验证契约；不是整个框架已经完全插件化或长期稳定的认证。实际执行结果见 [P13 记录](52-p13-results.md)。

## 1. DeepSeek Harness 的具体参考

本地 `references/deepseek-harness` 为官方 `deepseek-ai/deepseek-harness` 的独立浅克隆，固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。没有安装其依赖或执行上游脚本；不进入 cormi workspace、提交或归档。根 MIT 许可文本保留，不能据此跳过将来逐包复用时的核验。读取范围、SHA 与版本差异另存于 [参考清单](../artifacts/deepseek-harness-reference.json)。

源码事实：其 [architecture](../references/deepseek-harness/docs/architecture.md) 将模型适配、工具、会话记录及 agent loop 本身视为可替换插件，profile/bundle 负责组合；能力接缝需要定义、提供者和消费者三个角色。其配置可选择启用或省略 HMR，而不要求所有应用都内建相同更新策略。

具体实现不是一句口号：[Hmr](../references/deepseek-harness/packages/boot/hmr/src/index.ts) 是注入 loader/timer 的 Service，`runExclusive()` 序列化变更，`watchConfig()` 返回能等待排空的注销函数。另一方面，[scope](../references/deepseek-harness/packages/core/scope/README.md) 是可以不依赖 agent loop 的纯库；“所有产品能力可替换”不等于“每个纯函数都必须注册成服务”。

版本事实：[vendor 清单](../references/deepseek-harness/vendor/README.md) 的 Cordis 上游基础为 rc.7，该 checkout 的包自身分发标识为 `@deepseek-ai/cordis@4.0.5`，并有实际运行时改动，包括 effect 重入关闭和 loader 行为。cormi 的 npm Cordis 仍为 4.0.0-rc.11，补丁只改声明。本轮借鉴职责和验收方式，未复制其 vendored runtime、改名 Context 或引入第二套生命周期；不能承诺这些生态插件直接兼容。

## 2. cormi 当前的边界审查

| 能力 | 当前归属 | 本轮判断 |
| --- | --- | --- |
| 插件初始化、依赖可见域和受管退出 | 原生 Cordis，ProjectRuntime 做有限就绪/错误适配 | 保留，不另建状态机 |
| Web 会话编排与发布 | plugin-web 的原生插件 | 消费 builder/application 契约，不认识 Vite/React 实现 |
| React 路由和入口生成 | plugin-react | 可不挂载 Vite provider 使用生成服务；本轮批次不是物理无 Vite 安装树测试 |
| Vite 及 React 专属转换 | provider/bridge，preset 负责默认组合 | 不上移到 core 或 launcher |
| 本轮 watcher/timer/HTTP 监测 | scripts 下的显式测试插件与外部采样器 | 不加入默认 preset，不发布监测端点 |
| watch 默认值、命令到 NODE_ENV 的映射、环境文件策略 | 当前 launcher/bootstrap | **仍是待拆分的策略接缝，不称为完全插件化** |
| diagnose 的启动期保留分支 | 当前 launcher + 可选原生 DiagnosticService | 允许失败宿主诊断，但观察策略与执行载体仍值得进一步分离 |

新增根 `AGENTS.md` 固定这条审查规则：每项产品能力说明契约、provider、consumer、组合替换点与退出所有权；读取固定生态源码而非凭旧版本印象。不能把“放在 plugin 目录”或“core 没有 import Vite”当作架构已经完成的证明。

新增 `tests/plugin-boundaries.test.ts` 检查 core、builder、launcher、Web/React 编译和浏览器 runtime 的依赖声明及字面 import/export 边；反向导入具体后端、跨包相对路径和浏览器导入 Node 会失败。解析器识别 type import/export、字面动态 import 和 require，不把生成代码字符串误识别成真实模块边。计算模块名、任意第三方副作用和产品策略耦合仍需人工审查；这不是安全扫描或全面架构证明。

## 3. 最小真实修复：立即取消后仍应观察就绪失败

宿主可从公开 `runCormi` 的 `starting` 回调同步取消。旧 `cancellable()` 看到信号已经取消就立即返回拒绝，未给底层就绪 Promise 安装拒绝观察者。随后 worker 正常退出 0，仍使无人观察的就绪 Promise 以 WORKER_EXITED 拒绝；严格未处理拒绝模式下，父进程因此异常退出，不能完成自己的正常收尾。

修正只改变等待边界：即使调用者已经取消，也观察底层任务最终成功或失败；取消只终止当前等待，不声称底层异步任务瞬间不存在。不重试命令，不增加固定睡眠，不吞掉未取消命令的真实错误。真实子进程分别测试首次启动和旧 worker 已退出后的替换启动；独立 tarball 消费者也运行相同公开 launcher 入口。

## 4. 可复现的有限可靠性样本

`pnpm test:reliability` 默认 cycles=20、batches=100。它依次运行三个不同契约，不能把数字混成一批“全浏览器场景”：

**原生宿主/后端启停。** 三轮预热后，20 次完整创建 Cordis 宿主、挂载 Web consumer 与真实 Vite provider、请求转换模块、触发真实 watcher/timer，再退出。每第五轮清理器在释放自有资源之后故意抛错，必须报告 CLEANUP_INCOMPLETE；其余资源仍释放，端口可重绑，Vite 会话缓存不残留。

**launcher 与配置变更。** 预热后20次公共 launcher 启停，各自实际 fork worker。随后一个监视会话执行100批输入：传递配置模块连续替换、选定环境文件连续替换、坏配置/坏环境保留旧服务及无重启风暴、初始化失败后修复并改变显式 watch 文件。每批通过实际 HTTP 检查最终 version/env/stamp，而非只看日志写了 ready。测试插件以原生父子组合提供 watcher/timer 服务和注入它的 HTTP consumer。登记与清理日志成对，关闭后的 watcher 不再交付回调，最终逐一检查记录的 worker 已退出、端口可重绑、锁与 run 缓存消失。

**React 生成。** 不挂载后端实例，仅通过 reactPlugin 和 application 服务执行100批真实页面删除/创建；最后生成清单应只含首页与当前页面。每十批制造一次 JSX/TSX 同路径冲突，错误时旧入口字节保留，修复同内容不写入口、不发更新通知。每个成功批次使用 readInspection 再核对类型/入口/清单一致性，退出等待生成与通知结束。

文件变化来自真实写入/原子替换，不是只向内部队列传100个数字；但它仍是合成工作负载。该 driver 没有浏览器，完整浏览器和独立包消费属于另行执行的回归。这里的低层 fixture 明确使用 workspace 链接，不冒充独立包安装。

## 5. 资源与内存的证据边界

读取 [Node 22.14 process.getActiveResourcesInfo](https://nodejs.org/download/release/v22.14.0/docs/api/process.html#processgetactiveresourcesinfo) 的事件循环活跃资源类型，按种类比较预热基线，不允许少两个 PipeWrap 抵销新增一个 watcher。独立测试确认真实 HTTP listener 能被观察，关闭后计数回落；瞬时文件读取请求不被当作常驻 watcher。

关闭成功还要求实际端口可重绑、精确记录的 worker PID 不再存在、原生插件自有 watcher/timer 归零。类型计数不是所有文件描述符、unref timer、观察器和堆对象的完整清单，不能用它单独证明任意插件没有泄漏。

主测试进程使用可选 `--expose-gc` 的同阶段采样，保存 heap/RSS/external/arrayBuffers；新 worker 的 HTTP 样本单独记录，没有在业务 worker 中开启测试 GC。内存值包含测试日志/观察数组和第三方缓存，跨不同进程或阶段不能直接当作同一工作负载斜率。报告保留原始序列，不设一个任意宽阈值把增长自动判为无泄漏。有限20/100基线不代表数小时运行、其他平台、全部浏览器或全部第三方插件均稳定。

```sh
pnpm test:reliability
# 缩小输入仅用于调试；baselineProfile 会明确为 false。
pnpm test:reliability --cycles 3 --batches 5 --out .cache/reliability-small-new
```

输出目录必须不存在；失败保留临时输入和结果，成功只删除本轮自有临时目录。已有项目、个人浏览器和其他运行服务不作为实验目标。

## 6. 下一处插件化接缝

接下来优先设计 launcher 的可装配引导/重载策略，而不是直接移植 Harness 的千行 HMR 或给每种策略建新 core 特例。启动机制继续持有准确子进程、锁、取消和最终退出；默认环境/命令/watch 策略应有明确的可替换入口，且能在应用配置本身无效时工作。替换策略的测试必须保留这次取消、过期输入、失败保旧及资源回落契约，不能为了可插拔重新引入多套生命周期或自动重放有副作用命令。
