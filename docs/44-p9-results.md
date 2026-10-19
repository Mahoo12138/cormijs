# cormi P9：插件样式、图片与字体的独立交付

日期：2026-10-19。接续本地 P8 提交 `ebd9947e4302f69d054c57bb4ec15260d9616997`。本轮把已有插件作者工作区的资源交付补齐，并完成接续复核。Node/client 配对、服务注入与贡献撤回沿用原生 Cordis；没有新增框架包、修改 core/launcher/runtime/Vite provider、升级依赖或扩展 Admin 业务。

最终完整验证为 **311 项 Node、17 项框架浏览器测试全部通过，0 失败、0 取消、0 跳过**；13 个真实框架 tgz 的独立消费验收为64个阶段，插件作者链路分别以带字体和默认配置执行两轮，每轮38个阶段。阶段含明确的负向断言，不等于新增单元测试。精确结果、输入与日志哈希见 [机器证据](../artifacts/p9-validation.json)，接口和边界见 [资源协议](43-plugin-assets.md)。

## 1. 从插件作者到消费者的实际能力

`create-cormi --template plugin-react` 现在生成带 CSS Modules、嵌套 CSS token 和 SVG 的插件页面，浏览器代码仍由独立 `/client`、`/page` 导出。Node 根入口只声明原生子插件及页面/runtime/API贡献，不 import 执行浏览器模块。

普通 `pnpm build` 编译 TypeScript，再按 src 相对目录复制支持的样式、图片、字体与普通声明文件到 dist；`pnpm pack:plugin` 则在全新源码快照中重新编译和复制，打出真实 tgz，不复用作者旧 dist。消费者无需手动把插件图片复制到自己的 public，也不需要作者的源码别名、构建脚本或整个工作区。`sideEffects: ["**/*.css"]` 随分发元数据保留。

页面使用静态 `import illustration from './assets/plugin-mark.svg'`，CSS 使用相对 `@import` 和 `url()`；CSS Modules、资源内联/哈希文件名和应用 base 的变换交给消费应用的构建后端。默认模板没有附带第三方字体，本轮字体只作为显式测试输入，不进入默认试用项目或对话附件。

生态参考继续采用固定 Koishi WebUI 的 Entry 文件声明与 status 包的分发边界，独立实现 cormi 的资源工具；不移植 Vue 控制台，不把 Cordis 当作浏览器 CSS 加载器，也不再增加一套插件生命周期。

## 2. 两个实际发现的交付问题

**源码可用，不代表依赖预构建后仍可用。** 初始探针中的 `new URL('./assets/...', import.meta.url)` 在源码联调正常，但安装到 node_modules 后，模块移入 Vite deps 缓存，资源 URL 随之指向错误目录。实际 SVG/PNG 请求得到的是 HTML 200，图片自然尺寸为0。记录保存在 `.cache/p9-optimized-url-probe.json`。模板改为显式静态资源导入，由构建器识别和转换；没有关闭全部依赖优化或复制资源到错误位置来掩盖问题，也不承诺修正任意第三方库的 new URL 写法。

**输出保护不能等编译器写完才做。** 初始输出准入测试证明：若 dist 是链接，旧脚本可能先调用编译器，再在资源复制时拒绝。修正为启动 TypeScript 前检查 dist 及其已有子项，拒绝链接、硬链接和特殊文件。原始失败记录 `.cache/p9-output-admission-red.log` 保留。

资源复制增加 `dist/.cormi-plugin-assets.json` 所有权清单：同内容免写；源码资源删除/改名时，只清理哈希仍符合旧记录的受管输出；用户修改过的资源和未知目标不自动覆盖或删除。整个资源变更集先检查，再执行资源写入和移除，不依赖目录名称猜所有权。

## 3. 接续复核增加的复杂场景

接续时 P8 已提交，P9 实现和308项初批记录仍在工作区。本轮保留这些改动，核对源码后新增三项 Node 回归：删除源资源同时用户改写旧输出、其他资源发生变化时，必须整体拒绝本次资源复制且不触碰用户文件；九个单独不超限的文件合计超过8MiB时必须拒绝；编译期间源 CSS 被修改时，必须拒绝复制混合代际资源。

最后一项使用受控编译入口制造确定性时序，真实 TypeScript 编译由两轮独立消费链路另行验证，不能混为同一种证据。这三项加入原有十项资源测试，13项全部通过。连同四项作者模板回归，定向17项再次通过。

浏览器流程补上独立消费者根路径的 dev 资源检查，并核对实际页面 URL 和标题。现在根路径与 `/customer/` 各自覆盖 dev、build和preview，不再只以根路径生产截图代替开发环境验证。相对初批P9，代码差异仅为 `tests/plugin-assets.test.ts` 和 `scripts/test-plugin-author.ts` 的复核断言；未在验证结束后悄悄改变产品实现。

## 4. 真实打包、重定位和浏览器结果

每轮由真实创建器包生成仓库外作者项目，安装自身依赖，完成库类型、应用类型、源码联调、插件打包，再在另一个独立应用中安装 tgz。作者和kit移出原位置后，删除消费者自己的 node_modules，按未变化锁文件重新安装；后续不允许从作者源码或框架 workspace 回退解析。

源码开发中先将计数器置为1，再修改嵌套 CSS token，使边框从2px变为6px，随后恢复；整个过程 Count:1和页面文档身份保持不变。修改真实页面标题同样保留计数；Node API源码修改和整体插件停用/启用则走原有worker重启。API、Provider与路由不引入第二套更新机制。

