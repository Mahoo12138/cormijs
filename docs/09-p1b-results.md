# cormi P1b：路由生成与 React 应用结果

日期：2026-10-16。状态：本机 P1b 纵向链路已验证；完整 P1/P2 和发布门槛未全部完成。机器记录为 [artifacts/p1b-validation.json](../artifacts/p1b-validation.json)，不覆盖 P0/P1a 历史记录。

## 1. Git 与交付

先初始化本地 main 分支，提交 P1a 基线 `a4e33842e1a1e3a67dd949883f8a330bfabfcd18`（chore: initialize cormi plugin-first P1a baseline）。该基线提交前重新执行了 70 项回归，工作区与历史 P1a 源码哈希一致。未配置远端、推送或发布。

P1b 在此基础上增加 routes、plugin-react、runtime、plugin-react-vite、preset-react-vite。Web 命令仍消费抽象 application/builder 服务，core 不 import React/Vite。新增 examples/basic，为真实 React 应用而非 HTML 模板冒充。协议见 [路由与 React](08-routes-and-react.md)。

路由支持明确约定的页面、index、嵌套 _layout、动态参数与终端 catch-all；显式 routes 会关闭约定扫描。路由与 runtime 贡献都经校验再生成静态引用。Node 扫描不执行页面源码；客户端 SDK 导入检查通过真实错误构建验证。

生成器实现 `.cormi/app.tsx` 的所有权检查、原子 rename、revision 过期拒绝与同内容免写。开发服务通过后端无关 invalidate 接口失效转换缓存并整页刷新，不让 React compiler import Vite。组件 Fast Refresh 和结构更新保持不同语义。

## 2. 环境与精确基线

沿用 Node 22.14.0、pnpm 10.6.3、macOS arm64、Cordis npm 4.0.0-rc.11、Vite 7.3.2、TypeScript 5.9.3、tsx 4.23.15、esbuild 0.28.2。

本轮增加并固定 React/React DOM 19.3.1、React Router 7.18.2、@vitejs/plugin-react 5.1.4、@types/react 与 @types/react-dom 19.2.0、playwright-core 1.58.2。浏览器测试使用本机已有 Edge 155.0.4283.45，启动无头独立 profile 并关闭，不下载浏览器或读取个人 profile。这些是本轮验证版本，不表示最新或全部版本兼容。

安装使用 ignore-scripts，最终 offline/frozen-lockfile 安装成功。Cordis 仍使用仅声明文件补丁，未修改上游运行时；正式 npm 消费者如何获得兼容声明仍待解决，包保持 private。

## 3. 实际执行结果

| 验证 | 结果 | 证据范围 |
| --- | --- | --- |
| pnpm check | 93 tests / 93 pass / 0 fail / 0 cancelled / 0 skipped | 框架/测试 TypeScript 与 Node 单元、真实进程、HTTP、文件/端口回归 |
| pnpm typecheck:example | exit 0 | examples/basic 业务源码检查，不等于应用 cormi typecheck 命令 |
| pnpm test:browser | 4 tests / 4 pass / 0 fail / 0 cancelled / 0 skipped | 实际 DOM、导航、状态和生命周期 |
| 生成/编译/命令测试重复运行 | 14 / 14 pass | 重复覆盖，不额外算作 14 个独立新增测试 |
| pnpm demo | exit 0 | 原 P0 显式 HTML+TS 构建/预览/退出未退化 |
| offline frozen install | exit 0 | 锁文件与 workspace 安装一致 |

最终验证前后对 91 份源码、配置与示例文件计算哈希，确认验证期间未改变；时间和日志哈希记录在机器文件中。新增 Node 测试相对 P1a 为 23 项：routes 8、generation 6、React compiler 5、application commands 3、client/Node boundary 1。原 70 项回归保持。

生成队列测试在一个受阻旧任务后接收 100 个新输入，只提交最新值；这不是 100 轮真实文件系统或长期压力稳定性测试。另覆盖同内容 mtime 不变、未拥有目标/符号链接拒绝、生成失败恢复、外部写入冲突，以及卸载过程中迟到准备结果不能启动服务器。

## 4. 四项真实浏览器验收

第一项验证首页真实渲染、计数器、根 Provider、静态导航、users 嵌套布局、动态参数、深链接 reload、`/demo/` 部署基址、catch-all 与 404。正常导航过程中无 pageerror。桌面截图保存到 `.cache/cormi-react-example.png`，只作为本机视觉检查，不是完整移动端验收。

第二项先点击计数器到 2，修改组件标题后验证新标题和 Count:2 同时出现；然后新增页面、访问新路由、制造同路径 .tsx/.jsx 冲突并确认原生成文件保留、移除冲突/原页面后确认 404。删除当前页面时短暂的旧模块/HMR 错误是预期观察，不声称任何源码修改都无错误瞬间。

第三项真实 production build 后删除一个源页面，再启动 preview 验证构建产物仍能访问相应动态路由，生成入口 mtime 不变，首页交互仍工作。证明 preview 没有依赖重新生成页面。

第四项通过浏览器直接调用 mountApplication，验证两个 Provider 外到内组合、setup 顺序、重复 dispose 幂等、逆序 cleanup、取消信号以及后续 setup 失败时回收已获取资源。

## 5. 本轮真实发现的问题

首次框架编译中，路由验证的 never 返回箭头辅助函数未能让 TypeScript 在调用点完成预期的 unknown 收窄。改为有显式 never 返回的函数声明，保留严格类型检查，没有转成 any。

首轮浏览器只有 2/3 通过。失败起初在进度说明里误判为计数器 Fast Refresh，读取具体测试行和诊断后已经纠正：计数状态保留断言已通过，失败在新增路由后访问仍为 404。诊断证明磁盘新入口含 added 页面，但 HTTP 仍返回旧转换模块。

修正不是增加测试睡眠或放宽断言，而是新增 PreparedApplication.updates → Web 命令 → ServerHandle.invalidate 的明确契约。Vite provider 显式失效模块图并发送全页刷新，启动后注册订阅时还对齐一次生成入口。修正后全部浏览器测试通过，额外补命令卸载与缺失失效能力的失败回收测试。

## 6. 如何运行

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm build
pnpm cormi dev --root examples/basic
```

示例默认 `127.0.0.1:8001`，Ctrl+C 停止后运行 build/preview。另有 prepare 命令只生成入口和路由摘要。测试命令与 browser 可执行文件配置见 README。

## 7. 未完成的边界

build 输出仍必须是不存在的专用目录，未实现生产 staging、替换已有 dist 或回滚；失败构建可能留下自身不完整目录。生成器只有一个执行入口，不是多文件事务，不自动回滚业务页面源码。

相对 ModuleRef 目前相对项目根，不是任意插件模块 URL；路由可选参数、路由组、MDX、meta 扩展和完整 Umi 兼容均未提供。Node SDK 检查是已知边界与可信插件下的构建防误用，不是任意代码数据泄漏沙箱。

生成类型文件、应用 inspect/typecheck、初始路由错误的完整开发恢复、结构错误 overlay、Linux/Windows、发布 tarball 全流程、移动端浏览器矩阵及长期内存趋势仍待做。未发布 npm、未推送、未部署；本轮不声称完整 P1/P2 完成。

下一切片优先补生产 staging/发布替换与生成类型/诊断，再执行跨平台和发布消费验证，不扩展 SSR/RSC 等支线。
