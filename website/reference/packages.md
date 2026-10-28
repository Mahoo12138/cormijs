# 包列表

当前所有包都是 private，版本 `0.0.1`，未发布到公共 npm。包名使用 `@cormijs/*` 命名空间，分发名 `cormijs`；CLI 命令是 `cormi`。

## 内核与协议

| 包 | 职责 |
| --- | --- |
| `@cormijs/core` | Cordis 宿主、就绪屏障、诊断、命令协议、运行时插件描述 |
| `@cormijs/builder` | 后端无关的构建、会话、开发失效契约 |
| `@cormijs/routes` | 路由 IR、约定扫描、配置展开与冲突校验 |
| `@cormijs/plugin-web` | Web consumer、应用命令、OrderedHooks、生成队列、受管发布 |
| `cormijs` | CLI、配置、preset、锁、worker、launcher |
| `create-cormi` | `create:app` 本地创建器 |
| `@cormijs/schemastery` | 内部 schema 实现；应用通常不需要直接依赖 |

`core` 不导入 React 或 Vite。物理独立消费者测试验证没有 Vite 仍可运行；React compiler 也可以在没有 builder 的宿主中准备入口。

## React 与构建

| 包 | 职责 |
| --- | --- |
| `@cormijs/plugin-react` | React 编译服务、路由/运行时贡献、model/request/locale/access/menu 等原生插件 |
| `@cormijs/plugin-react-vite` | React 与 Vite 的唯一桥接：客户端边界、HTML、alias、define、API、SSR、MPA、serve |
| `@cormijs/plugin-vite` | Vite builder provider |
| `@cormijs/plugin-typescript` | 可选 `typecheck` 命令与 TypeScript 服务；TypeScript 按需加载 |
| `@cormijs/preset-react-vite` | 可审阅、可替换的默认组合 |

默认组合：

```text
application-config
web
application-commands
react
vite
react-vite
inspect
typescript
```

Vite 仍是唯一真实构建后端。可替换测试 provider 不表示其他构建器的原生插件自动兼容。

## 运行时

| 包 | 职责 |
| --- | --- |
| `@cormijs/runtime` | 浏览器 React/Router 生命周期、Provider、Hook；无 Node 构建逻辑 |

子路径：

- `@cormijs/runtime`：应用 Hook 与 Router 再导出。
- `@cormijs/runtime/server`：SSR 渲染与 serverLoader。
- `@cormijs/runtime/microfrontend`：qiankun 生命周期。

## 开发服务

| 包 | 职责 |
| --- | --- |
| `@cormijs/plugin-dev-api` | 可选 Node Mock/HTTP 代理；`/vite` 提供专属桥接 |

Mock 只在开发期存在；生产预览不提供。代理在开发与预览都生效，但构建产物不包含代理。

## 可选集成

| 包 | 需要额外安装 | 职责 |
| --- | --- | --- |
| `@cormijs/plugin-antd` | `antd`、可选 `@ant-design/pro-layout` | ConfigProvider、ProLayoutShell |
| `@cormijs/plugin-react-query` | `@tanstack/react-query` | QueryClientProvider 与默认项 |
| `@cormijs/valtio` | 无（自带 valtio） | valtio API 再导出 |
| `@cormijs/dva` | 无（依赖 dva-core） | 显式 dva runtime、hooks 与 connect |
| `@cormijs/plugin-dva` | `@cormijs/dva` | 自动发现 `src/models`、immer、loading |
| `@cormijs/plugin-qiankun` | `qiankun`（宿主） | UMD 子应用入口、QiankunMicroApp、宿主路由 |
| `@cormijs/plugin-federation` | 无（依赖 MF runtime） | remoteEntry、共享依赖、远程路由合并、运行时清单 |

这些包不进入默认 preset。卸载插件后，它们贡献的运行时、路由和菜单会撤回；已经写入构建产物的文件按下一次构建更新。

## 依赖关系

```text
preset-react-vite
├─ plugin-web ── core / builder / routes
├─ plugin-vite ── core / builder
├─ plugin-react ── plugin-web / routes / runtime
├─ plugin-react-vite ── plugin-react / plugin-vite / runtime
└─ plugin-typescript ── core / plugin-web

cormijs ── core / schemastery / cordis
runtime ── react / react-dom / react-router（peer）
```

可选集成只依赖它们需要的运行时和构建服务，不修改 core 或 launcher 的通用路径。

## 版本基线

| 对象 | 本机验证基线 |
| --- | --- |
| Node.js | 22.14.0 |
| pnpm | 10.6.3 |
| Cordis | 4.0.0-rc.11 |
| Vite / React Vite plugin | 7.3.2 / 5.1.4 |
| React / React DOM / React Router | 19.3.1 / 19.3.1 / 7.18.2 |
| TypeScript / tsx / esbuild | 5.9.3 / 4.23.15 / 0.28.2 |
| playwright-core / Edge | 1.58.2 / 155.0.4283.62 |

直接依赖固定版本，间接依赖由 `pnpm-lock.yaml` 锁定。以上不表示最新版本，也不表示公共分发已经解决 Cordis 声明补丁问题。

下一步：[插件总览](/plugins/)。
