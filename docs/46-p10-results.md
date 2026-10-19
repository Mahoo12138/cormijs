# cormi P10：配对插件多实例与 worker 结果交付

日期：2026-10-19。基于本地 P9 提交 `2dd79c979bde20395ab028be7604ec941fd833a8`。本轮新增小型公共命名工具、完善 plugin-react 作者模板的实例选项与 Provider 配置选择，并修复真实分发验收中发现的 worker IPC 结果丢失。所有实例仍是原生 Cordis Fiber；没有新建插件加载器、浏览器宿主、框架包或 Admin 业务。契约见 [多实例协议](45-plugin-instances.md)，精确命令、失败与哈希见 [机器证据](../artifacts/p10-validation.json)。

最终 macOS arm64 **325 项 Node、17 项既有框架浏览器测试通过，0 失败、0 取消、0 跳过**；13 个框架 tgz 的独立消费者64阶段满足预期。插件作者完整链路按默认与字体两种输入各执行一轮，每轮54阶段通过，其中新增多实例五组契约，含明确非零负向步骤。相对P9新增14项Node测试，不按重复执行或浏览器操作数增加计数。

## 1. 同一插件现在能够挂载两份不同配置

新增 `createFeatureNamespace(pluginId, instance)`，位于 `@cormijs/plugin-react`，只产生显式、确定且有长度预算的贡献身份；不注册任何生命周期或服务。作者模板增加可选 instance、routePath、apiPath，保留原 development、label、apiBase。省略新增字段时仍使用 `/plugin` 与 `/hello` 的单实例默认URL；生成的内部ID现在显式包含default，旧作者源码不会被自动改写。

同一个真实已安装的 feature 默认导出挂载为 alpha/beta，分别贡献 `plugin/alpha`、`plugin/beta` 页面、不同runtime ID，以及 `/alpha/hello`、`/beta/hello` API相对路径。外层配置id标识配置项，instance标识这个包的领域实例，Fiber UID标识本次激活；三者分开，不靠改函数名或复制包制造多实例。

浏览器中的同模块Provider不再让最后一份Options覆盖所有页面。每次应用挂载的React树内组合ReadonlyMap，页面通过已有路由meta和useRouteMatches选取明确runtimeId。实际持有计数/请求结果的组件按runtimeId设key，切换实例时重新挂载，避免复用同一个模块造成状态串用。没有模块级可变实例表，也没有新增Context容器。

配置和ID隔离不等于权限、多租户、全局CSS隔离或每实例页面缓存；原生Cordis服务隔离仍需要显式Context.isolate设计。模板要求简单静态路径，复杂动态路由由作者使用原IR另行声明，不把命名工具当作通用URL生成器。

## 2. 独立撤回的真实行为

Node测试直接以同一个Plugin.Object创建两个Fiber，检查registry内确实为同一个runtime的两个实例。退出alpha后，beta UID、已经登记的路由/runtime对象、API响应和apply次数不变。重新挂载alpha并再次调用旧Fiber.dispose，替代实例继续存在，beta不被重新初始化。

另一个真实HTTP/gate测试在alpha handler尚未结束时退出alpha：AbortSignal到达，客户端收到503，但卸载Promise仍等待handler实际结束；这期间beta接口继续响应。释放gate后退出完成，alpha变为404，只有beta的编译贡献保留。没有用发出取消信号代替handler已经收尾，也没有整宿主重启来冒充独立退出。

**CLI配置修改仍然重启整个worker。** 浏览器测试中的enabled切换明确检查三代worker；它证明重启后beta功能仍在，而不是承诺beta的内存、组件state或UID不变。两种粒度分别验收，没有在默认配置流程引入细粒度Node源码HMR。

## 3. 真正安装后的双实例浏览器验收

两轮都从真实创建器生成仓库外作者项目，编译和打包插件，再移走作者/kit、删除消费者node_modules、按未变化锁文件重装。后续消费者没有作者源码别名，所有多实例操作使用同一安装后的tgz。作者链接170处，消费者重装前后均176处，分别限制在自己的安装树内。

新增流程倒序登记beta、alpha，防止只验证固定顺序下偶然正确。五组结果如下：

| 契约 | 实际观察 |
| --- | --- |
| 插件身份与诊断 | 两份API贡献的真实ownerUid分别为16、18；配置项及原生依赖均健康 |
| 客户端导航隔离 | Alpha计数到2并请求得到Hello, Alpha!；Link导航至Beta显示Count:0、尚未请求，再取得Hello, Beta!；返回Alpha仍是重置的局部状态，整个导航过程文档没有重载 |
| 配置禁用与恢复 | 禁用alpha后beta页面/API继续可用、alpha路由/API撤回；重新启用自动恢复，按预期经历三代worker |
| 身份与URL冲突 | 重复instance、不同实例同页面URL、不同实例同API路径分别失败；诊断不改旧生成入口，失败build不替换已发布dist |
| 生产交付 | 两个页面与Provider保留；内部导航、Beta深链接reload、CSS与SVG有效，开发API按钮禁用，preview不提供Mock |

临时增加的布局仅提供两条Link和Outlet，用于证明真正的客户端导航，不改Admin页面或搭建新后台。测试结束恢复原消费者配置、移除测试布局、重新构建正常产物。浏览器pageerror及console error/warning断言在完整最终两轮均为空。

P9原资源与单实例流程仍完整运行：CSS token热更新保留Count:1，页面源码更新保留状态，Node API修改重启worker，真正tgz重定位后可用；根路径与/customer/的dev/preview资源检查继续通过。字体轮五处fontChecked=true，默认轮明确false，默认模板及此次试用项目不附带第三方字体。

