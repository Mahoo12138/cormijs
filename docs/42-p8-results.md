# cormi P8：插件作者项目、源码联调与独立交付

日期：2026-10-19。基于 `7577e89c6a89eb81825fdb0ed82123cd64f5c031` 继续。本轮将已经验证的 Node/client 配对方式做成 `plugin-react` 创建模板和完整作者工作流，没有新增框架包、改造 Admin 业务、扩张诊断 UI 或另造插件生命周期。协议见 [插件作者指南](41-plugin-authoring.md)，原始命令、哈希与失败记录见 [机器证据](../artifacts/p8-validation.json)。

最终在 macOS arm64 完成 **298 项 Node、17 项既有框架浏览器测试，0失败、0取消、0跳过**。框架独立消费者仍是13个真实tgz、64个阶段；新增插件作者端到端工作流完整执行两轮，每轮26个检查阶段。相对P7新增11项Node用例，不将重复执行、浏览器操作或预期非零步骤累加为新增测试。

## 1. 作者现在获得什么

现有 `create-cormi` 和 `createProject` 增加 `plugin-react`，支持非框架作用域包名。创建器生成一个可独立安装的TypeScript插件库和作者联调应用，仍不自动安装依赖、初始化Git或运行模板脚本。库有明确的Node根入口、`/api`、`/client`、`/page` exports；插件 `dist` 和联调应用 `app-dist` 分开，避免两类构建输出互相覆盖。

Node根入口是普通Cordis插件，Config使用已支持的同步Standard Schema，apply通过原生子插件组合路由、Provider和开发API。API子插件只依赖devApi服务，生产模式不安装它；传输provider由应用选择，不在功能插件中隐藏安装Vite。浏览器只取得明确公开的label、apiBase、development，不引入Node SDK、handler或私有配置。

作者配置静态导入Node源码；浏览器联调桥接只在作者项目中将具体包的client/page入口映射到TSX源文件。这个桥接没有进入core、插件tgz或消费者配置。首次build生成声明后，普通组件编辑可直接走Fast Refresh；公开导出和类型接口变化后仍需重新build声明。当前模板默认单实例，多实例ID/路径隔离没有自动生成。

## 2. 实际开发链路

两轮均使用打包后安装的创建器bin，在仓库外带中文和空格的目录生成作者项目。作者自身安装依赖后，库build、严格typecheck和联调应用check:app通过。

浏览器从 `/workbench/plugin` 进入，核对页面标题、Provider标签、计数按钮和Mock响应。点击到Count:1后修改 `src/page.tsx` 的真实标题，显示“插件源码已更新”且Count:1与performance.timeOrigin保持不变。修改 `src/api.ts` 后，worker进入下一代，页面自动刷新，并返回 `Updated, cormi author!`，没有靠手动reload掩盖失效。

随后禁用父功能插件，页面与开发API均撤回；重新启用后恢复。整条链路经历四代worker，对应初次启动、Node修改、禁用和重启用，不把Node更新声称为原进程HMR。插件Node源码和本地交付清单的raw请求返回403。测试在dev运行期间调用pack:plugin会明确失败，不假装可以与同项目会话随意并发。

桌面1280×800和窄视口390×844保存截图，最终第二轮的桌面热更新与窄屏图已打开复核：标题、中文、计数器、Mock按钮与结果可读，窄屏没有水平溢出。正常流程控制台error/warning及pageerror最终均为空；这只是本次Edge视口与交互证明，不是跨浏览器或真机审计。

## 3. 打包不是复制旧 dist

新增显式 `pnpm pack:plugin`。它从受限的当前src创建独立快照，严格编译到全新dist，检查exports和声明后再调用pnpm pack，返回真实tgz位置和SHA-256。没有postinstall/prepare自动运行，也不执行publish。打包会去掉作者devDependencies、scripts、pnpm overrides和本地file/link/workspace依赖，不把.cormi-local或playground带给消费者。

真实负向验收先在作者dist放入 `STALE_PACKAGE_MARKER`，正常打包后确认它没有进入归档；再分别加入src/.env、源码符号链接和类型错误，三次都按预期退出1，且没有产生新的归档目录。额外单元测试覆盖活动会话、空目录深度预算和许可证链接拒绝。源码图和source map对应文件存在；PACKAGE.md作为消费者README，测试许可证文本按原字节保存。许可证文本仅为保留行为fixture，不是给项目选择或授予某种开源许可。

失败保留自己的临时快照供检查，成功只清理自己的stage。打包器目前只接受TS/JS源码，CSS、图片和字体等插件资源没有在此轮实现通用交付。用户自定义编译配置仍是可信代码；开始时检查.cormi.lock不等于与随后新启动会话之间建立了原子互斥。

