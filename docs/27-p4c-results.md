# cormi P4c：配置派生、来源诊断与 Admin 迁移准备

日期：2026-10-18。基于本地 P4b 提交 `ad61355bb1986013128faa5488528c6ad5428140`。本轮实际完成应用配置派生、来源诊断、命令接入与回归；另选定并克隆真实开源 Admin 模板，**尚未开始移植或运行该模板**。Windows 继续挂起，没有扩展 Linux 平台验证。

最终 macOS arm64 **222 项 Node、14 项真实浏览器测试全部通过，0 失败、0 取消、0 跳过**。13 个框架 tgz 的独立消费者共 **57 个检查阶段**满足预期。精确命令、源码/日志/产物哈希、失败记录见 [本轮机器证据](../artifacts/p4c-validation.json)。相对 P4b 新增 13 项 Node 和 1 项浏览器测试，不将重复运行和负向验收步骤算作额外新用例。

## 1. 用户现在可以使用什么

新增 `cormi config --for dev|build`，对当前可信配置重新求值并运行已注册的应用配置派生。示例支持：

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm build
pnpm cormi config --root examples/features --for build --mode staging --json
```

实际输出中，`/base` 的最终值为 `/staging/`，其来源顺序是 preset `cormi:react-vite` → 用户 `config.app` → 派生 hook `example:deployment:base`。普通模式的同一应用保持 `/workspace/`。可以据此解释某个值被哪一层设置，或某个字段被删除、数组被整体替换，而不靠读取最终配置猜测来源。

`config --for build` 不执行 build handler，不生成应用入口或启动开发服务器；--for 同时让配置工厂、派生回调、默认 mode 和 worker NODE_ENV 与目标命令一致。实际调用仍为 config，避免“检查命令把生产构建启动了”。--for 用于其他命令时明确失败。

`inspect` 则保持原来的上次成功生成快照语义，既不偷偷重算页面，也不在读取快照时执行派生。本轮真实文件断言检查 config/inspect 没有重写原生成清单。

## 2. 插件化实现与公开边界

`applicationConfigPlugin` 位于已有 `@cormijs/plugin-web` 包，提供 `ctx.appConfig.derive` 与 config 命令，由默认 React–Vite preset 显式装配。插件作者用普通 Cordis inject 和 ctx.effect 登记/撤回派生，无第二套生命周期。core 只增加配置数据/来源协议和通用命令 middleware，不引入 React、Vite 或 Web 默认配置。

加载器记录嵌套 preset 默认值、用户 app 和禁用插件项的来源。应用插件在命令之前顺序派生，实际 dev/build/prepare/typecheck 消费同一条链路。回调接收冻结的 value、command、mode 和 AbortSignal，返回完整下一份 app，而不是隐含局部 patch。根目录、插件集合、命令等引导字段不能通过派生回写。

数据复制拒绝循环、访问器、稀疏数组、函数、非有限数字和保留原型字段；有节点、深度和字节预算。每步快照不可变，异步期间贡献者发生变更则拒收过期结果。关闭会取消并等待已进入回调，非合作任务仍由外层 worker 期限兜底，不能把 AbortSignal 说成强制终止用户函数。

输出只有有限白名单应用路径/端口标量可见，runtime options 和任意自定义值默认标为 [redacted]，不保留历史原始值或插件私有 options。字段名、插件 ID 和公开路径不是密钥识别系统；可信配置自己的 console.log、异常文本或任意第三方日志不由这份摘要过滤器统一保护。

**报告范围是应用输入，不是完整构建器最终配置。** basis 为 current-config-evaluation，validation 为 json-and-derivation-only。渲染器/Vite 后续默认值、私有插件 schema 转换、函数读取环境变量的内部依赖和运行中完整服务图尚未纳入；这也不意味着任意配置已经通过 build/typecheck。精确接口见 [配置来源协议](25-configuration-provenance.md)。

## 3. 真正发现并修复的问题

新增“保留 next 在 middleware 返回后再调用”的回归在原实现上先失败：命令已返回仍能被迟到 continuation 再启动。现在每个 invocation 有明确开放区间，返回后调用报 COMMAND_NEXT_EXPIRED；重复调用报 COMMAND_NEXT_REPEATED。旧注销句柄也不能删除同 ID 的新登记。此边界不承诺沙箱化可信 middleware 私自启动而不等待的所有副作用。

首次新增浏览器测试类型检查遇到断言把空数组收窄为 never[]，改用长度断言，保留对真实错误为空的要求。随后更严格的控制台检查复现了 features 示例缺少 favicon 导致根 `/favicon.ico` 404；记录实际错误 URL 后，在示例 HTML 声明内联图标，没有过滤掉 404 或删除控制台断言，也没有将其误写成派生 base 出错。

这些失败日志和最终修复后的执行记录均保留。最终校验后不再修改源码、测试或依赖；只补文档和证据导航。

## 4. 验收范围

| 检查 | 本轮最终结果 |
| --- | --- |
| pnpm check，含框架/测试/脚本类型检查 | 222/222 |
| pnpm test:browser | 14/14 |
| 配置单元/CLI 定向重复 | 13/13，不重复计数 |
| 派生 base 浏览器定向重复 | 1/1，不重复计数 |
| pnpm test:package | 13 个真实 tgz，57 个阶段满足预期 |
| examples/features 应用 typecheck | 退出 0 |
| dev/staging 配置来源命令 | 分别退出 0，核对最终 base 与来源 |
| 冻结锁文件离线安装、原 P0 demo | 分别退出 0 |

新浏览器流程先用 config 得到 `/staging/`，再实际启动 dev，直接访问 `/staging/status`、点击计数器、刷新深链接并核对唯一 Provider。随后用相同 mode 构建，检查 HTML 资产使用 `/staging/assets/`；启动 preview，核对页面、交互和入口文件 mtime 不变。不是只检查报告字符串或 HTTP 200。

浏览器沿用本机 Edge 155.0.4283.62，独立无头 profile；新增场景检查页面 URL、标题、无错误覆盖层、无 pageerror 和开发控制台错误，桌面截图 `.cache/cormi-staging-config.png` 已打开检查。截图是既有 features 示例，不是 Admin 模板迁移成果。既有窄视口与 Fast Refresh 等浏览器回归均保留。

打包验收从仓库外真实安装树执行新的 config --for build，并断言旧 inspect 文件哈希不变；原有无 React/Vite 的 core/launcher、严格声明、缺少 peer、失败构建和应用创建链路仍全部运行。没有以 workspace 内可用代替分发包验证。

最终目录为 `.cache/p4c-final-6902bec27b9948b597b533dec4ff0bf5`，每条命令前后核对 **162 份源码、配置、测试、脚本、示例和补丁**的文件集合与 SHA-256。package.json/pnpm-lock.yaml 没有更改，外部依赖未升级；本轮不新增框架包。历史 P0–P4b 记录不改写，Windows/Linux 的过去通过不扩张到本轮新增实现。

## 5. 真实 Admin 项目已经选定

候选为 [minimal-ui-kit/material-kit-react](https://github.com/minimal-ui-kit/material-kit-react) 免费版，固定 SHA **69e780a40c455d664b2e13c525faf1d492a072a7**。已浅克隆到 `.cache/admin-upstream-material-kit`，工作区干净，保留上游 MIT LICENSE。src/public 共 229 个跟踪文件、2771976 字节，其哈希与关键配置清单见 [上游清单](../artifacts/admin-upstream.json)。没有安装其依赖、运行它的脚本或创建伪装为迁移完成的示例。

实际读到的页面为 Dashboard、Users、Products、Blog、Sign in 和 Not found。Users 使用本地数据并有过滤、排序、选择、分页；Sign in 当前只是导航，不是后端鉴权。后续必须保留这些真实行为，并把新增 API/权限功能与上游原有能力区分，不宣称已有完整 CRUD 或 RBAC。

启动入口和唯一 RouterProvider 由 cormi 接管；原 App 使用路由 Hook，应作为路由内部布局，而不是放到 Router 外的 runtime Provider。src alias、MUI 主题、静态资源/子路径、TS 项目引用与错误页的适配已经逐项列入 [迁移验收计划](26-admin-migration.md)。不复制上游 Vite 启动器造成双路由、双开发服务器或两套 React transform。

下一阶段 P5 直接做这一真实模板的对照迁移：先验证上游，再保存原页面/组件，仅修改明确接缝；从 cormi tgz 安装树完成页面交互、严格应用类型检查、Fast Refresh、根路径和 /admin/ 的构建预览。迁移报告必须记录修改文件、框架缺陷和未保留行为。**尚未移植，不将源码选型与计划当作可用性通过。**

公开包许可/名称归属、Cordis 声明补丁的透明分发、SSR/RSC、多平台与长期稳定性仍保留原有边界。本轮没有推送、发布、部署或新增常驻服务。

> 2026-10-21：为避免磁盘耗尽，`.cache/admin-*` 历史验收快照已按用户确认清理；本文中的这些路径不再存在，历史结论以文字与 `artifacts/` 记录为准。
