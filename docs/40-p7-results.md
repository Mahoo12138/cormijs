# cormi P7：原生服务依赖与贡献来源诊断

日期：2026-10-19。基于 `5b42a76345d237f3b0706e44fa7ebee096928a3b` 继续。本轮交付 `cormi diagnose`、`ProjectRuntime.graph()` 和可选 `DiagnosticService`，从真实 Cordis 实例解释插件状态、服务提供者、依赖绑定和贡献身份。Admin 只是独立安装的验证负载，没有修改模板业务或 UI。精确协议见 [插件诊断](39-plugin-diagnostics.md)，原始命令、失败分类和源码校验见 [机器证据](../artifacts/p7-validation.json)。

最终完整验证：**287 项 Node、17 项框架浏览器测试全部通过，0 失败、0 取消、0 跳过**；13 个真实框架 tgz 的独立消费者共64个阶段满足预期。相对P6新增18项Node测试和3个消费阶段，重复运行和Admin观察数不累加为新增测试。

## 1. 已经可以直接使用

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm build
pnpm cormi diagnose --root examples/features --for dev
pnpm cormi diagnose --root examples/features --for build --mode staging --json
```

正常文本实际显示 preset 与用户插件来源、父子关系、ACTIVE/PENDING/FAILED 等状态、服务实例与依赖解析。例如 features 的 web 插件需要 builder，报告实际绑定到 vite 提供者；status-feature 注入 react；配置派生 hook 标明 example:deployment:base 和声明来源。

`config` 仍解释应用配置派生，`inspect` 仍读取最后成功生成快照，`diagnose` 只观察新 worker 中初始化后的插件/服务。它不执行目标 dev/build handler、不执行应用命令 middleware、不调用路由或配置派生回调，也不改写已有生成入口和构建产物。JSON保持既有逐行事件协议，成功报告位于 result.data；就绪或采集失败先交付 diagnosis.data 再非零退出，不能把一份失败JSON当作成功启动。

**这不是运行中 dev 的在线诊断。** 它会重新求值可信配置并初始化插件，仍遵守项目独占锁；已有 dev 正在运行时不能绕过锁查看。同一配置的初始化副作用依然可能发生，不能称为纯静态无副作用扫描。配置语法错误或根结构非法时没有已初始化宿主，只返回原有配置错误，不编造服务图。healthy仅表达本次宿主就绪与采集结果，不保证目标命令存在、业务源码正确、端口可用或构建成功。

## 2. 诊断的事实来源

`ProjectRuntime.graph()` 同步读取 Cordis registry、Fiber父子关系、inject、provisions、committed 和按 Context.isolate 定位的 reflect.store。注册信息、提供者存活状态、消费者已绑定实例分别记录，不通过名称相似推断关系，不读取服务value或插件私有options。

同名服务位于不同隔离域时，图中指向不同具体实现；正在卸载的提供者与正在清理的消费者，可能仍有已提交的旧绑定。报告区分 bound、retained-binding、missing、provider-not-active 和 visible-unbound。最后一种明确表示只观察到“活跃实现可见，但尚未绑定”，不会为得到更漂亮的原因再次调用服务check。

本轮继续读取固定WebUI的ServiceProvider实现以理解服务/作用域诊断，但没有照搬其Cordis3内部结构。适配器使用当前安装的Cordis4 RC.11公开声明和实测行为；`Impl`并非根入口导出类型，改为从公开Fiber的provisions类型推导，没有深导入内部声明或修改补丁。另有回归证明读取快照不会访问会递增的registry.counter。

## 3. 贡献元数据也使用原生作用域

`DiagnosticService` 是可选Cordis服务，CLI在应用插件之前安装；直接使用低层ProjectRuntime的程序可自行决定是否安装。读取器通过调用者effect登记/撤回，不创建第二套插件生命周期。

当前接入命令名、React路由/runtime hook、应用配置derive hook，以及开发API贡献与公开路径。API记录真实调用者ownerUid；编译hook现有owner标签使用declaredOwner，不伪装成已经验证的Fiber身份。第三方未接入的领域不在报告内，诊断不会遍历任意服务并调用它的summary函数。

元数据只允许身份字段，拒绝额外私有字段、访问器、稀疏数组、异步读取器和超预算结果。失败状态明确为failed，原异常/配置/代理目标不序列化到报告。采集期间注册表变化会使整批结果成为stale，采集前后宿主图变化也不能宣称一致快照。身份标签本身必须是公开数据，这不是任意密钥检测或不可信插件沙箱。

复核新增断言先复现：注销后一个采集器时，旧实现将撤回延迟到微任务，导致它仍从当前迭代快照执行。修复为同步关闭读取准入，再等待原生effect清理；原断言通过，旧注销句柄也不能删除后来同ID的注册。

## 4. 真实独立应用证明了什么

专用副本位于 `.cache/admin-cormi-p7-589a1109ae`，使用本轮实际框架tgz和独立Node/client测试插件tgz。诊断驱动 `scripts/admin/diagnose.ts` 只临时包装配置，没有改写Users、主题、图表或数据。五组契约完整执行两轮：

| 场景 | 实际断言 |
| --- | --- |
| 开发环境插件树和贡献 | 17个节点、9个服务；fixture:extension-api的ownerUid为16，父节点关联installed-extension，devApi依赖已绑定 |
| 生产目标 | 客户端runtime贡献保留，开发API贡献为空；目标build并未执行 |
| 禁用插件 | configured明确enabled=false，不能伪造PENDING节点或残留API贡献 |
| 缺少provider | 嵌套API插件PENDING、devApi为missing，readiness为SERVICE_MISSING且退出1 |
| 修复 | 恢复配置后healthy=true，所有diagnose调用均保持原生成与dist文件哈希不变 |

额外执行了一轮P6真实浏览器请求回归，五组Mock/代理、取消、插件撤回及生产隔离继续通过。测试结束恢复配置并重新检查/构建正常应用，src/public哈希前后相同。新的diagnose测试没有用截图或首页HTTP200替代图/产物断言，也没有为这轮增加后台产品功能。

## 5. 最终验证与修正历史

| 检查 | 最终结果 |
| --- | --- |
| pnpm check：框架/测试/脚本类型与Node回归 | 287/287 |
| 新增诊断回归定向重复 | 18/18，不重复计入新增数量 |
| pnpm test:browser | 17/17 |
| pnpm test:package | 13个框架tgz、64个阶段，包含预期非零断言 |
| 独立Admin诊断 | 两轮，每轮五组通过 |
| Admin原开发API请求/取消/撤回/生产隔离 | 一轮五组通过 |
| 应用和workspace冻结锁离线安装 | 均通过 |
| features示例文本诊断 | 退出0，实际输出已保存 |

最初完整运行 `.cache/p7-final-589a1109ae` 中，框架、浏览器和包消费已通过，但Admin测试配置字符串少一个右花括号，导致CONFIG_COMPILE_FAILED。没有修改框架解析器迎合坏fixture；只修复测试字符串后，从pnpm check重新执行全部十条最终命令，当前完整结果目录为 `.cache/p7-reviewed-d06e7147cc`。它不是把首轮失败忽略后拼成全绿。

另一个早期失败来自对RC.11卸载时序的错误假设：原测试认为provider卸载立即删除store项，实际probe显示它还在等待consumer结束。修正报告语义与断言，分别验证whole-provider dispose和显式provide撤回两种场景。失败日志、真实探针和类型入口修正均保留。

最终每条命令前后核对197份框架/测试/脚本/配置输入、253份独立应用输入。随后核对13个归档中49份框架src与当前源文件逐字一致；应用358处安装链接都在自己的安装树内，没有指回workspace。代码验证后只补文档和汇总证据，依赖版本、根package.json、pnpm-lock及Cordis声明补丁均未修改。

本轮参考checkout没有执行更新或源码写入；Cordis、Koishi、WebUI、Satori均为前述固定提交且干净。Umi当前本地HEAD是 `2d368e378d10831e7a56b6eaa6e2ae705b1f3c78`，不同于早期历史记录，按当前观察记录而不推断更新来源；P7不依赖Umi实现。环境仍是macOS arm64、Node22.14.0、pnpm10.6.3和隔离的已有Edge浏览器。未执行Linux/Windows、长期趋势、完整调用历史或在线诊断，不沿用历史平台成绩为新增功能背书。

## 6. 后续范围

插件诊断的第一条可用链路已经交付。后续优先把已验证的Node/client配对方式整理为插件作者可直接创建、打包和消费的项目模板与文档，而不是继续扩张诊断UI或插件市场。在线快照、完整历史、任意Cordis版本适配、消费者无需声明补丁的公共分发仍需独立验证。本轮不推送、不公开发布、不部署，不留下自己创建的常驻服务。

> 2026-10-21：为避免磁盘耗尽，`.cache/admin-*` 历史验收快照已按用户确认清理；本文中的这些路径不再存在，历史结论以文字与 `artifacts/` 记录为准。
