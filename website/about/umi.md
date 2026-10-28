# 与 Umi 的关系

cormi 参考 Umi 4 / Max 的**应用开发体验**，但不复用其插件后端、运行时补丁或路由数据格式。它不是 Umi 的 fork，也不承诺 Umi 插件二进制兼容。

## 吸收了什么

| 使用方式 | cormi 对应 |
| --- | --- |
| `src/app.tsx` 运行时配置 | `defineApp` + `appRuntimePlugin` |
| `src/pages` 约定、`_layout`、动态路由 | 路由扫描与 React Router Data Mode |
| 配置式 `routes`、`layout`、`wrappers` | `routeConfigPlugin` |
| `model` / `useModel` | `modelPlugin`、Hook 模型与对象模型 |
| `getInitialState` | `initialStatePlugin` + `useInitialState` |
| `useRequest` | `requestPlugin` + `useRequest` |
| `access` / `Access` | `accessPlugin` + 路由守卫 |
| locale / 消息目录 | `localePlugin` + ICU 子集 |
| 菜单、面包屑、布局 | `menuPlugin`、`layoutPlugin`、ProLayout 适配 |
| Mock、代理、别名、define、生成器 | 对应的可选插件 |
| 静态导出、SSR、MPA、API 路由 | `plugin-react-vite` 的独立能力 |
| qiankun / Module Federation | 独立可选集成 |

这些能力以 cormi 自己的契约实现，使用原生 Cordis 插件组合；不是复制 Umi 内部源码。

## 刻意不同

### 插件模型

Umi 使用自身的 service/plugin 体系；cormi 使用 Cordis 的 Context、Service、Fiber、`inject` 和 `effect`。这意味着：

- 不能直接安装 Umi 插件。
- 不能假设 `api.register()`、Umi 配置 schema 或插件生命周期存在。
- 能力由插件的 `inject` 与贡献决定，不由 preset 名称隐式决定。

### 约定默认显式

Umi 的很多能力由 preset 默认开启；cormi 的模型、请求、locale、access、菜单等需要显式挂载。默认 preset 只提供 React SPA 的工程链路。

### 构建后端

cormi 的 Vite 支持是 `plugin-vite` 提供的唯一真实后端，通过 builder 契约与 React 编译器解耦。它没有 Umi 的 webpack 兼容层、MFSU 或完整插件适配层。

### 运行时

- 路由使用 React Router Data Mode，不叠加 Framework Mode。
- 组件更新是 Vite Fast Refresh；Node 配置和插件变更重启 worker。
- 没有 Umi 的全局运行时容器或隐式插件注册表。
- SSR、MPA、微前端是独立能力，不默认开启。

### 生态

- 不提供 Umi 插件市场兼容。
- 不承诺 Ant Design Pro 全量模板迁移；Admin 只作为框架验收负载。
- 图表、状态库、UI 库由应用组合，框架不内置。

## 当前差距

与 Umi 4 / Max 的完整功能清单相比，cormi 仍有差距：

- SSR 只覆盖首个切片，未生产化。
- 没有 Umi 的全量插件生态与 MFSU。
- 没有按请求 locale、完整 RSC 或所有第三方库的 SSR 适配。
- Windows 原生验收挂起。
- 公共 npm 发布、许可与 Cordis 补丁分发尚未完成。
- 没有 Umi 的交互式生成器、全局微前端注册循环或完整权限生态。

这些差距见[路线与状态](/about/roadmap)，不把计划写成已实现。

## 为什么不用 Umi 本身

如果你需要成熟的 Umi 生态、Ant Design Pro 全量模板或现成插件市场，Umi 仍是更直接的选择。

cormi 适合的场景是：

- 想用 Cordis 组织前端能力，同时保留熟悉的路由与约定。
- 需要按能力替换构建、路由、请求或状态插件。
- 接受显式配置和早期框架边界。
- 愿意参与验证真实应用，而不是只消费现成生态。

## 验证负载

仓库中的 Admin 迁移是**框架验收负载**，不是 cormi 的产品界面，也不扩展其 CRUD、鉴权或商业功能。它用于暴露真实页面、布局、图表和交互中的框架缺口。

下一步：[路线与状态](/about/roadmap)。