## 4. 真正安装到另一个应用

创建第二个独立React应用，将插件tgz复制到该应用自己的.cormi-local并显式声明必要peers。然后把原作者项目和原kit移到不同位置，删除消费者自己的node_modules，使用未改变的锁文件冻结重装；所有安装链接仍位于消费者目录内，旧作者路径已不能作为源码后备。

消费端没有作者的源码alias，使用插件正式exports完成严格NodeNext声明检查、cormi typecheck、diagnose、开发页面与Mock交互、连续两次build和生产preview。四个公开入口及错误Options类型都有检查，skipLibCheck=false。生产页面和Provider保留，开发API按钮禁用，preview不提供Mock；静态资产未包含Node配置校验或API登记标记。

每轮作者安装树170处链接、消费者176处链接，重定位重装后仍为176处，均在自身目录。完整工作流每轮26阶段包含明确的负向退出；它不是26项新增Node测试。临时作者和消费者保留供复核，测试创建的浏览器与CLI均关闭，端口重新绑定及项目锁释放通过。

## 5. 本轮修复与失败记录

首个模板的应用类型检查报 `ctx.vite` 不存在，原因是作者桥接漏了显式类型扩展导入。添加 `import type {} from '@cormijs/plugin-vite'`，没有添加any或放宽检查。

独立作者第一次离线安装报 `ERR_PNPM_NO_OFFLINE_META`，原因是测试继承了相对pnpm缓存目录并随cwd改变位置。测试现在明确使用仓库已有绝对缓存路径，仍保留离线安装、禁止隐式peer和严格依赖检查；没有把失败改成联网跳过。

随后整条消费链路到生产预览时发现404。独立浏览器探针定位为普通React模板没有favicon，浏览器请求域名根 `/favicon.ico`。现有react/react-api模板补充data favicon，三个模板均有回归；没有过滤控制台错误或在域名根偷偷补资源映射。

首次297项完整回归已经通过后，收尾发现允许的长作用域包名可能生成超过devApi128字符预算的贡献ID。新增回归先得到“Missing expected rejection”，再将创建器名称总长度限制为100字符（含scope分隔符），同时验证100字符边界仍可创建。这个限制属于当前模板，不冒充npm包名通用上限。修复后重新从298项Node一直跑完本轮全部16条命令；此前297项记录保留，但最终结果不再基于旧源码。

## 6. 最终执行结果

| 检查 | 实际结果 |
| --- | --- |
| pnpm check：框架/测试/脚本类型与Node回归 | 298/298；比P7新增11项 |
| pnpm test:browser | 17/17，既有浏览器回归 |
| pnpm test:package | 13个框架tgz，64阶段满足预期 |
| pnpm test:plugin | 两轮，各26阶段满足预期 |
| 创建器及打包预检定向重复 | 21/21，不重复计入新增数量 |
| 作用域名称红/绿回归 | 修复前1失败，修复后1通过 |
| workspace冻结锁离线安装 | 通过，锁文件未修改 |
| 本地作者交付项目 | 安装、库build、check:app、pack:plugin、diagnose全部通过 |

最终目录 `.cache/p8-closeout-e34515ac45`，每条命令前后核对203份框架/测试/脚本/配置输入。另比对13个框架归档中的50份src与当前实现逐字一致。core、launcher、React/runtime、devApi实现与外部依赖版本未改，pnpm-lock未改，五个参考仓库仍是本轮开始记录的提交且干净。新增实现集中在创建器、模板和验证工具；没有改动Admin源码或旧试用服务。

## 7. 已准备好的本地项目

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
cd .cache/plugin-author-p8-e34515ac45
pnpm dev
```

依赖和插件声明已经构建，入口是 `127.0.0.1:8003/workbench/plugin`。停止dev后可运行 `pnpm typecheck`、`pnpm check:app`、`pnpm diagnose --for dev`、`pnpm build:app`、`pnpm preview` 或 `pnpm pack:plugin`。本轮已生成的插件包位于该目录的 `artifacts/plugin-96WPU4/example-hello-0.0.0.tgz`；后续pack生成新目录，不覆盖旧包。要新建其他项目，使用 [作者指南](41-plugin-authoring.md) 的create:app命令。

本轮仍限macOS arm64、Node22.14.0、pnpm10.6.3和既有Edge的隔离无头上下文，没有读取个人浏览器资料。未运行Linux/Windows、长期资源趋势、任意插件资源交付或公共发布。所有包保持private，仍需本地kit与消费者根Cordis声明补丁；没有推送、公开发布或部署。

下一步优先补插件自身CSS/静态资源在源码开发和tgz消费中的一致交付，继续验证打包边界与子路径，不转向插件市场、Admin业务或新宿主。
