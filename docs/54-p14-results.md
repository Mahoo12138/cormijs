# cormi P14：原生 Cordis 引导插件与启动策略

接续 P13 `7a05702bdb2b269ee235be44aa87a3b2d3fcd1d7`。本轮将启动前的命令语义、环境读取和重载唤醒改为可装配的原生 Cordis 提供者，保留准确子进程、项目锁、输入代际、取消与结果交付机制。最终 macOS arm64 376项Node与19项框架浏览器回归全部通过；新引导接口和独立消费已在同一冻结输入下完成复核。接口、完整载体示例和限制见 [引导插件协议](53-bootstrap-plugins.md)。

## 1. 交付的可替换能力

`cormijs/bootstrap` 新增公开入口，提供 `createBootstrap()`、默认原生组合和三个服务类型：launchPolicy、launchEnvironment、launchReload。`runCormi({ bootstrap })` 接受原生 Plugin<void>，应用不需要认识引导组合的内部子插件。默认CLI仍选择此前的命令/mode/NODE_ENV、四层dotenv和轮询行为；没有新增隐藏配置文件、强制修改旧应用或假装已经支持CLI的 --bootstrap 参数。

这不是给三个普通回调起一个“插件”名字。parent使用已有ProjectRuntime建立原生Cordis宿主，机制消费者声明三个inject，通过实际绑定读取服务；各provider和父组合由ctx.plugin装配，资源由原生effect撤回。缺失/重复provider在应用worker之前失败，撤回必需provider会终止当前运行而不静默切回默认实现。worker中的应用配置和业务插件仍不在parent执行，两边是同一套Cordis机制的不同宿主，不是两套生命周期。

应用配置可能首先就损坏，因此bootstrap由可信载体在 `cormi.config.ts` 之外选择。原有坏配置修复、缺失传递依赖恢复、参数显式覆盖约束和一次性结果不重放依然适用。实际执行命令不会被configurationCommand偷偷替换；mode/watch/目标命令的显式输入不能被默认策略覆盖。

环境快照统一经过有界结构校验和冻结，然后沿原私有IPC进入worker及公开客户端编译。`readEnvironmentFiles()` 可读取明确选定的根目录dotenv文件；另公开同一机制的 `fingerprintFiles()`，让自定义JSON解析器无需深导入内部文件或复制指纹算法。提供者选择文件和解析内容，机制仍复核其声明的输入是否已经变化；不声称能验证任意可信代码的实际推导过程或提供文件系统事务。

## 2. 冷启动、撤回和异步清理

新增测试实际用原生fs.watch加有界兜底定时器替换默认唤醒提供者，先从语法错误配置启动，修复后再补上缺失的settings模块。随后损坏自定义company.vars，旧HTTP响应和PID保留；修复后新值生效。另一份未选择的坏.env不参与读取，测试同时核对监听路径、真实事件、关闭后的watcher归零和端口可重绑。

撤回正在提供launchReload的原生Fiber时，载体报告BOOTSTRAP_WITHDRAWN并关闭正在服务的准确worker，不暗中恢复默认轮询。异步引导初始化与环境读取取消分别使用gate，确认清理真正完成前不会释放项目锁。非合作任务超过清理期限会保留锁并阻止第二个启动器；后来任务结束也不自动删除这把需要人工核验的锁。

原生上下文退出后仍企图登记子插件被单独作为失败契约测试，不为得到退出0而吞掉错误。合法的初始化等待与非法的迟到登记保持两种不同结果。一次性命令即使使用watch=true策略并改写自身配置，也只执行一遍。

## 3. 在实现中复现并修正的问题

最初两项bootstrap契约先在旧实现失败，记录为 `.cache/p14-bootstrap-red.log`：旧载体忽略传入的自定义组合，没有使用其服务或在缺失provider时拒绝启动。

异步准入复核中的两个失败记录在 `.cache/p14-admission-red.log`。其一，提供者已读旧环境快照，等待期间文件变新；旧处理把新磁盘指纹登记为已处理失败，导致再无编辑时一直不能启动最新值。现在明确区分CONFIG_CHANGED/ENV_CHANGED的不稳定读取与稳定的坏语法，前者重新读取最新输入，后者仍同内容去重。其二，准备期限结束必须停止准入并取消/等待当前任务，不能留在监视循环里等待另一个输入或累积未完成读取。

额外退出测试 `.cache/p14-terminal-red.log` 复现reload提供者抛错后，Promise虽然拒绝，stopped事件却仍写code=0。现在保留原错误和失败状态，并关闭worker。另一个严格子进程测试 `.cache/p14-metadata-red.log` 发现未类型检查的异步元数据提供者返回拒绝时，旧路径将Promise当普通配置报告CONFIG_INVALID，丢失实际失败原因；现在元数据调用也纳入受管等待，观察返回工作和原拒绝。公共metadata类型仍是同步接口，不把该兼容防护推广成任意异步元数据插件沙箱。

早期正向初始化测试把ctx.plugin写在取消后的gate之后，触发原生已销毁上下文错误。修正正向fixture为先登记正常子插件，再等待初始化，同时保留迟到登记应失败的独立用例。首次独立浏览器消费又因为测试请求 `/company.vars` 跳出 `/stage/` 而得到404；测试改为基址内的 `company.vars?raw` 验证403，没有放宽后端拒绝规则或把404改认作同一个契约。

