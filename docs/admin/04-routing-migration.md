# AM02 / AM09：真实 Admin 启动与错误处理迁移

阶段：P5b；固定上游 `69e780a40c455d664b2e13c525faf1d492a072a7`。原版 [P5a](../28-p5a-baseline-results.md) 与迁移 [P5b](../30-p5b-results.md) 分开记录。根路径首组对照不提前关闭子路径、状态下热更新或各页面剩余交互。

## 1. 源码映射

[migrate.ts](../../scripts/admin/migrate.ts) 对固定快照核对哈希、Git 原内容和文件身份，调用已有创建器建立全新目标；不改只读参考，不清空已有目录。它是指定快照的迁移脚本，不是任意仓库导入器或不可信文件系统沙箱。

原 src/public 229份跟踪文件中，227份逐字复制，只有 `src/routes/sections.tsx` 明确适配，旧 `src/main.tsx` 不再复制执行；新增 `src/cormi-root.tsx`。HTML、Node配置、package.json和tsconfig分别适配。原许可保留为 LICENSE-UPSTREAM.md，不据此宣称全部外部图片资产已完成权属审计。

| 接缝 | 处理 |
| --- | --- |
| createRoot / createBrowserRouter | 由 cormi 生成入口接管，不添加第二个 RouterProvider 或旧 Vite 启动器 |
| App 内部路由 Hook | cormi-root 以 App 包裹 Outlet，处于 Router 内 |
| Dashboard pathless 布局 | 保留 DashboardLayout、原 Suspense fallback、Outlet与主题 |
| 原页面 lazy | 保留六种页面和 React.lazy 导出；显式 IR 接管路由图 |
| 根 errorElement | errorBoundary 引用原 ErrorBoundary 命名导出，原文件不变 |
| StrictMode | app.strict 显式 true，不删除原开发语义 |
| src alias | 普通 Cordis 插件 inject vite 并登记构建 alias，不污染 core |
| tsconfig reference | 移除已不执行的旧 Vite-tools 引用；显式 src/* paths，保留 strict |

migration.json 是创建动作的文件映射收据，installationPerformed/moduleAcceptanceComplete 的 false 描述创建时状态；实际安装与验收以新锁文件、日志及本轮结果为准，不把收据当持续测试数据库。

## 2. 实际依赖差异

迁移使用 cormi 锁定的 React/React DOM 19.3.1、React Router/DOM 7.18.2，区别于原版19.1.0/7.4.1。没有放宽框架 peer。其他直接 UI 依赖来自原锁文件；新 pnpm-lock 单独保存，不声称新旧安装树完全相同。

首个安装只锁 material7.0.1，传递 system/utils 却漂移到7.3.11、types到7.4.12，原 chart、label、theme 中的 borderRadius 算术出现3个TS2362。实际原树 system/utils/styled-engine 是7.0.1、types是7.4.0。迁移工具修正为固定整个原 @mui 包族，未改业务表达式、增加类型断言或关闭检查，后续应用 typecheck 通过。Cordis 消费者根声明补丁仍明确交付，不改变其运行时。

## 3. 原异常页的真实故障注入

[errors.ts](../../scripts/admin/errors.ts) 只改明确传入的迁移副本 `src/pages/user.tsx`。修改前核对原页面和边界哈希，每次写入检查文件身份/前次内容；结束恢复原字节，有外部改动则拒绝覆盖。

dev 分别注入渲染异常、模块顶层异常和网络中止，要求显示原版 Unexpected Application Error! 及原异常内容，不出现普通404或旧业务布局。撤回后重新访问，Users 和名称搜索恢复；同一 dev worker 不重启。生产对前两种错误分别真实构建、preview验证，再恢复正常构建并中止真实 user-*.js chunk，检查错误呈现及解除后的页面恢复。日志保留预期失败请求/控制台异常，不把故障注入说成零错误日志。

原图只有根边界；嵌套、边界自身渲染抛错、同路由网络失败由框架的真实生成入口测试覆盖，不能冒充模板原有业务。原错误组件在生产也展示浏览器异常细节，目前忠实保留；生产脱敏/上报需要另行设计，Node配置摘要的过滤不负责用户组件主动输出的文本。

## 4. 模块状态

未改 modules.ts 断言：Header切换和移动导航、8个Dashboard图表与任务、Users完整24人分页排序/过滤选择、Products24卡片和控件、Blog23卡片和补全、演示登录导航及404均在迁移版根路径 dev/preview执行。上游分页总数、全选范围、通知焦点和占位按钮语义保留，不悄悄增强后宣称等价。

剩余议题包括完整图表 tooltip/尺寸/销毁、长页下部、键盘和焦点矩阵、Admin交互状态下Fast Refresh、配置失败切换、实际模板的/admin/资源。当前配置 base:'/'；不能将框架/admin/错误fixture通过推广到有硬编码/assets的真实模板。AM10为下一项优先工作。

## 5. 使用与重放

已安装副本：`/Users/mahoo/Projects/cormijs/.cache/admin-cormi-p5b-a5f59e639560`。自带 .cormi-local 归档/补丁，使用自己的 CLI；默认127.0.0.1:3039。先停止dev再执行typecheck/build/preview。

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
cd .cache/admin-cormi-p5b-a5f59e639560
pnpm dev
```

另建副本时，先在框架根运行 pnpm pack:local，再明确指定返回的kit和不存在的新目标：

```sh
node --import tsx scripts/admin/migrate.ts \
  --kit /absolute/path/to/verified-kit \
  --out /absolute/path/to/new-admin-copy
```

创建器不自行安装/启动，随后在新副本执行 pnpm install --ignore-scripts。整体移动时保留 .cormi-local 和安装后锁文件。本迁移用于框架验证，尚非公开发布的生产后台产品。

> 2026-10-21：为避免磁盘耗尽，`.cache/admin-*` 历史验收快照已按用户确认清理；本文中的这些路径不再存在，历史结论以文字与 `artifacts/` 记录为准。
