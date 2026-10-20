# cormi P16：TypeScript 项目引用与原生检查器服务

日期：2026-10-20。基于 P15 本地提交 `cd4b447bd87f7629310610fa8e3da8cc379cb750`。本轮实现 solution/project references 的应用类型检查和可替换的原生 typechecker 服务；所有产品修改留在已有 `@cormijs/plugin-typescript`，未修改 core、launcher、Web/React/Vite provider、浏览器 runtime 或 Admin 业务。接口、配置例子和支持边界见 [协议](57-typescript-projects.md)。最终 macOS arm64 423项Node与19项框架浏览器回归全部通过，25项新增契约另行重复；独立打包消费、作者链路、应用交付与有限可靠性在同一冻结输入下完成。

## 1. 插件化交付

`typescriptServicePlugin` 提供 `typechecker`，`typecheckCommandPlugin` 声明 `commands/application/typechecker` 依赖，旧 `typescriptPlugin` 用原生 `ctx.plugin()` 组合两者。默认 preset 不变，旧单项目继续使用原 typecheck 命令。相同消费者在测试中先缺少 checker、再绑定 A、卸载 A、绑定 B；命令随依赖撤回并重新激活，没有静默回退。A/B 是验证服务替换的测试实现，不声称已经交付第二个生产 TypeScript 编译器。

检查器选项 `generatedProject` 属于 TypeScript 插件本身。早期将它尝试放在 app.typecheck 时被既有 Web 选项约束拒绝，因此改为领域插件的 options；没有为了便利扩充 Web 白名单或让 core 认识 TS 配置。命令与 checker 的职责可分开配置，但没有建立另一套生命周期或新的框架包。

## 2. 真正检查引用图，而不是合并源码

默认检查器调用已安装 TypeScript 5.9.3 的公开 SolutionBuilder，支持纯 solution 根、自定义配置文件名、嵌套聚合、菱形依赖和有自身文件的根项目。每个项目保留自己的 lib、types、module、strict 等选项；全部 noCheck 强制关闭。被实际消费的项目仍按 TypeScript 规则校验 composite、noEmit 和 rootDir，不通过把所有项目摊平为一个 Program 绕过边界。

真实回归包含未被下游 import 的错误源文件、Node 工具项目意外使用 document、上游类型改变导致下游失败、重复引用只处理一次，以及缺失项目、循环、越界/符号别名配置和图预算。原先一律报 TYPECHECK_REFERENCES_UNSUPPORTED 的门槛被实际图检查替代，缺失配置仍明确失败，不能让空根 solution 变成无检查的成功。

引用依赖的声明只在本次调用的内存覆盖层中产生，并供下游读取；不会写出业务 JS、d.ts、map 或 tsbuildinfo。每次强制从当前输入检查，屏蔽本轮声明目标和旧构建信息，磁盘既有声明/缓存不会成为兜底。测试先放入看似正确的旧 number 声明，再将源改为 string；下游必须失败，且旧文件字节保持不变。输出重叠、覆盖已读输入和越界虚拟写入都拒绝。

整个 cormi typecheck 仍会 prepare 并维护自己的 `.cormi`，不是完全无文件写入的命令。这里保证的是 TypeScript 不落地业务编译输出，不能将内存声明作为其他进程或 npm 消费者的已发布文件。

## 3. 生成路由与应用/Node 项目边界

恰好一个项目的解析文件集合包含 `.cormi/app.tsx` 时，该项目接收生成入口和路由声明；纯 solution 中零个或多个候选会要求显式 generatedProject，不按 reference 顺序或文件名猜选。显式指定后，即使原 exclude 排除 .cormi，也不能绕过组件导出和路由参数检查。

实际 TypeScript 探针发现 `.cormi` 和 `.cormi/**/*` 的 include 展开不同，测试与指南采用后者，未在 cormi 重做一套 glob。另一个独立包消费缺陷是生成入口的 .ts/.tsx 导入在 solution 分支没有启用已有单项目使用的 allowImportingTsExtensions；修正仅作用于生成文件所属项目，不把此选项强加给全部 Node/库项目。原 rootDir=src 导致生成文件越界时仍保留 TS6059，要求作者明确调整。

CLI 回归分别测试浏览器与 Node 配置分离、缺少归属、歧义归属、非组件页面默认导出、错误 slug/id 路由参数和 composite rootDir。错误修复后重新检查通过，不通过关闭 strict 或 skipLibCheck 使断言消失。

## 4. 输入一致性、取消和真实排空

覆盖层记录源码/继承配置文本、目录扫描和解析时的存在性观察。复核新增“fileExists=false 的候选后来出现”断言，修复前 Missing expected exception，记录于 `.cache/p16-existence-red.log`。现在这种只探测而尚未读取的文件也会在接受前复查，不能因主源码未变就接受已过期解析结果。文本变化、缺失配置创建、glob 新增和虚拟文件隔离分别有测试。

撤回正在执行的 checker 时，原生消费者取消并等待其实际任务完成，随后关闭 prepared application；gate 未释放前卸载不能假装完成。取消发生在 prepare 期间且准备结果迟到时，仍关闭已获取的结果，不调用 checker。TypeScript 本身主要同步计算，同一线程信号不能强制抢占，已有准确 worker 的期限仍负责外层关闭，不新增 TS 调度宿主。

## 5. 独立包和实际 React 应用

