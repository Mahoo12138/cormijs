# cormi Umi 吸收路线完成度审计（2026-10-21，更新 2026-10-22）

本文件按 [Umi 功能路线](59-umi-feature-roadmap.md) 与当前工作区、测试产物逐项核对，回答“路线目标是否已经完成”。结论是**未完成**：U32/U33 的 SSR、预渲染、serverLoader 与流式核心已交付，U09/U16 的模型与 locale 能力大幅补齐，U12 请求能力已交付，U17 已交付可选 Antd Provider、ProLayout 外壳与菜单图标注册表；仍有 F6 微前端与 dva/valtio 适配、U17 服务端图表/自定义 SettingDrawer 文案、U33 sitemap lastmod/压缩、SSR 生产化等明确缺口。

## 1. 目标重述

按 docs/59 的实施顺序吸收 Umi 4/Max 的应用能力，每个切片具备：可替换的原生 Cordis 插件/契约、应用使用方式、测试（单元/浏览器/安装包）、文档与机器证据，并只在完整验证后本地提交；不推送、不发布。

## 2. 交付清单（按切片）

| 能力组 | 切片 | 文档 |
| --- | --- | --- |
| 运行时/路由/布局 | F1a–F1f、F5a–F5b、F5u–F5v | docs/60–65、83、103–104 |
| 数据/请求/权限/菜单/locale | F2a–F2c、F3a–F3e、F5f、F5l–F5m、F5o、U09-1–4、U12-1–12、U16-1/U16-2 | docs/66–73、89、94–95、97、111、116–119、121、125、127、129–130、133、136、138–141、120、124 |
| HTML/Mock/别名/define/样式/生成器 | F4a–F4m、F5r、F5w | docs/74–82、86–87、90–91、100、105、110 |
| 加载/导出/分析/工具 | F5c–F5p、F5e、F5h–F5j、F5z | docs/84–85、88、90–93、98、108 |
| SSR/MPA/API 路由 | F5n、F5q、F5y、F5z、U32-1/U32-2、U33-1–5 | docs/96、99、107–108、113–115、123、128、131 |
| UI 适配器 | U17 菜单适配、U17-1 Antd Provider、U17-2 ProLayout 外壳、U17-3 菜单图标 | docs/109、126、134、135 |

“已交付”指对应能力已实现并通过该切片的验证；不代表 Umi 同名能力的全部形态。路线图各行保留“部分已有/待实现”的准确边界。

## 3. 最近冻结验证

- `pnpm check`：**572/572**
- `pnpm test:browser`：**56/56**
- `pnpm test:package`：**359 阶段**
- 最新证据：[U17-7 ProLayout locale](../artifacts/u17-7-prolayout-locale-validation.json)、[U17-6 图表 SSR](../artifacts/u17-6-chart-ssr-validation.json)、[F6-1 React Query](../artifacts/f6-react-query-validation.json)、[U17-5 图表集成](../artifacts/u17-5-charts-validation.json)、[U17-4 主题编辑器](../artifacts/u17-4-theme-editor-validation.json)、[U12-12 跨标签页缓存](../artifacts/u12-12-cross-tab-cache-validation.json)、[U12-11 防抖边沿](../artifacts/u12-11-debounce-edges-validation.json)、[U12-10 防抖 maxWait](../artifacts/u12-10-debounce-maxwait-validation.json)、[U12-9 缓存持久化](../artifacts/u12-9-cache-persistence-validation.json)、[U33-7 sitemap index](../artifacts/u33-7-sitemap-index-validation.json)、[U12-8 尾调用节流](../artifacts/u12-8-trailing-throttle-validation.json)、[U17-3 菜单图标](../artifacts/u17-3-menu-icons-validation.json)、[U17-2 ProLayout](../artifacts/u17-2-pro-layout-validation.json)、[U12-7 游标分页](../artifacts/u12-7-cursor-pagination-validation.json)、[U33-6 并发预渲染](../artifacts/u33-6-prerender-concurrency-validation.json)、[U33-5 robots](../artifacts/u33-5-robots-validation.json)、[U12-6 节流](../artifacts/u12-6-throttle-validation.json)、[U09-4 选择器等值](../artifacts/u09-4-selector-equality-validation.json)、[U17-1 Antd](../artifacts/u17-antd-validation.json)、[U32-2 流式 SSR](../artifacts/u32-streaming-validation.json)、[U33-4 预渲染控制](../artifacts/u33-4-prerender-control-validation.json)、[U16-2 RTL](../artifacts/u16-2-rtl-validation.json)。
- 工作区：本轮验证完成后以特性提交 + 文档索引提交交付；最新特性提交为 97bc489（U17 ProLayout 内置文案 locale），工作树干净，未推送。

