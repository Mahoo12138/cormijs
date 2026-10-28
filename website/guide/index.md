# 介绍

cormi 是一个以 [Cordis](https://cordis.moe) 为插件宿主、以 React + Vite 为默认应用体验的 TypeScript 框架。它参考 Umi 4 / Max 的应用开发方式，但内核不绑定 React、Vite 或任何具体渲染器。

一句话概括：**应用能力由插件组合出来，开发体验由约定补齐。**

```text
cormi
├─ Cordis           Context / Service / Fiber / inject / effect
├─ core            宿主、就绪屏障、诊断、命令协议
├─ plugin-web      应用命令、生成队列、构建契约
├─ plugin-vite     Vite provider
├─ plugin-react    React 编译服务与运行时贡献
└─ preset          可审阅的默认组合（React + Vite）
```

## 为什么是 cormi

### 插件是事实，不是目录名

产品能力通过原生 `ctx.plugin()`、`inject`、`ctx.effect()` 组合。插件卸载时，它贡献的路由、运行时 Provider、菜单项和生成内容会一起撤回；不是“放在 plugin 目录里所以叫插件”。

### 约定可以显式关闭

`src/pages`、`src/models`、`src/locales` 这些约定都存在，但模型、请求、国际化、权限、菜单等能力需要你在 `cormi.config.ts` 中显式挂载对应插件。默认 preset 不会静默接管已有的 `src/app.tsx`，避免把普通组件误解释为配置。

### 不隐藏构建器，也不假装热更新

组件修改走 Vite Fast Refresh；配置和 Node 插件变更会重启 worker。构建先写 staging，失败保留上一份成功产物；受管输出有归属检查，不会清空未知目录。这些边界是本项目的一部分，不是待填的营销空白。

### 面向真实应用交付

从 SPA、静态导出、预渲染、SSR、MPA 到 qiankun / Module Federation，每种形态都按需启用。框架本身不提供 UI 组件库、图表库或业务后端，只保留可替换的组合点。

## 当前状态

cormi 仍处于早期阶段，**没有发布到公共 npm**。仓库内的示例、本地 kit 和创建器是当前可用的使用方式。

| 项目 | 状态 |
| --- | --- |
| React SPA 开发 / 构建 / 预览 | 已实现 |
| 约定式与配置式路由、布局、loader | 已实现 |
| model、初始状态、请求、locale、access、菜单 | 已实现 |
| Mock、API 路由、代理、别名、define、生成器 | 已实现 |
| 静态导出、预渲染、SSR、MPA、serve | 已实现（首个切片） |
| qiankun、Module Federation | 已实现（可选集成） |
| 公共 npm 发布、Windows 原生验收 | 尚未完成 |

完整的能力清单、限制和后续顺序见[路线与状态](/about/roadmap)。

## 适合谁

- 想用 Cordis 的插件模型组织前端应用，但不想自己搭一套路由、请求、国际化和构建链路。
- 熟悉 Umi 的 `src/app.tsx`、`src/pages`、`useModel`、`useRequest`、`access` 等使用方式，希望这些能力由更小的可替换插件承担。
- 需要在同一个框架里逐步尝试静态导出、SSR、MPA 或微前端，而不是换一套脚手架。

## 接下来

快速开始：[跑起仓库示例，或从本地 kit 创建一个新应用](/guide/getting-started)。

项目结构：[了解配置、约定、生成目录和源码边界](/guide/project-structure)。

设计原则：[为什么 core 不包含 React/Vite，插件撤回意味着什么](/about/design)。