无 Web 消费者从本轮 tgz 安装树载入 TypeScript 服务，分别确认无法解析 Vite 和 React，然后通过原生服务检查四项目图。NodeNext 严格声明消费包含负向参数断言；没有让 API 退化为 any 或依赖 workspace 提升。

另一独立 React 消费者在 `/solution/` 使用 app、Node tools、shared 库和 solution 根，先检查干净源码，再注入旧声明与新源类型冲突、noCheck=true 的 Node 错误、非组件导出，随后恢复。每次 typecheck 前后核对除受管 .cormi/锁和安装树之外的文件哈希，确保业务源、旧声明、旧 tsbuildinfo 和既有产物未被改写。

同一应用实际执行 dev/build/preview，页面读取被项目引用的 sharedValue=42，原环境配置、HTML/Node/客户端公开值和 Count 交互继续检查；不是只检查生成 JSON 或 HTTP 200。该合成页面沿用现有环境 probe，不扩展 Admin 产品。完整断言同时核对 URL、标题、无错误覆盖层与页面异常。

## 6. 实施中失败记录

最初两个新引用契约在旧实现上失败，记录为 `.cache/p16-references-red.log`。原生方案探针曾尝试关闭 composite 的 incremental 而得到 TS6379，随后保留其原生约束；首轮实现复制 parsed.options 丢失 TypeScript 的非枚举配置元数据，导致输出路径断言失败，修正为保留解析对象身份。它们不是放宽用户类型检查。

早期测试辅助代码的 basename 数组回调和 TypeScript 默认/命名空间导入类型错误各自修正，没有升级依赖。生成归属/app.typecheck 的四个失败单独保留。首轮独立消费 `.cache/package-test-1792456174274` 在90阶段后因 TS5097 被拒绝；修复生成所有者选项后，`.cache/package-test-1792456445704` 的99阶段 pilot 完整通过。后者仍不是最终冻结整套结果。

## 7. 最终验证与复现

| 检查 | 实际结果 |
| --- | --- |
| pnpm check，包含框架/脚本/测试类型 | 423/423 Node，0失败/取消/跳过 |
| 新增 TypeScript 契约定向重复 | 25/25，不重复计入新增测试 |
| pnpm test:browser | 19/19，0失败/取消/跳过 |
| pnpm test:package | 13个tgz，99阶段满足预期 |
| pnpm test:plugin | 默认54阶段；本轮未执行可选字体分支 |
| pnpm test:application | 37阶段满足预期 |
| pnpm test:reliability | 默认20/100配置，完整执行两轮 |
| workspace冻结锁离线安装与新的本地kit | 均退出0 |

相对P15新增25项Node：solution2、引用图10、生成归属5、文件系统5、原生provider3。打包消费从84到99阶段，包含安装、类型检查、预期失败与浏览器操作，不当作15项新增单元测试。旧11项app-tools继续执行；仅将原本笼统不支持references的断言改为真正缺失引用配置的失败断言。

两轮可靠性各20次原生宿主/Vite启停、20次launcher启停、100批配置/环境/失败混合和100批React生成，分别记录142次资源登记和142次关闭；记录中的142个worker均已退出，监视会话101个就绪端口可重绑，最终活跃资源回到原有两个PipeWrap。有限样本不代表P13的堆增长归因已经完成，也不是长期无泄漏证明。

最终目录 `.cache/p16-final-1ce33e26f1` 的十条顶层命令全部退出0，每条前后核对268份源码/脚本/测试/配置/约束输入集合与SHA。13个最新归档中的65份框架源码与当前packages逐字相同。原始结果、日志/归档SHA和参考文件记录见 [机器证据](../artifacts/p16-validation.json)。之后只补文档与汇总证据，未修改已通过验证的实现。

独立包的最终结果为 `.cache/package-test-1792457139355/result.json`。实际打开了同轮生产预览截图 `typescript-solution-preview.png`：Shared value:42、selected、staging/production、Count:1与/solution/基址可见，私有项为false。截图只是页面时刻，不用于证明TypeScript已经检查了Node工具项目，后者由负向类型断言证明。浏览器沿用项目Playwright及已有隔离无头上下文，没有访问个人资料或安装新浏览器。

复现入口是框架根目录 `pnpm check`、`pnpm test:package` 和 `pnpm test:reliability`；普通应用继续 `pnpm typecheck`，solution配置按协议声明生成项目。新的本地kit为 `.cache/p16-final-1ce33e26f1/kit`，成功的临时应用按测试规则回收，不留下新的常驻演示服务。

## 8. 生态依据与剩余门槛

继续读取固定 DeepSeek Harness 的 native/system 根和 entry 子项目配置，借鉴工具/声明项目的依赖分界，固定 SHA 仍为 `687f282e8625c6b8d11ff58211a90524be2e4317`。WebUI/Satori 根配置的 paths 与文件集合不被说成同一检查器。没有复制上游编译实现、安装参考仓库依赖或使用 vendored Cordis；框架依赖、声明补丁及包 private 状态不变。

本轮不提供 TS watch、持久增量声明、跨应用根 references、任意 transformer 或多 TS 版本矩阵。配置路径检查、内存输出和输入重查不是安全沙箱或跨文件事务。Windows继续挂起，长期堆增长归因、公共分发与中断恢复仍单独保留。

下一项围绕受管构建发布的中断恢复：先提供可核对的事务/备份状态与明确恢复决策，能力留在发布领域，不因 PID 过期猜测而自动删锁，不把本地恢复命令扩张成线上零停机部署。
