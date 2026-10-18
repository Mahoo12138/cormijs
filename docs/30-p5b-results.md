# cormi P5b：自定义错误边界与真实 Admin 首个迁移版本

基于本地 `fbb63e5f15d821a1d59454ab6a8120f89abac32b` 继续实现 AM02/AM09。本轮不再只是运行原版：Material Kit React 已通过自身安装的 cormi 包完成根路径 dev、应用类型检查、build 和 preview，并使用原版同一组模块契约对照。**真实迁移版本已可运行，但 /admin/ 资源和11个模块的全部细节还没有验收完成。**

最终 macOS arm64 **231 项 Node、17 项框架浏览器测试通过，0失败、0取消、0跳过**；13个真实tgz的独立消费者57个阶段满足预期。迁移版 Admin 的 dev/preview 各7组、每轮38条观察与 P5a 原版记录逐项一致；额外错误注入18个阶段通过并恢复原文件。原始命令、日志、包、源码和截图哈希见 [机器证据](../artifacts/p5b-validation.json)。

## 1. 可运行的迁移副本

本轮已安装副本位于 `/Users/mahoo/Projects/cormijs/.cache/admin-cormi-p5b-a5f59e639560`，默认只监听 `127.0.0.1:3039`。页面保留 Dashboard、Users、Products、Blog、Sign in、404，使用原 MUI 主题、组件、图表与资产，不是重画的简化后台。

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
cd .cache/admin-cormi-p5b-a5f59e639560
pnpm dev
```

停止 dev 后可执行 `pnpm typecheck`、`pnpm build`、`pnpm preview`。当前 build 产物正常，错误测试已恢复原 Users 文件并重新构建，不留下用于演示错误的业务代码。全套测试的浏览器和 CLI 已关闭，试用时需自行运行命令；没有部署常驻服务。

应用自带 `.cormi-local` 中的13个框架归档及 Cordis 显式声明补丁；348处安装链接检查均位于应用自身目录内，没有指回框架 workspace。冻结锁文件离线安装成功。此项使用已准备缓存，不承诺首次第三方依赖安装不需要网络；也不等于公共npm已经发布。

## 2. AM02/AM09 的框架实现

RouteRecord 新增 `errorBoundary: ModuleRef`，支持普通配置和原生 Cordis 功能插件贡献。边界组件由生成入口静态导入，页面仍 lazy；路径与私有/服务端限制、引用冻结、缺失文件修复、inspection 作者URL保护接入原有流程。非组件或缺失命名导出会被真实应用 typecheck 拒绝，即使用户 exclude 了 `.cormi`。具体 API 见 [协议](29-routing-boundaries.md)。

新增显式 `app.strict`，默认 false；迁移为保持原 StrictMode 设置 true。runtime 在异步 setup 前占用挂载元素，同元素第二次 mount 会拒绝，正常 dispose 后允许重挂载；不创建全局单一应用，也不把 React effect 开发重放当作 runtime setup 重复执行。core、launcher、builder、Vite provider 及框架依赖版本没有为模板改动。

**真实失败：同路由边界下的模块网络错误曾呈现白屏。** 测试实际中止 Deferred 页面请求，错误边界已经静态导入但没有显示。独立 memory-router 探针同样复现锁定 React Router 7.18.2 的 lazy 拒绝保留状态与 hydration fallback 路径。生成器改用 resolveRouteComponent：导入成功保留组件，失败则在渲染阶段重新抛出原错误，让已可用边界处理。不改路由库内部文件，不吞掉错误，不把失败伪装成成功页。

浏览器还验证子级渲染/模块求值错误、缺少子边界时向父传播、错误组件自身抛错向父传播、应用404与运行异常区分、修复后的导航，以及 StrictMode 中effect/cleanup配对、setup/dispose一次和重复关闭。网络故障解除后使用明确的页面重载；不宣称任意 ESM 失败自动重试或总能保留局部状态。

## 3. 真实 Admin 的改动不是全量重写

固定上游为 `69e780a40c455d664b2e13c525faf1d492a072a7`。原src/public的229份跟踪文件中，227份保持相同SHA-256；仅适配原路由声明文件，停止复制执行旧main，新增路由内App包装。HTML引用cormi生成入口，Node配置提供显式路由和普通Cordis alias插件。原ErrorBoundary源码及许可文本保留。完整源文件映射、版本和配置差异见 [迁移接缝](admin/04-routing-migration.md)。

原App使用路由Hook，因此放在Router内部；Dashboard的pathless布局、React.lazy页面和Suspense保留。没有双RouterProvider、旧Vite启动器、第二套React transform或被删除的图表。

**真实失败：只固定 MUI material 版本不足以复现类型。** 首次独立安装让 system/utils 漂移到7.3.11，原borderRadius算术出现3个TS2362。改为固定原锁文件的整个 @mui 包族后通过，没有修改业务表达式、添加any或关闭strict。React/React DOM使用cormi已测19.3.1，Router/DOM为7.18.2，区别于原版19.1.0/7.4.1；新锁文件单独保留，不声称两套依赖相同。

## 4. 模块进度与具体观察

| 议题 | 本轮已验证 | 仍未关闭的部分 |
| --- | --- | --- |
| AM01 安装 | 实际tgz、应用内部链接、新锁文件、类型和冻结安装 | 完整资产许可/公共发布门槛 |
| AM02 启动与路由 | 唯一root/router接入、App位置、原pathless布局、显式StrictMode | 所有加载时序/状态组合与扩展路由API |
| AM03 Header/布局 | 原7组中的切换、通知、导航/后退、移动抽屉行为完全一致 | 通知焦点原缺陷、完整键盘/菜单矩阵 |
| AM04 Dashboard | 8图表、图例隐藏还原、任务切换、正常布局 | 全图tooltip/尺寸/销毁、长页逐区视觉 |
| AM05 Users | 完整24人排序分页、筛选/空结果/选择、每页条数 | 上游分页计数及全选语义、Admin状态下HMR |
| AM06/AM07 商品与博客 | 原卡片数据与控件状态、补全和占位行为一致 | Reset/颜色/评分/键盘、真实数据操作另案 |
| AM08 登录 | 原显隐与演示跳转保留 | 原本就没有真实鉴权/会话，不能据此验收 |
| AM09 404与异常 | 原404、原异常页、渲染/求值/网络错误和恢复 | 静态边界自身加载失败、生产错误信息策略 |
| AM10/AM11 | 根路径已触发资源、实际构建预览及清理 | /admin/全部资源、交互状态热更新、Admin专项失败构建/配置恢复 |

两轮迁移模块记录的38条观察，与固定 P5a 原版JSON逐项相同；包含已知缺陷和演示行为，不意味着这些产品设计合理或已修复。未改原模块契约以让迁移通过，也未把原版 New user/Sort/Sign in 控件包装成真实CRUD、过滤或认证。

## 5. 实际异常注入与恢复

在迁移副本Users页，dev分别注入渲染抛错、模块顶层抛错、网络中止。三个场景均显示原 Unexpected Application Error! 和真实错误，普通404和旧业务布局不出现。恢复原文件或解除拦截后重新加载，Users名称搜索成功；同一dev worker无需重启。

生产对渲染/求值错误各自真实构建并preview；恢复正常构建后中止真实user chunk再验证边界和恢复。共18个阶段包含构建、清理与恢复，其中是6个明确故障场景，不冒充18个新增单元测试。预期错误日志完整记录。脚本写入前检查原哈希及文件身份，最终业务文件恢复原字节；原版checkout从未承担故障注入。

## 6. 最终验证和截图边界

| 检查 | 最终结果 |
| --- | --- |
| pnpm check，含框架/测试/脚本类型 | 231/231，无失败/取消/跳过 |
| pnpm test:browser | 17/17，无失败/取消/跳过 |
| 新边界/类型/错误保留定向重复 | 9/9，属于重复验证 |
| pnpm test:package | 13个tgz，57个阶段满足预期 |
| 迁移应用typecheck/build/冻结安装 | 分别退出0 |
| Admin dev与preview | 每轮7组、38条观察；和原版逐项一致 |
| Admin异常与恢复 | 18阶段通过，文件已恢复 |

相对P5a/P4c增加9个Node和3个框架浏览器用例；不按重复运行、负向命令或Admin观察数量累加。所有正常Admin流程最终pageerror、控制台error/warning、失败资源与外部请求均为0；故障注入的预期异常单独保存。cormi服务正常退出码0且端口重绑，与原版Vite143退出的历史约定分开。

使用Mac arm64、Node22.14.0、pnpm10.6.3和Edge155.0.4283.62独立无头上下文，不访问个人浏览器资料。固定视口1440×1000、390×844；打开复核了迁移Dashboard桌面、Users窄屏和实际异常页，其中Dashboard/异常图取自最终运行。表格在窄屏保留容器内横向布局，未宣称全部列同时可见；截图不等于全部长页/像素/设备验收。

最终目录 `.cache/p5b-final-e6658063d5bf`。每条命令前后核对197份框架/测试/脚本/示例/配置输入与241份应用输入；故障阶段后恢复同一哈希，锁文件未漂移。另检查13归档内的src与当前框架对应源码一致，348个应用安装链接不越界。最终验证后只补文档和汇总证据，未修改通过验证的实现。Linux/Windows本轮未执行，不沿用过去成绩作为新增功能证明。

早期失败日志保留，包括真正的lazy白屏、MUI类型漂移，以及测试fixture缺少作者文件、类型收窄/转换就绪时机等测试修正；没有改掉产品断言来掩盖失败。源代码、截图和命令哈希以机器证据为准。

## 7. 后续入口

下一步优先 AM10：把真实模板迁移到 `/admin/` 部署，逐一处理图片、SVG、CSS、字体、动态chunk、路由跳转与深链接刷新；随后用 Users/Products 的交互状态验证 Admin Fast Refresh。CF-01 的错误边界接口缺口已补，不将它视为整张模块台账关闭。没有推送、发布npm、部署或增加常驻服务。
