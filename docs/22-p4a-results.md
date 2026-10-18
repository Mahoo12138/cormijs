# cormi P4a：可复用功能插件与应用扩展结果

日期：2026-10-18。基于 `dd44585b84a37e52e2d765ad634ffc98581e5ae2` 继续开发。用户决定暂不处理 Windows，本轮恢复框架功能主线：完成可复用 React 功能插件、作者位置模块引用、公开路由元数据与浏览器读取，以及可运行的功能示例。Windows 验收已挂起，本轮未探测 MahooPC、运行 Windows 或扩展 Linux 验证。

本机最终 **176 项 Node 测试、12 项真实浏览器测试通过，0 失败、0 取消、0 跳过**；真实 tgz 独立消费者共 44 个检查阶段满足预期。最新证据为 [复核机器记录](../artifacts/p4a-review-validation.json)，前一轮完整记录 [p4a-validation.json](../artifacts/p4a-validation.json) 保留不覆盖。重复执行不累加为新用例。

## 1. 应用现在可以获得什么

新增 [examples/features](../examples/features/cormi.config.ts)。应用仅声明布局和概览页，通过一项 statusFeature 配置获得状态页面、应用级 Provider、页面标题和功能标记等公开元数据。插件负责维护客户端文件位置，应用不需要手工复制其页面、拼生成入口或了解插件内部目录。

`defineReactFeature` 位于已有 @cormijs/plugin-react 包中，返回原生 Cordis Plugin.Object。它注入 react 服务，通过现有路由 reducer/runtime collector 登记贡献，用 ctx.effect 撤销注册。没有建立第二套插件生命周期，也没有把 Vite 或 React 绑定到 core。本轮 core、builder、launcher、Vite provider 与锁定依赖均未改动；React-Vite 桥接只补充了已知 Cordis Node 入口的浏览器防误用检查。

停用配置项会通过既有 worker 重启撤销功能路由与 Provider；重新启用读取新配置。组件源码修改仍由 Fast Refresh 处理，不等于 Node 插件可以在进程内任意热替换。便利接口按稳定 ID 和可选 stage 装配，复杂插件仍可直接使用现有 Cordis 和编译扩展点。

## 2. 三个公开接口

`clientModule('./client/Page.tsx', import.meta.url)` 把引用绑定到插件作者文件的位置，解决此前相对引用只能相对应用根的问题。未带 from 的引用保留原语义；裸包名仍交给浏览器构建后端解析。显式作者目录内的文件可以位于应用外，但路径越界、私有文件、已知服务端模块、非法 URL 和符号链接都被拒绝。扫描和生成过程不 import 执行页面源码。

`RouteRecord.meta` 接受有界 JSON 对象，经复制和深冻结后进入生成代码，位于 React Router 的 handle.cormi.meta。预算在遍历时累计，拒绝过深、过大、循环、访问器、函数、非有限数值和保留原型键。meta 与 runtime options 是公开客户端数据，不能放密钥，不构成权限控制。

`useRouteMatches()` 从浏览器路由上下文提供当前父到子的匹配项，包括 id、pathname、params 与 meta。示例据此显示“工作台 / 功能插件”面包屑。它不自动继承/合并父级元数据，也不生成菜单或承担后端鉴权。必须在 RouterProvider 内的组件使用，而不是在外层根 Provider 中使用。

精确接口、类型、作者目录约束和代码示例见 [功能插件协议](21-react-features.md)。

## 3. 真实浏览器链路

本轮沿用 Node 22.14.0、pnpm 10.6.3 和已有依赖，本机 Edge 155.0.4283.62 通过独立无头上下文执行，不访问个人浏览器 profile。新增两个浏览器用例，既有十个用例仍全部运行。

第一条从 `/workspace/status` 进入功能页面，核对真实页面标题、路由 URL、元数据、Provider 数量和面包屑。点击计数器到 2 后修改插件页面，确认新标题与 Count:2 同时出现。随后停用插件，确认页面变为 404、Provider 消失、生成入口不再含功能引用；重新启用并修改公开 label，确认新值和单一 Provider。构建后删除源页面，生产 preview 仍服务已构建页面，不重新生成。

第二条使用应用外的作者目录，先缺少页面文件而显示开发诊断，创建文件后同一 worker 恢复实际页面及 runtime。未导入的邻接文件经 /@fs 访问仍返回 403，没有为通过测试扩大整个目录的 fs.allow。停服后继续验证 typecheck、build 和 preview。

