# cormi：真实 React Admin 迁移验收计划

日期：2026-10-18。状态：已完成候选源码与许可核对，**尚未执行迁移、安装依赖或通过 Admin 浏览器验收**。本计划是 P4c 之后的下一条开发主线，不再以 Windows 或抽象功能列表作为前置条件。

## 1. 选择的真实项目

选择 [minimal-ui-kit/material-kit-react](https://github.com/minimal-ui-kit/material-kit-react) 的免费版本。它是 React SPA，而不是需要先移植服务器协议的 Next.js 工程；源码包含 Dashboard、Users、Products、Blog、Sign in 和 Not found。上游 MIT 许可见 [固定许可文件](https://github.com/minimal-ui-kit/material-kit-react/blob/69e780a40c455d664b2e13c525faf1d492a072a7/LICENSE.md)。

本地只读参考位于 `.cache/admin-upstream-material-kit`。本次浅克隆固定 HEAD 为 **69e780a40c455d664b2e13c525faf1d492a072a7**，src/public 共 229 个跟踪文件、2771976 字节。没有执行上游 clean、re:build 等清理脚本，也没有安装其依赖或修改它。文件数量只是迁移范围，不代表复杂度或已验证比例；固定文件哈希见 [上游清单](../artifacts/admin-upstream.json)。

包声明使用 React ^19.1.0、React Router DOM ^7.4.1、MUI ^7.0.1、TypeScript ^5.8.2、Vite ^6.2.5。迁移时保留应用组件/主题，不把这些依赖塞进 cormi core。React、Router 与 cormi 实际 peer 的交集需要在新应用锁文件中明确固定；不把复制 package.json 就视为已经兼容。

参考 package-lock.json 记录 apexcharts 4.5.0、react-apexcharts 1.7.0、MUI 7.0.1、minimal-shared 1.0.7，license 元数据均标为 MIT。这只是上游锁文件记录；实际安装时仍核对对应 tarball 的许可证与资产来源。不能因模板 LICENSE 是 MIT 就宣称全部浮动依赖和图片资产的许可已经审计完毕，不自动升级图表库。

## 2. 必须保留的原始能力

迁移不是重新画一个相似后台，也不是把整个原 App 套在另一层 RouterProvider 中。保留上游页面、MUI 组件、主题、CSS、图表、图标、静态资源和已有交互；改动集中在启动入口、路由注册、构建配置与必要的平台适配。

已读源码表明 Users 使用 _users 本地数据、名称过滤、排序、选择与分页；页面的 New user 按钮目前没有实际创建处理器。SignInView 的 Sign in 仅 router.push('/')，不是服务端身份认证。因此首批迁移应忠实保留这些行为，不报告“完整 CRUD、登录鉴权或 RBAC 已通过”。后续新增真实 API/权限流程必须标注为 cormi 验证扩展，而不是上游原有能力。

## 3. 源码映射与已经识别的接缝

| 上游入口 | 迁移方案与检查 |
| --- | --- |
| src/main.tsx 的 createRoot/createBrowserRouter | 改为 cormi 生成入口拥有唯一 React root 与 router；删除运行路径上的重复启动器，不能嵌套第二套路由 |
| src/app.tsx | App 自己调用 usePathname，必须保持在 RouterProvider 内；用根路由布局包裹 Outlet，不直接搬到路由外 runtime Provider |
| src/routes/sections.tsx | 显式路由 IR 映射原 dashboard pathless layout、四个业务页、auth layout、404/splat；保留 Suspense 及布局行为 |
| vite.config.ts 的 src alias | 用一个显式注入 ctx.vite 的 Cordis 桥接登记 alias；不让 core 认识 MUI 或擅自读取上游 vite.config.ts |
| 原 SWC/TypeScript checker 插件 | 使用 cormi 的 React–Vite 集成及独立 typecheck；不同时启动两套 React transform、dev server 或 watcher |
| tsconfig.json 的 tsconfig.node.json reference | 当前 cormi 不支持 solution reference；分离应用与旧构建工具检查入口，保留 strict，而不是开 noCheck 或任意 any |
| public、CSS 和源码里的资源引用 | 同时验收根路径及 /admin/，查找硬编码 /assets 等引用；不能只看到 HTML 就忽略缺失字体/图片 |
| 依赖与构建脚本 | 独立消费者使用真正的 cormi tgz，不依赖返回框架 workspace 的 symlink；保留原版权，记录修改文件与 hash |

自定义 errorElement 到 cormi 的错误处理边界需要单独评估。遇到不支持的行为应记录为框架缺口或透明的局部适配，不删除交互来让测试通过。配置派生可统一 /admin/ base；但来源诊断本身不是“资产路径必然正确”的证明。

## 4. 验收顺序

先建立不修改上游源码的对照运行基线，记录锁文件、六个页面截图和真实行为。随后在独立迁移副本中替换启动/路由/构建接缝，记录源文件哈希与改动清单。最后用 cormi 的 dev/typecheck/build/preview 检查同一组流程，并将差异归类为上游行为、适配取舍或框架缺陷。

基础浏览器验收覆盖首页图表可见、Users 名称过滤/清空/排序/分页/行选择、Products 与 Blog 的真实可操作控件、Sign in 原有跳转和404。每页直接访问、刷新和客户端导航都要通过；布局、主题和滚动行为不能因 Provider 位置变化失效。桌面和窄视口都检查截图、资源失败和控制台错误。

开发验证在用户筛选或选中状态下修改普通页面组件，检查 Fast Refresh；结构路由修改则按框架约定整页刷新。修改 Node 配置、制造语法错误、修复配置后核对 worker 代际及端口清理。产物验证包含 /admin/ 深链接、连续 build、失败构建保留旧产物、preview 不依赖重新生成源文件。

追加接口验证时，将原本本地数据的一个明确功能接入可选开发 API 插件，覆盖 loading/error/empty/success 与取消；这属于新增适配测试。不能把 Mock 返回成功叫作真实后端鉴权，也不将生产 preview 暗中变成 Mock server。

## 5. 完成标准与报告

只有六页与选定交互在真实浏览器通过、应用 typecheck 通过、生产构建与子路径预览通过、原版权保留、安装链接独立后，才将“Admin 模板迁移”标为完成。最终报告应有上游固定 SHA、改动文件清单、不能保留的能力及原因、发现并修复的框架缺陷，以及运行命令。

这一步不要求先公开 npm、不要求改造整个 Umi 生态、不要求 Windows；只证明该固定上游快照在当前验证环境的可用性。不要用上游 README、待执行测试代码或漂亮截图代替实际迁移与交互测试。