## 4. 多实例触发了一个通用 cormi 缺陷

首次独立双实例diagnose在 `.cache/p10-flow-e20da96c3a` 失败：worker以0退出但父进程没有收到完整结果，报告WORKER_EXITED。不能把进程退出0当成成功数据已交付。新建的两项不依赖模板回归，分别返回512KiB一次性字符串和1200条贡献诊断，在修复前都失败，保存在 `.cache/p10-ipc-before.log`。

修复位于 `packages/cormi/src/worker.ts`。worker追踪自身发送的IPC Promise，完成宿主清理后发送结果，等待发送回调收尾，再发送stopped并关闭通道；发送错误保持非零退出，原关闭watchdog覆盖等待。没有加固定sleep、丢弃诊断记录、放宽输出预算或重放可能有副作用的命令。

修复后两项原断言通过，又增加了大失败诊断的完整交付回归：512条贡献与缺失服务报告仍到达父进程，退出1，没有成功result。发送回调完成不是业务父进程的持久确认，不承诺断线重放或跨进程事务。

更早的模板红色回归为默认单实例1通过、多实例2失败，见 `.cache/p10-instances-red.log`。实现后保留原断言，并补API/URL冲突、长作用域包名、非法组合预算和原生撤回排空用例。所有失败记录保留，不通过删断言或只重跑小场景来宣称完整通过。

## 5. 最终验证与覆盖输入

| 检查 | 最终结果 |
| --- | --- |
| pnpm check，含框架/测试/脚本类型检查 | 325/325 Node；新增命名3、模板7、原生退出1、IPC3 |
| 新增Node定向重复 | 14/14；不重复计作新用例 |
| pnpm test:browser | 17/17既有框架浏览器回归 |
| pnpm test:package | 13个框架tgz，64阶段满足预期 |
| pnpm test:plugin | 默认与字体两轮，各54阶段满足预期 |
| 新双实例作者试用项目 | 安装、库build、两类typecheck、diagnose、pack全部成功 |
| workspace与新作者冻结锁离线安装 | 均成功，依赖版本与根锁文件未改变 |

完整运行目录 `.cache/p10-final-45cda12bdf`，16条顶层命令全部成功，每条前后核对211份框架/测试/脚本/配置输入。之后的暂存差异检查发现 `tests/worker-result-delivery.test.ts` 末尾多一个空行；仅删除该LF，保留原断言，并在收尾单独重跑全部Node/类型与新增定向回归。此一字节差异及复测记录追加到机器证据，不将两组输入称为完全相同。产品源码、浏览器脚本和已安装应用未变化，其浏览器/分发结果仍对应同一实现。新的kit中13份归档内52份源码与当前框架逐字相同；新试用项目另核对24份输入与170处内部安装链接。

环境为macOS arm64、Node22.14.0、pnpm10.6.3、已有Edge155.0.4283.62的隔离无头上下文。按既有Playwright工作流执行，没有使用个人浏览器资料或下载新浏览器。本轮实际打开1280×800的Alpha开发图和390×844的Beta生产图，确认实例标签、导航、样式与生产按钮状态可见；黑色小块仍是1像素PNG测试资源，不是丢图。截图仅证明相应时刻，状态隔离依据前述导航断言。

Cordis、Umi、Koishi、WebUI、Satori保持原固定提交与干净工作区；本轮读取Cordis registry/native插件测试和Satori Bot/Adapter作为设计参考，并对实际安装RC.11做探针。没有因较早生态源码的reusable或生命周期写法不同而修改当前上游运行时。

## 6. 可以直接使用的双实例作者项目

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
cd .cache/plugin-author-p10-45cda12bdf
pnpm dev
```

默认入口 `127.0.0.1:8004/workbench/`，首页可分别进入 `/workbench/plugin/alpha` 与 `/workbench/plugin/beta`。两者使用同一份src/index.ts和src/page.tsx，开发API分别位于 `/workbench/api/alpha/hello` 与 `/workbench/api/beta/hello`。为避免与旧8003试用冲突，新项目使用8004；没有停止或改写旧项目。

依赖、库构建和两类类型检查已完成。停止dev后可运行 `pnpm diagnose --for dev`、`pnpm build`、`pnpm check:app`、`pnpm build:app`、`pnpm preview` 和 `pnpm pack:plugin`。本轮现成tgz为 `artifacts/plugin-PwBdWx/example-hello-0.0.0.tgz`，保持private:true；打包只是本地交付，不是发布npm。

## 7. 仍然保留的边界

不能自动把任意旧插件变成多实例；作者自己的全局变量、CSS或外部服务副作用仍需管理。跨领域注册不是事务，配置重启不保存另一实例的内存，路由切换不缓存计数，Provider Map也不是恶意代码沙箱。资源打包和受管输出维持P9已说明的非原子边界。

未执行Linux/Windows、其他浏览器、长期资源趋势或公开分发；Cordis消费者根声明补丁仍必需，没有升级依赖或发布协议。只关闭本轮拥有的测试CLI/浏览器，最终没有其遗留CLI/worker和项目锁；外部作者/消费者目录保留供复核，不误删为“测试清理”。不推送、公开发布或部署。

下一步回到应用开发的公共配置契约：检查mode、环境文件、Node插件配置与客户端公开值在dev/build中的一致性及变更恢复，不继续扩张作者模板演示、Admin业务或插件市场。