外部源码目录最初没有自己的 React 依赖，浏览器渲染虽正常，TypeScript 仍报缺少 react/jsx-runtime。测试现在明确保留这一负向断言，再为测试插件目录提供自己的依赖安装边界后验证成功；没有给产品增加隐式 paths 或放宽 strict 来掩盖缺失依赖。此项不是“任意外部源码零配置可用”的承诺。

桌面按 1280×800、窄视口按 390×844 检查并读取截图。最初 resize 后的局部截图出现不一致的页底绘制；补充等待字体和两次绘制帧、单一 header/Provider、正确 footer 的 DOM 断言，并改为整页截图后重新验证。最终窄屏页面没有横向溢出或重复布局，中文与控件正常。此项是桌面浏览器窄视口测试，不是真实移动设备矩阵。

## 4. 单元、隔离与交付

新增 11 项 Node 用例覆盖作者 URL、目录越界、公开数据快照、注销贡献、跨插件父布局、路径冲突保护旧产物、私有/链接模块拒绝、缺失文件修复、错误描述、JSON 预算和确定性顺序。包含先写入有效生成物再引入无效功能的场景，确认不会覆盖上一版入口，撤回错误功能后可以继续使用。

真实打包仍为 11 个框架包，没有新增空壳包。独立消费者检查增加 features 应用，明确声明自己使用的 @cormijs/plugin-react，而不是把全部内部包提升到根依赖。该应用从 tgz 安装树运行自己的 CLI，完成类型检查、inspect、页面/Provider/meta、计数交互、build 与 preview；既有最小 core/launcher/SDK/basic 消费者与负向断言保留。

本轮验证的是框架 tarball 加应用内功能插件，以及独立外部源码引用；没有额外宣称已经发布并测试一个独立 npm 业务插件包。

`pnpm pack:local --template features` 已生成可供本地试用的 kit：`/Users/mahoo/Projects/cormijs/.cache/cormi-kit-4a1cb2c5-7ea9-4ac6-88ba-4990a27f8395`。整个 kit 移到 workspace 外再进入 app 安装，不能只移动 app 而遗漏 tarballs/compatibility。默认 basic 模板不变，Cordis 消费者根声明补丁仍明确存在。

## 5. 最终验证与来源稳定性

| 检查 | 结果 |
| --- | --- |
| pnpm check | 176/176，包含框架、测试和脚本类型检查 |
| pnpm test:browser | 12/12，含两项新增功能插件场景 |
| 功能单元定向重复 | 11/11，不重复计作新增 |
| 功能浏览器定向重复 | 2/2，不重复计作新增 |
| pnpm test:package | 44 阶段满足预期，含必要的负向结果 |
| 两个示例类型检查、功能 inspect | 均退出 0 |
| 功能 build、重复 build | 均退出 0，第二次明确 replaced=true |
| 冻结锁文件离线安装、P0 demo、features kit | 均退出 0 |

相对上轮 165/10，新增的是 11 个 Node 与 2 个浏览器用例，不累加完整回归次数、消费者阶段或两个执行记录。第一份完整验证后只调整了浏览器截图同步和布局断言；最新复核重新运行 check、全部浏览器、打包消费者和新增定向测试。其余构建/安装/demo 结果继续来自源码相同的前一份记录，且最新记录明确保留这个差异。

最新执行核对 142 份源码、测试、示例、脚本、配置与补丁的文件集合和 SHA-256，每条命令前后不变。随后仅补结果文档和导航。历史 P0–P3c 记录没有改写。本轮没有执行 Linux 或 Windows，不能把此前平台通过推广到本次新增功能。

## 6. 直接运行

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm build
pnpm cormi dev --root examples/features
```

默认 `127.0.0.1:8002/workspace/`，状态功能位于 `/workspace/status`。停止 dev 后分别执行：

```sh
pnpm cormi typecheck --root examples/features --startup-timeout 30000
pnpm cormi inspect --root examples/features --json
pnpm cormi build --root examples/features --startup-timeout 30000
pnpm cormi preview --root examples/features
```

框架基础应用链路和本轮插件功能已可运行；标准项目创建命令、开发请求代理/Mock、完整配置派生/覆盖来源诊断仍是下一步功能工作。SSR/RSC、完整 Umi 兼容、公开 npm 发布和长期稳定性不能根据这一示例宣布完成。所有包保持 private，本轮没有推送、发布、部署或创建常驻服务。

实现入口：[Node 功能定义](../packages/plugin-react/src/feature.ts)、[作者模块解析](../packages/plugin-react/src/modules.ts)、[公开 JSON 数据](../packages/routes/src/json.ts)、[浏览器匹配读取](../packages/runtime/src/route-matches.ts)、[应用配置](../examples/features/cormi.config.ts)、[插件实现](../examples/features/features/status/plugin.ts)。