两轮各有五个资源验证点：作者源码开发、消费者子路径开发、消费者子路径预览、消费者根路径开发、消费者根路径预览。每个点核对 CSS Module 的实际类名和计算样式、嵌套CSS、背景、SVG与PNG解码、MIME、URL前缀及大SVG/PNG响应字节。中文和空格文件名、内联小资源与输出为哈希文件的大资源分别检查，不把HTML fallback的200当作成功。

字体轮显式使用本地已安装的 `@fontsource-variable/dm-sans@5.2.5`，仅复制指定WOFF2和原LICENSE到该轮临时作者输入；验证源码、dist、tgz和实际网络字节，并检查真实FontFace加载及目标元素字体。五个资源点均为 `fontChecked:true`。默认轮五处均明确为false，但样式/图片检查完整执行；默认模板不需要测试字体才能通过。

生产应用保留插件页面和Provider，开发API不提供；独立消费者完成连续构建、诊断与预览。两轮页面异常与控制台error/warning断言均为空，退出后检查项目锁清理和端口可重新绑定。Admin源码、旧试用项目及已有服务没有用于这些写入实验。

## 5. 最终验证与失败记录

| 检查 | 最终结果 |
| --- | --- |
| pnpm check，包含框架/测试/脚本类型检查 | 311/311 Node；相对P8新增13项 |
| pnpm test:browser | 17/17，既有框架浏览器回归 |
| pnpm test:package | 13个框架tgz，64阶段满足预期 |
| pnpm test:plugin，显式字体输入 | 38阶段，五处字体与资源验证通过 |
| pnpm test:plugin，默认输入 | 38阶段，五处样式/图片验证通过，未执行字体分支 |
| 资源与作者定向重复 | 17/17，不重复计为新增用例 |
| 新试用项目build、两类typecheck、diagnose、pack | 均退出0 |
| workspace及新试用项目冻结锁离线安装 | 均退出0 |

完整最终目录 `.cache/p9-reviewed-f84ed78ed7`，16条顶层命令全部成功，每条前后核对206份框架/测试/脚本/配置输入。新试用项目另记录22份输入，170处安装链接全部位于自身安装树内；13份框架归档中51份源码逐字匹配当前实现。随后只补文档和汇总证据，没有修改通过验证的源码。

先前 `.cache/p9-reviewed-678f2e1a56` 的完整检查为311项中310通过、1失败，原因是本轮执行包装器将 `CORMI_PNPM_CLI` 指向pnpm的无后缀链接，而不是契约要求的绝对JavaScript入口。修正包装器环境为实际 `pnpm.cjs`，没有改产品代码或断言，再从pnpm check重跑全部16条命令。初批308项结果、输出保护红色用例、URL探针和该包装器失败均保留，不拼成一次不存在的全绿运行。

浏览器为已有Edge155.0.4283.62的隔离无头上下文，沿用项目Playwright，没有访问个人浏览器资料。实际打开复核了1280×800作者热更新图和390×844独立消费者生产图：样式边框、SVG、计数和生产API禁用状态可见；黑色小块是明确的1像素PNG测试资源。截图仅证明这两个视口/时刻，不以截图证明字体字节或完整浏览器矩阵。

## 6. 可直接使用的插件项目

已生成、安装并完成构建/类型/诊断/打包的默认项目：

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
cd .cache/plugin-author-p9-f84ed78ed7
pnpm dev
```

默认访问 `127.0.0.1:8003/workbench/plugin`。它是插件作者工作区，不是Admin新业务。停止dev后，可执行 `pnpm build`、`pnpm typecheck`、`pnpm check:app`、`pnpm diagnose --for dev` 和 `pnpm pack:plugin`。build编译插件库到dist，build:app才构建联调应用到app-dist，pack:plugin生成独立可安装tgz；不自动publish。

本轮现成插件包位于该项目的 `artifacts/plugin-49lcM3/example-hello-0.0.0.tgz`，包含9份源码与对应编译/资源文件，保持private:true。整个作者项目可以迁移，但需保留自己的 `.cormi-local/`；第三方依赖初次安装可能需要网络。新建其他项目仍通过本地kit执行 `create-cormi --template plugin-react`，完整流程见 [作者指南](41-plugin-authoring.md)。

## 7. 保留边界与下一步

普通库build不是整个dist的原子事务：TypeScript可能在后续资源检查失败前已经产生输出，资源逐个rename、清单最后写入。源码快照和所有权保护不等于断电回滚、跨进程原子互斥或恶意代码沙箱。默认支持有界CSS、常见图片、字体和声明文件，不含Sass/Less、WASM、JSON等任意资源工具链；本轮浏览器实测CSS、SVG、PNG、WOFF2，不扩大为所有允许扩展的全格式验证。

插件卸载不承诺由Cordis自动移除所有已经注入浏览器的CSS；消费者构建器负责资源变换。核心包、依赖锁与五个参考checkout保持不变，没有执行Linux/Windows、其他浏览器或长期资源趋势，也没有公开发布、推送、部署或留下本轮常驻测试服务。

下一步围绕同一插件的多实例和命名空间：由真实的route/runtime/API贡献冲突及独立撤回场景检验公共契约，减少作者重复配置；不为了扩大功能清单新增插件市场、Admin业务或通用前端宿主。
