# cormi P11：统一环境快照、公开变量与变更恢复

日期：2026-10-19。基于 P10 提交 `882720c5affeb811358ce379ee75b6c7d7e83ca8`。本轮完善应用环境配置，而不是新增 Admin 业务或插件市场：四层环境文件、启动前校验、私有 Node 快照、显式公开值、配置来源诊断及变更恢复已经贯通到真实 CLI、Vite 和独立打包消费者。实现协议见 [环境配置](47-environment-configuration.md)，原始命令和文件哈希见 [机器证据](../artifacts/p11-validation.json)。

最终 macOS arm64 **348 项 Node、18 项框架浏览器测试通过，0 失败、0 取消、0 跳过**。13 个框架 tgz 的独立消费验收为72个阶段；默认插件作者链路54个阶段通过。相对P10新增23项Node和1项浏览器测试；重复运行、安装步骤和负向预期不重复计为新增用例。本轮没有执行字体验收的可选分支。

## 1. 应用使用一套环境优先级

按照 `.env → .env.local → .env.<mode> → .env.<mode>.local → 继承的进程环境` 依次覆盖；继承值即使是空字符串也保持优先。缺失文件不是错误，但四个候选路径都会被追踪，后续创建、原子替换、删除可以触发重载。没有把另一个mode的文件也纳入当前自动重载范围。

`mode` 选择业务环境文件，`NODE_ENV` 由目标命令决定：dev为development，build及其他非dev目标为production；config/diagnose使用其 --for 目标。`build --mode staging` 不会因为名字不是production就构建开发包，文件里的NODE_ENV也不能改变这个策略。mode被约束为有界小写字母、数字、下划线和连字符，local保留，不能作为任意文件系统路径。

配置工厂现在接收冻结的 `env`：`defineConfig(({ command, mode, env }) => ...)`。它包含私有Node值，不应整体放进app或runtime；已有插件可以继续在初始化时读取worker的process.env。加载发生于配置模块求值之前，父supervisor的process.env不被写入。独立回归验证了模块顶层读取、继承空值、冻结快照与目标NODE_ENV，而不只是调用一个合并函数。

环境解析支持注释、export、空值、引号和多行字符串，最终值均为字符串。**不进行美元符号展开或shell命令执行**：`${SECRET}`和`$SECRET`按字面保留。未闭合引号、非法赋值和禁止的控制键会失败，不像宽松解析那样悄悄忽略后报告成功。错误只报告文件名/行号，不原样输出坏行中的值。每文件64KiB、512条赋值，合并最多512个唯一键；链接、硬链接、非普通文件和非法UTF-8被拒绝。

## 2. Node与浏览器读取同一代输入

Supervisor预检并保留已接受的环境输入，在私有IPC启动消息中交给新worker。worker在执行可信配置之前解析继承覆盖，冻结 `env` 和 `publicEnv`；Web命令通过后端无关的BuildPlan携带公开快照。core仅增加数据类型，没有dotenv解析、Vite或React运行依赖。

客户端仅获得 `CORMI_PUBLIC_` 前缀下的显式公开项。普通私有值、VITE_前缀值和配置执行过程中迟到改写的process.env值不会自动进入浏览器。公开值用于JavaScript的import.meta.env和HTML占位符；MODE/BASE_URL/DEV/PROD与已解析应用计划保持一致。低层builder直接使用时不会替调用者读取.env；可明确提供publicEnv，省略时只捕获当次进程中的公开前缀值。

`cormi config --for build --mode staging --json` 增加environment来源摘要：候选文件是否存在、变量名、公开标记、最终来源和覆盖历史，不包含变量值或内容指纹，也不枚举不相关的继承环境变量。原config字段脱敏继续保留；diagnose仍负责插件/服务，inspect仍读取最后生成快照，没有混淆三个命令。

## 3. 真实修正：Vite不能再次另读或丢弃公开值

原Vite配置中的envFile:false不足以关闭环境文件读取。当前使用该后端支持的 `envDir:false` 和 `envPrefix:[]`，先提供准确的公开define，再在已解析配置中核对公开快照，避免Node先加载.env、Vite随后按另一套优先级重新处理，或把字面美元符号二次展开。

接续复核又用两个真实Vite构建测试复现缺口：原生config hook删除某个公开define，或configEnvironment把client.define置空，都未被拒绝。仅补回config.env不足以修复生产阶段已经捕获的define表，会造成开发与构建分歧。修正为同时校验根define和client.define中每个应有公开键的存在及精确值，删除、覆盖或扩大环境暴露均报 `VITE_RESERVED_CONFIG`。

四项新增复核测试先得到2通过、2失败，日志为 `.cache/p11-review-red.log`；修复后原断言和既有后端环境测试共8项通过，再从头运行完整最终验证。另两项复核覆盖512赋值/跨文件唯一键的组合预算，以及真实CLI继承空值和模块求值顺序。没有通过关闭依赖优化、缩减变量、改期望或重新执行用户命令掩盖问题。

这些检查是可信原生扩展的配置契约，不是恶意插件沙箱；插件主动输出秘密、后续自定义transform或middleware的行为不受自动脱敏保证。公开前缀本身也是作者主动声明公开，不会自动识别其值是否敏感。

## 4. 环境文件变化与故障恢复

