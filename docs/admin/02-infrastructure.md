# Admin 基础设施：独立议题与完成门槛

回到 [议题台账](00-module-ledger.md)。这些共用能力与业务页面同等重要，不作为“页面能看见”后的可选优化。以下区分已读源码、已执行原版基线与仍待迁移验收的要求，准确状态以结果记录为准。

## AM01 安装与交付

固定上游 SHA、原 package.json/package-lock.json 和源码哈希。上游参考 checkout 不安装、不修改；基线副本使用 `npm ci --ignore-scripts --no-audit --no-fund`，从原锁文件安装，安装后再次核对跟踪文件。记录实际 React/Router/MUI/图表库/Vite/TypeScript 版本，不用范围版本表示实际运行环境。

迁移副本应自带 pnpm-workspace.yaml 与 `.cormi-local/`，框架从真实 tgz 安装，不允许安装链接返回框架 workspace。业务依赖必须显式声明。上游原 React/Router 版本与 cormi 当前 peer 下限不同，需要单独记录版本差异并对照行为；不能把 MUI、图表或原 Vite 变成 core 依赖。原 SWC 和 checker 不与框架的 React transform/类型检查器并行启动。

目标是复制或移动后在独立目录干净安装，并执行自己的 CLI。源码许可、图片资产来源、依赖许可与框架公开发布许可是不同问题；模板 MIT 不等于所有资产已完整审计。本阶段没有公开发布行为。

## AM02 启动、路由与代码分块

上游 main 创建唯一 React root，StrictMode 内使用 RouterProvider；其根 Component 为 App 与 Outlet，并带 errorElement。App 使用 usePathname，因此必须位于 Router 内。迁移时由 cormi 接管 root/router，App 成为根路由布局；保留 Dashboard 的 pathless layout、嵌套 Outlet/Suspense、AuthLayout、所有原业务地址与 404。StrictMode 的差异也要明确，不以页面渲染相同推断生命周期完全等价。

逐路由核对直接访问、刷新、Link/程序化导航、浏览器前进后退、滚动复位、路径基址。懒加载应保留，不为省事把所有页面一次性静态导入；错误组件何时加载须独立设计。切换路由不应意外重复 ThemeProvider、runtime setup 或导航订阅。错误边界缺口见业务文档 AM09，未解决前本议题不能关闭。

## AM03 布局、主题、Header 与弹层

来源：`src/app.tsx`、`src/theme/theme-provider.tsx`、`src/layouts/dashboard/layout.tsx`、`src/layouts/components/*`。保持 ThemeProvider、CssBaseline、CSS 变量、排版、字体、组件默认值和响应式布局，不换成简化壳以避免 MUI 问题。

已读源码显示：语言 Popover 仅改 locale/旗帜，不翻译页面内容；WorkspacesPopover 仅改当前展示对象，不切后端租户；NotificationsPopover 的“全部已读”改变内存 state；Searchbar 的 Search 按钮仅关闭面板；AccountPopover 菜单执行导航，但 Logout 没有处理器。源码依据与实际交互必须分别记录，不能将装饰性切换报告成国际化、多租户、全局搜索或认证能力。

首组基线检查语言旗帜变化、未读数清零、工作区名称切换、侧栏导航/浏览器后退、移动 Drawer 点击导航后关闭。仍需核对弹层焦点/Escape/点击外侧、通知列表滚动、重载是否恢复默认值、账号菜单真实目标、搜索展开/关闭、移动 Header 遮挡与主题间距。上游无名称的图标按钮属于无障碍改进候选，不能为了方便测试偷偷加标记再称为原版。

实际发现了 Mark all as read 移除当前焦点按钮后 Escape 无法关闭通知弹层的问题，详见问题登记 UP-03。行为脚本记录原版缺陷，测试中的重新聚焦不是产品修复。

## AM10 静态资源、字体与基址

收集实际请求与失败资源、img.currentSrc/naturalWidth、字体就绪、SVG 与 CSS 背景来源。截图覆盖 1440×1000 和 390×844；DOM 宽度与实际图片都检查。已请求资源成功不能证明未触发的全部资产可用，懒加载、错误态插图和抽屉资源需要触发对应行为后另验。

上游存在硬编码 `/assets/...`。仅设置 Vite base 不能推断动态字符串已经改写。迁移必须同时在根路径与 `/admin/` 检查 HTML 入口、动态 chunk、CSS、字体、图标、头像、商品图片、404 插图和返回链接；禁止借助域名根目录额外映射掩盖子路径错误。修复属于应用资源引用或显式适配插件，不扩张 core 的 UI 知识。

浏览器基线拒绝外部请求，失败记录不被静默过滤。这是浏览器请求约束，不是系统网络隔离，也不对生产 CDN 可用性作保证。截图中的日期/数据存在变化时应先查明原因，不能拿不同业务输入做像素等价结论。

截图复核另外发现，整页截图在本机浏览器中可能捕获到 Dashboard 侧栏 padding 过渡与图表动画的中途状态。独立探针记录截图前主体 x=300，整页捕获后 x=208.25 的过渡状态；固定视口截图显示正常300像素侧栏。当前证据改用固定视口、真实布局/图表路径稳定检查，并核对截图前后几何不变，不通过修改应用CSS或隐藏侧栏制造一致。整页长图不作为本轮视觉通过依据，后续需要逐区滚动捕获。

## AM11 开发反馈与生产产物

在 Users 已有筛选/选择、Products 已有过滤选项时修改普通组件，验证状态保留及其边界；结构路由修改允许框架约定的刷新，但不得留下旧导航。修改配置依赖，制造语法错误和运行错误再修复，记录 worker 代际、当前是否还提供旧实例、端口及资源关闭，不将任何错误都说成零停机。

typecheck 必须检查业务与生成代码，不能删除严格选项来绕过。原 tsconfig references 要明确拆分应用与旧工具配置，并保存理由。开发告警、类型错误、构建失败分别记录。连续 build、失败 build 保留旧产物、preview 不重新生成源码和部署基址，均使用独立 Admin 自身 CLI 验收。

原版 tsc 与 Vite 构建可以按原脚本的具体步骤执行，但不得调用 clean/re:build 等删除命令。已有框架回归不代表 Admin 工作负载已通过；后续框架修正必须在原回归外再运行这些业务场景。
