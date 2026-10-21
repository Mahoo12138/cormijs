# cormi Umi 吸收路线完成度审计（2026-10-21）

本文件按 [Umi 功能路线](59-umi-feature-roadmap.md) 与当前工作区、测试产物逐项核对，回答“路线目标是否已经完成”。结论是**未完成**：仍有 U32 的 serverLoader/流式渲染、U17 官方 UI 集成、U16 dayjs/Antd 映射、F6 等明确缺口。

## 1. 目标重述

按 docs/59 的实施顺序吸收 Umi 4/Max 的应用能力，每个切片具备：可替换的原生 Cordis 插件/契约、应用使用方式、测试（单元/浏览器/安装包）、文档与机器证据，并只在完整验证后本地提交；不推送、不发布。

## 2. 交付清单（按切片）

| 能力组 | 切片 | 文档 |
| --- | --- | --- |
| 运行时/路由/布局 | F1a–F1f、F5a–F5b、F5u–F5v | docs/60–65、83、103–104 |
| 数据/请求/权限/菜单/locale | F2a–F2c、F3a–F3e、F5f、F5l–F5m、F5o、U16-1 | docs/66–73、89、94–95、97、111 |
| HTML/Mock/别名/define/样式/生成器 | F4a–F4m、F5r、F5w | docs/74–82、86–87、90–91、100、105、110 |
| 加载/导出/分析/工具 | F5c–F5p、F5e、F5h–F5j、F5z | docs/84–85、88、90–93、98、108 |
| SSR/MPA/API 路由 | F5n、F5q、F5y、F5z | docs/96、99、107–108 |
| UI 适配器 | U17-1 | docs/109 |

“已交付”指对应能力已实现并通过该切片的验证；不代表 Umi 同名能力的全部形态。路线图各行保留“部分已有/待实现”的准确边界。

## 3. 最近冻结验证

- `pnpm check`：**549/549**
- `pnpm test:browser`：**52/52**
- `pnpm test:package`：**328 阶段**
- 最新证据：[404.html 导出](../artifacts/f5e-404-validation.json)、[F4m 样式类型](../artifacts/f4m-style-types-validation.json)、[U16 locale 订阅](../artifacts/u16-locale-subscription-validation.json)、[U17 菜单适配器](../artifacts/u17-menu-adapters-validation.json)、[SSR head](../artifacts/f5y-ssr-head-validation.json)、[SSR 拆包](../artifacts/f5y-ssr-splitting-validation.json)、[MPA 模板](../artifacts/f5q-mpa-template-validation.json)。
- 工作区：上述验证后在 `main` 上以特性提交 + 文档索引提交交付；最新特性提交为 0db7289（404.html 导出），工作树干净，未推送。

## 4. 未完成要求（阻断完成判定）

| 路线项 | 缺口 | 当前状态 |
| --- | --- | --- |
| U32 | `serverLoader`、流式 SSR；当前仅 clientLoader + static handler + 缓冲/字符串注入 | 未实现 |
| U17 | 官方 Antd/ProLayout 集成包、主题/图标/图表与 locale 联动 | 仅结构适配器 |
| U16 | dayjs/Antd 官方 locale 映射与适配包 | 仅订阅/事件机制 |
| F6 | qiankun/Module Federation、dva/valtio/react-query 适配、多 builder、MFSU 等 | 未实现 |
| U25 | externals；runtimePublicPath 已确认 Vite chunk 导入无法等价实现 | 未交付 |
| U23/U24/U29 | Tailwind/UnoCSS、icons、API 类型工作流 | 未实现 |
| U33 | 预渲染、404.html、sitemap、与 SSR 组合 | 静态外壳 + 可选 404.html；预渲染/sitemap/SSR 组合未实现 |

此外：SSR 的 hydration 需等待当前匹配 chunk；`cormi serve` 无压缩/缓存/TLS/流式；MPA 无 App/Provider 包装与热更新；U22 类名类型仍为字符串索引。这些均在对应文档的“限制”中记录，不能视为已完成。

## 5. 完成判定

路线目标要求的是 Umi 应用能力清单的持续吸收，而不是“当前测试全绿”。当前仍有上表的多项应用能力与生态集成缺失，因此：

- **不得**将本目标标记为 complete；
- 下一优先级建议：U32 `serverLoader`（先定义服务端数据契约与 hydration 对齐），随后流式 SSR；之后 F6 Module Federation/qiankun 或 U17 可选 Antd 集成包；
- 任何新切片仍需完整的 `pnpm check`、`pnpm test:browser`、`pnpm test:package` 与证据文件后才能提交。

## 6. 审计方法

- 以 docs/59 表格与已交付索引为清单，逐项对照源码导出、测试文件、文档“限制”章节和 artifacts；
- 复查最新冻结产物的计数与工作树状态；
- 本次审计仅修正文档中的重复/过时记录，不新增功能，不重跑测试。