真实Node HTTP/CLI测试验证了选定文件创建、替换、删除与移除键不残留；修改无关mode文件不会触发当前worker重启。坏环境文件在旧worker停止之前被发现，旧HTTP响应与进程保持，相同内容不会形成重启风暴，修复后自动启动新输入。

另有受控gate场景：旧插件清理期间再次编辑环境文件，过期候选不会进入初始化；新插件初始化期间再编辑环境文件，过期ready不会对外报告成功。沿用现有配置代际规则，没有新增环境热更新状态机，也不宣称普通文件系统已经提供跨文件事务。

浏览器从 `/stage/probe` 启动，核对配置工厂保存的Node快照、HTML标题和React读取的值都为selected。计数到1后把.env.staging.local写坏，旧页面和文档身份保持；修复为recovered后浏览器自动重连/刷新读取新值，未手动goto掩盖更新。四个.env路径及配置源码的raw访问均返回403。

随后实际typecheck、build，扫描生成文件与全部发布文件，私有/VITE/迟到修改的合成标记均不出现。构建后再改变.env，preview仍显示已构建的recovered、production与正确base，生成入口字节不变。**preview不重建，不表示启动时完全不读取或校验当前配置。** 新浏览器测试完整重复一次。

## 5. 最终执行与分发证据

| 检查 | 最终结果 |
| --- | --- |
| pnpm check，含框架/测试/脚本类型 | 348/348 Node |
| 环境领域定向重复 | 23/23，不重复计数 |
| pnpm test:browser | 18/18 |
| 新环境浏览器定向重复 | 1/1 |
| pnpm test:package | 13个tgz、72阶段满足预期 |
| pnpm test:plugin，默认输入 | 54阶段满足预期；未启用字体分支 |
| workspace与新环境应用冻结锁离线安装 | 均成功 |
| 新应用typecheck、config、diagnose、连续两次build | 均成功 |

最终目录 `.cache/p11-reviewed-78d075d14f`，17条顶层命令全部退出0，每条前后核对221份源码/测试/脚本/配置输入。最终kit中13个归档的54份源码与当前packages逐字相同。新应用独立冻结34份输入，163处安装链接均留在应用自己的安装树内；所有实现和测试在最终验证期间未变，之后只补文档与汇总证据。

独立消费中的environment应用通过自己安装的CLI执行mode配置、类型检查、真实开发页面、生产构建及构建后的环境变更预览，没有依赖回到框架workspace的安装链接。原插件作者源码联调、样式资源、真实tgz重定位重装、多实例与生产隔离流程继续通过；本轮没有重新执行Admin业务测试，也不引用旧Admin截图作为本次证据。

初批P11记录 `.cache/p11-final-f561d01023/result.json` 的344项Node与18项浏览器保留；本轮增加复核断言并修正后端，因此不把旧结果当作最终348项。初批试用收尾曾直接执行pnpm config，误调用包管理器内建命令并报ERR_PNPM_CONFIG_NO_SUBCOMMAND；已改为显式pnpm run env:config。它是执行包装器错误，不修改cormi解析器迎合它。初批失败、复核红色断言与最终完整运行分别保存。

环境保持macOS arm64、Node22.14.0、pnpm10.6.3、既有隔离无头Edge/Playwright。没有访问个人浏览器资料、安装新浏览器或读取/复制真实密钥文件。实际打开复核了390×844的生产预览图，recovered、staging/production、Count:1和私有项false可见；JSON字符串在窄屏内换行，截图不代替资源字节或平台矩阵断言。截图为 `.cache/cormi-environment-preview.png`。

## 6. 可运行的环境配置应用

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
cd .cache/environment-p11-78d075d14f
pnpm dev
```

默认入口 `127.0.0.1:8005/stage/probe`。依赖和正常生产产物已准备，使用合成环境数据；没有修改或停止旧试用项目。停止dev后可以执行 `pnpm run env:config`、`pnpm typecheck`、`pnpm build`、`pnpm preview`。直接运行cormi时使用 `pnpm exec cormi config --for build --mode staging --json`，不要把裸pnpm config当成这个脚本。

应用沿用本地kit和消费者Cordis声明补丁；所有框架包仍private，未升级外部依赖或根锁文件。当前环境文件语法是明确子集，不提供dotenv-expand、任意远程env目录、运行时部署后替换静态公开值或恶意代码隔离。不同应用/命令应使用各自worker，不将公开快照用于持久保管秘密。

## 7. 收敛范围

Cordis、Umi、Koishi、WebUI、Satori参考仓库维持原固定提交与干净状态。本轮参考Koishi loader的继承键和localKeys管理，但没有照搬吞掉文件错误或原进程可变重载；环境引导必须先于插件初始化，不为“万物皆插件”引入读取自身配置所依赖的循环。Node解析和Vite接口以实际锁定版本文档/探针为依据。

本轮不执行Linux/Windows、其他浏览器、长期资源趋势或公共npm发布；已有平台结果不扩张为新增协议已通过。只回收本轮拥有的测试服务，保留约定保留的作者/消费者证据目录。下一步进入MVP功能收敛：以创建新应用、插件装配、环境/Mock、类型检查和静态构建部署组成可复现用户流程，核对公共类型、默认配置及尚未关闭的真实缺口，不继续扩张Admin、模板演示或插件市场。