## 4. 未完成要求（阻断完成判定）

| 路线项 | 缺口 | 当前状态 |
| --- | --- | --- |
| U32 | `serverLoader` 与流式 SSR 已交付；压缩/TLS/背压/代理缓冲与流中错误恢复未实现 | 部分完成 |
| U33 | 字面路由与 `prerenderPaths` 预渲染、sitemap/分片索引、单页容错/关闭、增量写入、robots.txt、并发预渲染已交付；sitemap lastmod/压缩/按语言拆分未实现 | 部分完成 |
| U09 | Hook/对象模型、reducers/effects/subscriptions、extraModels、依赖排序、选择器 isEqual 已交付；热替换保留 store 未实现 | 部分完成 |
| U17 | 可选 `@cormijs/plugin-antd`（locale/direction/theme）、`ProLayoutShell`（菜单/导航/折叠持久化/主题编辑器/内置文案 locale）、菜单图标注册表、应用侧图表库与 `ClientOnly` SSR 边界已交付；自定义 SettingDrawer 文案、服务端图表内容未实现 | 部分完成 |
| U16 | UI locale 归一化/回退链/资源解析与 RTL direction 已交付；按请求 locale、RTL 样式/组件封装未实现 | 部分完成 |
| F6 | React Query 适配已交付（F6-1）；qiankun/Module Federation、dva/valtio 适配、多 builder、MFSU 等未实现 | 部分完成 |
| U25 | externals；runtimePublicPath 已确认 Vite chunk 导入无法等价实现 | 未交付 |
| U23/U24/U29 | Tailwind/UnoCSS 与 API 类型工作流未实现；U24 已交付 `meta.icon` + 图标注册表适配，自动发现/资源管线/代码生成未实现 | 部分完成 |

此外：SSR 的 hydration 需等待当前匹配 chunk；`cormi serve` 无压缩/缓存/TLS；MPA 无 App/Provider 包装与热更新；U22 类名类型仍为字符串索引；预渲染并发受共享工作池约束且只比较最终 HTML；ProLayout 7.22.7 的 antd peer 声明仍停留在 4/5。这些均在对应文档的“限制”中记录，不能视为已完成。

## 5. 完成判定

路线目标要求的是 Umi 应用能力清单的持续吸收，而不是“当前测试全绿”。当前仍有上表的多项应用能力与生态集成缺失，因此：

- **不得**将本目标标记为 complete；
- 下一优先级建议：F6 微前端/dva/valtio 适配，或 U17 服务端图表内容；其后补 U33 sitemap lastmod/压缩、U16 请求 locale 与 SSR 生产化；
- 任何新切片仍需完整的 `pnpm check`、`pnpm test:browser`、`pnpm test:package` 与证据文件后才能提交。

## 6. 审计方法

- 以 docs/59 表格与已交付索引为清单，逐项对照源码导出、测试文件、文档“限制”章节和 artifacts；
- 复查最新冻结产物的计数与工作树状态；
- 2026-10-22 更新：刷新计数/证据/交付索引，移除重复 U33 行；不新增功能，不重跑测试。
