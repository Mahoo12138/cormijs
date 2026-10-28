# 路线与状态

截至 2026-10-28，cormi 仍处于早期开发阶段。本页只描述仓库当前可验证的范围，不把计划写成已发布。

## 当前可用

| 领域 | 状态 |
| --- | --- |
| React SPA 开发、构建、预览 | 可用 |
| 约定式与配置式路由、布局、404/loading、loader、预取 | 可用 |
| `src/app.tsx` 运行时、model、初始状态、请求 | 可用 |
| locale、ICU、access、菜单、head、分析 | 可用 |
| Mock、API 路由、代理、别名、define、生成器 | 可用 |
| 静态导出、预渲染、sitemap、SSR、MPA、serve | 首个完整切片 |
| qiankun、Module Federation | 可选集成，部分能力 |
| Antd、ProLayout、React Query、valtio、dva | 可选集成 |
| 公共 npm 发布 | 未完成 |
| Windows 原生验收 | 挂起 |

“可用”不等于 Umi 的所有配置项、所有浏览器或所有平台都与上游一致。精确范围见各能力页面。

## 已交付的 Umi 能力组

路线以 Umi 4 / Max 的功能清单为主线，按切片交付：

- **F1**：应用运行时、配置式路由、redirect/wrappers、全局布局、404/loading、history。
- **F2**：model/useModel、对象模型、初始状态、请求与 useRequest。
- **F3**：locale、access、菜单/面包屑、路由守卫、自定义 403。
- **F4**：HTML head、Mock、别名、define、全局样式、access 约定、消息目录、菜单折叠。
- **F5**：clientLoader、路由 head、预取、静态导出、格式化、分析、工具命令、API 路由、MPA、SSR、serve。
- **F6**：React Query、valtio、dva、qiankun、Module Federation。

逐项完成度、与 Umi 的差异和验证记录保存在仓库的 `docs/59-umi-feature-roadmap.md`、`docs/112-roadmap-audit-2026-10-21.md` 和 `artifacts/` 中，不在本站重复全部内部记录。

## 明确的差距

### 应用功能

- SSR 只覆盖首个切片，未生产化：没有压缩、TLS、背压、代理缓冲与完整流中错误恢复。
- 按请求 locale、RTL 样式封装、按语言拆分尚未完成。
- 路由级 layout 插槽、导航期 Suspense loading 未完成。
- 模型热替换保留 store、`@@initialState` 模型集成未完成。
- Module Federation 只做客户端路由合并，SSR 远端路由不支持。
- qiankun 未实现全局 `registerMicroApps` / 函数式 activeRule。

### 工程与生态

- 只有 Vite 是真实构建后端；MFSU、externals、runtimePublicPath 等价能力未交付。
- PostCSS/Tailwind/SVGR、官方变换插件面未移植。
- 交互式生成器、文件发现、precommit/deadcode 等命令未完成。
- 公开插件生态、Umi 插件兼容、Admin 以外的真实应用迁移仍有限。

### 分发与平台

- 包保持 private，未发布到公共 npm。
- Cordis RC.11 声明补丁仍需要消费者根显式配置，透明公共安装方案未定。
- 项目许可、包名归属与公开分发策略待确认。
- Windows 原生工作自 2026-10-18 起挂起。
- Linux 只验证过记录的 Debian 12 / arm64 容器组合，不代表所有发行版。
- 未验证 Firefox/Safari、真机移动浏览器、长期无泄漏或断电持久性。

## 下一优先级

2026-10-20 的路线调整仍然有效：**优先吸收 Umi 应用功能，暂停构建中断恢复等外围深化。**

下一步的候选顺序：

1. 继续补齐高频应用能力（U09 热替换、U16 请求 locale/RTL、U33 语言拆分）。
2. SSR 与预渲染生产化，而不是增加新的渲染模式。
3. 真实应用迁移与反馈，而不是继续抽象启动层。
4. 公共分发前置条件：许可、包归属、Cordis 补丁、跨平台验收。

不会因为完成一个切片就自动转回锁恢复、诊断扩张或通用 bootstrap 重构。

## 发布门槛

在任何“1.0”或公开发布声明之前，至少需要：

- 确认项目许可与每个包的发布归属。
- 解决 Cordis 声明补丁的透明安装。
- 完成目标平台的类型、Node、浏览器和独立包消费验收。
- 真实应用持续使用，而不只是仓库示例。
- 明确 SSR、微前端、MPA 的生产边界与运维责任。
- 不把有限资源采样、单次构建或首页 smoke 当作长期稳定性证明。

## Admin 的定位

仓库中的 Admin 迁移是框架验收负载，不是 cormi 的产品界面，也不扩展其 UI、CRUD、鉴权或商业功能。它用来暴露真实页面、布局、图表和交互中的框架缺口。

## 文档与证据

- 应用使用方式：[应用开发指南](/guide/)。
- 设计边界：[设计原则](/about/design)。
- 与 Umi 的关系：[与 Umi 的关系](/about/umi)。
- 仓库内部路线与审计：`docs/59-umi-feature-roadmap.md`、`docs/112-roadmap-audit-2026-10-21.md`。
- 机器证据：`artifacts/*.json`。

本地验证通过不等于公开发布，也不等于跨平台或长期运行保证。
