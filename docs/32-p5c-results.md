# cormi P5c：Admin 子路径资源、状态热更新与失败构建保护

接续本地 P5b 提交 `e700d73f2e2eebf0227c5af72acef6aef28dedc1`，完成 AM10 部署基址和 AM11 的状态热更新、失败构建子范围。真实 Material Kit React 现在分别在 `/` 与 `/admin/` 下通过 dev、应用 typecheck、build、preview 和原版同组模块契约。**没有将全部11项迁移议题、生产托管或跨平台支持一并标为完成。**

最终接续复核重新执行246项Node、17项框架浏览器和13个tgz的57个独立消费者阶段，全部满足预期。根/子路径四组模块与资源验收、两个应用的类型/构建/冻结安装，以及状态热更新和失败构建两轮均重新运行通过。相对P5b新增15项Node，不按重复次数或HTTP请求数累加。最新命令、源码/应用/包/截图哈希见 [复核机器证据](../artifacts/p5c-review-validation.json)；[前期机器记录](../artifacts/p5c-validation.json)及原失败历史完整保留，实现契约见 [部署与开发协议](31-admin-deployment-and-development.md)。

## 1. 可直接运行的子路径应用

本轮独立安装副本：`/Users/mahoo/Projects/cormijs/.cache/admin-cormi-p5c-subpath-f7aa4a5b90`。默认监听 `127.0.0.1:3039/admin/`；Users为 `/admin/user`，Products为 `/admin/products`。

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
cd .cache/admin-cormi-p5c-subpath-f7aa4a5b90
pnpm dev
```

停止dev后再执行 `pnpm typecheck`、`pnpm build`、`pnpm preview`。这些命令使用应用自己的cormi安装，不借用框架workspace。测试修改的Users/Products文件已恢复，正常生产产物保留；测试服务器不作为常驻服务交付。

另有根路径对照副本 `.cache/admin-cormi-p5c-root-f7aa4a5b90`，也使用3039，不能与子路径副本同时占同一端口。两者各自拥有 `.cormi-local` 里的13个框架归档、显式Cordis声明补丁和独立锁文件；各348处安装链接均限制在自己的应用目录中。冻结锁文件离线安装通过，仍不承诺无缓存首次安装不需要联网或已公开发布npm。

## 2. 资源迁移具体改了什么

先在新的P5b副本仅修改base，实际复现浏览器仍请求域名根 `/assets/...`：头像、商品图、导航图标、404插图及登录背景出现失败。这是动态字符串没有采用部署前缀，不是“首页有DOM所以迁移通过”。原失败日志保留在 `.cache/p5c-base-red-deb636cc35.log`。

迁移工具按AST适配10个原文件内26处资源表达式，新增应用本地 `publicAsset()`，从Vite的已解析 `import.meta.env.BASE_URL` 取得前缀。favicon改用HTML的 `%BASE_URL%`。原路由Link、navigate、SVG `url(#id)`、模块导入和注释不做全局替换，避免 `/admin/admin/` 和误改代码。

原src/public共229份跟踪文件中，217份逐字保留；10份仅调整资源表达式，1份是P5b已有的路由声明适配，旧main不再运行。**100份public资源本体全部保持原字节**。每处修改的原行号、表达式种类和前后哈希存入应用migration.json；没有删掉图表、卡片、主题或业务交互，也没有把模板专属资源函数加入core。

## 3. 同一部署基址的框架约束

新增真实回归发现：原生Vite插件能在config hook中返回另一个base，而生成Router继续使用app.base。三个dev/build/preview拒绝断言在修复前实际失败，属于框架配置所有权缺口。

现在Vite provider在configResolved比较实际base与BuildPlan，不一致报 `VITE_RESERVED_CONFIG`，要求通过应用配置或派生来改变基址。原生插件填写相同base仍允许。回归同时检查缓存清理和原preview产物未被改写。本轮框架运行时代码仅增加这个provider检查，没有更改core、React runtime或依赖版本；这也不是对任意可信插件副作用的安全沙箱。

## 4. AM10 的实际资源和页面验收

| 环境组合 | 文件验收 | 浏览器验收 |
| --- | --- | --- |
| `/admin/` dev | 全部100份public文件的状态、MIME、SHA-256 | 六类页面直接访问/刷新、桌面/窄屏、长页滚动、弹层资源、内部链接 |
| `/admin/` preview | 同100份public，加53份生产JS/CSS/字体 | 同组页面和交互，且生成入口不被preview改写 |
| `/` dev | 全部100份public | 根路径同组页面和资源，防止只修子路径导致根路径退化 |
| `/` preview | 100份public加53份生产资源 | 同组行为；图片等待修正后额外重复一轮 |

每个文件的响应字节与本地产物比对，不把HTML fallback的200当作图片或JavaScript成功。浏览器拒绝所有离开本origin及本部署前缀的请求，不增加域名根资源映射来掩盖错误；最终资源检查的错误列表均为空。DM Sans Variable与Barlow实际载入，CSS背景/遮罩及图片解码已检查，开发WebSocket路径也在前缀内。

六类页面包含Dashboard、Users、Products、Blog、Sign in、404。测试实际滚动长页，打开通知、语言、工作区弹层触发额外资源；Logo回首页、侧栏跳转、浏览器后退、深链接刷新与同源链接前缀都被检查。固定视口为1440×1000和390×844，不等于真实移动设备或所有像素矩阵。

此前原版模块契约仍使用同一 `scripts/admin/modules.ts`，没有更改其功能断言：两种base的dev/preview四轮各7组、38条观察，与P5a原版JSON逐项相同。包含原分页总数、全选范围、Products/Blog演示控件及演示登录语义；相同不表示这些原设计合理，也不是已实现真实CRUD或鉴权。

## 5. AM11 的状态热更新与失败保旧

Users测试先设置每页10条、降序、Billy筛选结果并选中一行，再修改实际UserView标题。两次修改和恢复中，两个Billy的顺序、复选状态、分页设置、过滤值及 `performance.timeOrigin` 都保持原值，不能靠重新导航重建状态来通过。截图中的 `Users live 2` 是当次测试输入，业务源码最终恢复原来的Users标题。

Products先设置Price: Low-High、第二页、Women与Above $75，并保持过滤抽屉打开，再修改真正持有state的ProductsView。两轮中抽屉、选项、卡片序列和文档身份保留，关闭抽屉后排序与页码仍正确。原24张商品卡未因这些演示选项改变，不将“state保留”包装成真实商品筛选实现。

以上完整工作流另重复一轮，两次执行均只有一个worker启动、没有整页重载。每次成功build后记录155份发布文件，注入Users语法错误并再次build，要求退出1且每个旧文件哈希都不变；恢复源码后应用typecheck通过。所有修改只在本轮新副本进行，写入和恢复核对inode/realpath及前次内容，不触碰上游或覆盖外部修改。

## 6. 验证来源、失败与修正

| 检查 | 当前证据 |
| --- | --- |
| 框架Node与类型检查 | 最终246/246，0失败/取消/跳过 |
| 框架浏览器回归 | 最终重新执行17/17，0失败/取消/跳过 |
| 独立包消费者 | 最终重新执行13个真实tgz、57个阶段，全部满足预期 |
| 定向回归 | 最终15/15重复通过；6项资源适配、4项Vite基址、5项绑定/模块边界 |
| Admin原模块对照 | 最终重新执行根/子路径dev/preview，共四轮7组38条观察，与原版逐项一致 |
| Admin资源专项 | 最终四组全部通过；每组100份public，preview另53份生产资源 |
| Admin状态与失败构建 | 最终整体两轮，每轮Users/Products各两次改动/恢复，155份旧产物保留 |
| 两个应用typecheck/build/冻结安装 | 最终各自重新执行通过 |

初批完整验证在 `.cache/p5c-final-1296b4e243`，上述框架回归、包消费、模块和状态检查已通过，但最后root资源preview发生两个workspace-logo请求 `ERR_ABORTED`，整轮正确记录为失败。原因是新挂载弹层图片已声明src、currentSrc尚为空，测试提前结束等待并关闭弹层。修正测试为等待声明的src解码，并等待Logo目标页面完成图表加载后再离开；没有屏蔽错误请求或改产品代码。

修正后仅 `scripts/admin/deployment.ts` 一份测试脚本与初批哈希不同。`.cache/p5c-resource-review-2951a88565` 重新执行241项Node/类型、全部受影响资源组合和重复根preview、两应用冻结安装，全部通过；其他已通过检查基于相同实现/测试/应用输入保留其证据。两份记录和这一次差异都保存在机器证据中，不宣称初批全绿或隐去失败。

前期证据核对175份框架/脚本/测试/配置输入；接续时先确认这些哈希与工作区一致，保留未提交实现，再增加五项复核回归和修正。最终一轮覆盖176份框架/脚本/测试/配置输入、每个应用258份输入，每条命令前后均核对。两个应用的13个tarball各有45份src与当前框架一致，348处安装链接分别不越界；依赖锁未变化。最终实现验证后仅补文档和汇总证据。参考Cordis、Umi及Admin上游checkout仍干净且原提交不变。没有执行Linux/Windows，也没有沿用过去的平台成绩为本轮新增适配背书。

## 7. 资源迁移工具的接续复核

新增 [admin-assets-review.test.ts](../tests/admin-assets-review.test.ts) 的五项断言先全部复现失败，日志 `.cache/p5c-assets-review-red.log` 保留。问题分别是：遗漏let/var、参数、解构及导入等同名绑定；动态import等模块引用被误改为资源调用；已有正确helper导入后追加新地址造成重复导入；注释/普通文本被正则误判为声明；没有有效导入或来源错误的同名helper调用被认作已适配。

修正使用AST核对声明与模块引用，保守拒绝嵌套遮蔽，复用且仅复用来源正确的非type-only helper导入。动态import、require/resolve与类型导入需要另行迁移，不能假装它们与public文件URL相同。前述五项和既有十项定向用例全部通过。两个现有迁移应用分别重新比对124份客户端源码，10文件26处适配结果与当前工具输出逐字一致；本次工具修正没有修改业务页面或已安装框架包。

最新完整运行目录为 `.cache/p5c-review-final-d67f73da97`，共20条顶层命令，原始报告和日志路径/哈希均保留于最新证据。整轮在相同输入下从框架检查一直执行到两个应用冻结安装，当前结论不再依赖拼接前期不同轮次的通过结果。故障构建的预期非零、原业务缺陷与占位行为仍分别记录，没有因最后通过删去此前失败。

实际打开复核了本轮 `/admin/` 的Users窄屏、生产Sign in背景，以及Users与Products在第二次热更新时保留筛选/选中/抽屉的桌面图。截图只是相应视口和时刻的证据，完整字体/资源响应仍以请求记录为准；不将几张截图等同于所有像素、控件或真机审查。

## 8. 模块进度与下一入口

AM10在当前固定模板、依赖和Mac浏览器环境的根/子路径资源、深链接、构建预览子范围已通过；不扩张为任意CDN、线上反向代理、相对base、PWA或所有浏览器。AM11已增加真实Users/Products状态Hot Refresh和失败build保旧；配置错误保旧worker、修复切换和结构更新组合仍待该真实应用专项验收。

下一项优先AM03 Header键盘/焦点与通知已读焦点缺陷的独立修正，以及AM04图表完整tooltip、尺寸和销毁；持续区分上游修复与框架适配。原Users过滤计数、全选语义等不在本轮悄悄改变。当前没有推送、公开发布、部署或增加常驻服务，完整模块清单见 [台账](admin/00-module-ledger.md)。

> 2026-10-21：为避免磁盘耗尽，`.cache/admin-*` 历史验收快照已按用户确认清理；本文中的这些路径不再存在，历史结论以文字与 `artifacts/` 记录为准。