## 4. 分发与浏览器验收的边界

独立消费者使用真实安装的 `cormijs/bootstrap` 和 `cormijs/launcher`，不从workspace取内部实现。无Web消费者配置自定义命令策略，并用自己的JSON读取器解析company.json；只依赖公共fingerprintFiles、Node文件API和native ctx.provide，就能返回符合统一协议的环境快照。严格NodeNext类型检查包含负向断言，服务接口不退化为any。

另一独立React应用替换为company.vars提供者，同时保留一份未被选中的坏.env。开发页面检查实际URL、HTML标题、Node配置快照、客户端公开值、overlay、console和Count交互；基址内私有输入请求应被拒绝。构建后扫描私有测试标记，再修改company.vars并启动preview，页面应仍显示已构建的旧值且不改写生成入口。这里不使用截图代替值、MIME或结果契约，也不扩展Admin页面。

后端、React runtime、core和业务插件代码没有因本轮增加分支。入口包新增对相同精确Cordis版本的直接依赖以提供公开类型增强，锁文件仅增加这个importer关系，没有升级依赖、改变上游运行时或新增框架包。全部13包仍private，消费者根声明补丁保留。

## 5. 最终结果

| 验证 | 实际结果 |
| --- | --- |
| pnpm check，包含框架/测试/脚本类型检查 | 376/376 Node，0失败/取消/跳过 |
| 新引导契约定向重复 | 18/18，不重复计为新增测试 |
| pnpm test:browser | 19/19，0失败/取消/跳过 |
| pnpm test:package | 13个tgz，79个阶段满足预期 |
| pnpm test:plugin | 默认54阶段，未执行可选字体分支 |
| pnpm test:application | 37阶段满足预期 |
| pnpm test:reliability | 默认20/100样本完整执行两轮 |
| 冻结锁离线安装、重新生成本地kit | 均退出0 |

相对P13新增18项Node测试，公共包消费从73到79阶段。步骤包含安装、类型、命令、HTTP与明确负向预期，不当作79项新增单元测试。可靠性每轮各20次原生宿主/Vite启停、20次launcher启停、100批配置/环境/失败混合及100批React生成；各记录142次资源登记与142次关闭，对应worker全部退出、101个监视会话就绪端口可重绑。两个最终资源样本都回到原有两个PipeWrap。这是当前环境的有限样本，不消除P13记录的堆增长归因和长期稳定性门槛。

最新完整目录为 `.cache/p14-reviewed-bef4614f40`。十条顶层命令全部退出0，每条前后核对248份源码/测试/脚本/配置/约束文件的集合与SHA。最终13个归档中的58份框架源码与当前packages逐字一致；细节见 [机器证据](../artifacts/p14-validation.json)。此后只更新说明和证据，没有改变通过验证的实现。

此前 `.cache/p14-final-ea0af5e58d` 也曾完整通过；复核发现自定义解析器不应深导入指纹函数，因此随后只在产品入口公开已有fingerprintFiles，并将无Web消费者改为真实JSON解析、补严格声明消费。最新完整十命令在这两份受影响源码变更后从头运行，不把两次输入混成同一份结果。更早的374项Node、测试URL错误和各红色断言另行保留，不据此抹去中途失败。

复现入口为框架根目录 `pnpm check`、`pnpm test:package` 和 `pnpm test:reliability`。旧应用仍可按原 `pnpm dev` 使用默认组合；采用自定义引导需按协议创建显式载体入口，不能只将bootstrap写进应用plugins数组。现成本地kit在 `.cache/p14-reviewed-bef4614f40/kit`，未发布注册表或部署常驻服务。

## 6. 参考与下一步

本轮再次读取固定DeepSeek Harness architecture的profile/bundle组合和Hmr Service的inject、runExclusive与可等待注销，仍使用 `687f282e8625c6b8d11ff58211a90524be2e4317`。没有复制其vendored Cordis或千行模块HMR。已有Cordis、Umi、Koishi、WebUI、Satori及Harness参考目录保持原固定提交；原开发约束继续由根AGENTS.md和依赖边界测试约束。

**worker内diagnose的失败宿主执行分支尚未插件化。** 配置编译器、公开前缀/继承覆盖规则及现有数据协议也没有全部改成任意策略。当前只通过程序化载体选择引导组合，不提供自动发现/引导源码HMR、在线提供者无停机更换、远端密钥库或通用RPC。

引导插件是在父进程执行的可信代码，同步死循环不能被同线程期限强制抢占；取消和清理观察不是安全沙箱。Linux/Windows、其他浏览器、数小时资源趋势、Cordis无根补丁的公共分发、完整TS项目引用及中断发布恢复继续分别保留，有限回归不能使这些项目自动关闭。

下一项聚焦worker命令/失败诊断执行的原生扩展与载体入口使用体验，不转向Admin业务、插件市场或扩大演示功能。保留大IPC结果、一次性命令不重放、就绪失败和清理失败等已验证的契约。
