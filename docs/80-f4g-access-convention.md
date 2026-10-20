# cormi F4g：`src/access.ts` 权限约定

日期：2026-10-20。本切片补齐 U14 的最后一项约定：显式启用 `accessPlugin` 后，可用项目内的 `src/access.ts`（默认候选 `src/access.ts`、`src/access.tsx`）默认导出的权限函数提供 access key，而不必写在 `src/app.tsx` 里。`app.tsx` 中显式声明的 `access` 仍然优先。路由级 `access` 守卫、自定义 403 与菜单过滤沿用 F3d/F3e 的既有实现。

## 1. 使用方式

```ts
// src/app.tsx —— 只提供初始状态
import { defineApp } from '@cormijs/runtime';
export default defineApp({ async getInitialState() { return { role: 'admin' }; } });
```

```ts
// src/access.ts —— 约定文件，默认导出接收初始状态并返回布尔映射
export default function access(state: unknown) {
  const user = state as { role?: string } | undefined;
  return { canAdmin: user?.role === 'admin', canRead: user !== undefined };
}
```

```ts
// cormi.config.ts
import { accessPlugin, appRuntimePlugin, initialStatePlugin } from '@cormijs/plugin-react';

plugins: [
  { id: 'app-runtime', plugin: appRuntimePlugin },
  { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
  { id: 'access', plugin: accessPlugin, options: { id: 'application:access' } },
]
```

可用 `options.files` 覆盖候选列表。示例：`pnpm cormi dev --root examples/access-convention`。

## 2. 契约与语义

- 提供者：`cormi:access` 插件新增对 `ctx.react.access` OrderedHooks 的贡献（与 `styles`/`loading` 同一套原生 hook 机制），`inject` 仍为 `['react']`；
- Node 侧解析：`resolveAccessPlan(root, contributions)` 对每个贡献取第一个存在的候选文件，缺失即不启用；出现两个可用模块抛 `ACCESS_CONFLICT`；符号链接、非普通文件、逃逸路径与 `*.server.*` 由既有 `clientSpecifier` 边界拒绝；
- 生成：入口追加 `import * as accessConvention from "../src/access.ts";`，并把 `appConfig` 包成 `applyAccessConvention(resolveAppConfig(applicationConfig, [...keys]), accessConvention.default)`；没有 `src/app.tsx` 时以 `resolveAppConfig({}, [])` 作为基底；
- 运行时：`@cormijs/runtime` 导出 `applyAccessConvention(config, factory)`，仅在 `config.access === undefined` 时写入约定函数，否则原样返回；非函数默认导出以 `ACCESS_INVALID` 失败，映射仍由 `AccessProvider` 求值并冻结；
- 开发循环：候选文件进入 `repairSignature` 观测集，新建或删除 `src/access.ts` 会触发生成与 `summary.access` 更新；
- 观测：`.cormi/inspect.jsonc` 的 `summary.access` 记录 `{ owner, module }`，未启用或无文件时为 `null`；hooks 快照含 `access-hook` 条目；
- 退出：卸载插件后 hook 贡献与生成导入同时撤回，`summary.access` 回到 `null`。

## 3. 与 Umi 4 的差异

Umi 的 access 插件位于 `packages/plugins/src/access.ts`，以 `enableBy: EnableBy.config` 随配置启用，并在 `:17-20` 检查 `src/access.{js,jsx,ts,tsx}`（缺失时仍可只用运行时配置）；权限值与 `@@initialState` 模型绑定。cormi 保持“功能必须显式启用”的既有取向：约定文件发现由已启用的 `accessPlugin` 通过 `ctx.react.access` hook 贡献，而不是 core 默认行为。

| 方面 | Umi 4 | cormi F4g |
| --- | --- | --- |
| 启用 | 配置出现即启用（EnableBy.config） | 显式声明 accessPlugin 实例 |
| 约定 | `src/access.{js,jsx,ts,tsx}` 固定顺序 | 默认 `src/access.{ts,tsx}`，候选可配置 |
| 与 runtime 配置冲突 | 只有一处来源 | `app.tsx` 的 `access` 优先于约定文件 |
| 依赖 | 绑定 `@@initialState` 模型 | 绑定 `initialStatePlugin` 上下文 |

不承诺 Umi 的 `useAccess`/`Access` 之外的服务端授权语义；按钮隐藏与路由阻止仍分别验证，权限判定最终由后端实施。

## 4. 限制

- 约定文件必须是同步默认导出的工厂函数；异步准备属于 `getInitialState`；
- 不做 access key 的类型生成：`useAccess()` 仍返回 `Record<string, boolean>`，需要更严格类型时应用自行声明；
- 不实现权限层级、通配 key 或后端权限同步；
- 与 `initialStatePlugin` 组合使用，单独启用时 access 映射基于 `undefined` 初始状态求值；
- `accessForbidden` 自定义 403 仍来自 `app.tsx` 配置，不进入约定文件。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。首轮 `pnpm check` 有 4 项失败，原因是此前被中止的浏览器验证链遗留的测试进程仍占用 5173 端口（`Port 5173 is already in use`），并非产品缺陷；清理本轮自有临时进程与 TMPDIR 中本仓库脚手架后，独立包验证又因磁盘写满报 `ERR_PNPM_ENOSPC`，释放空间后以下整套在冻结源码上重跑并通过。

| 检查 | 结果 |
| --- | --- |
| `tests/access-convention.test.ts`（贡献校验、发现与冲突、生成合并、配置优先、撤回） | 4/4 |
| `tests/browser/access-convention.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 489/489，0 失败/取消/跳过（F4f 为 485，新增 4 项；约 106 秒） |
| `pnpm test:browser` | 39/39，0 失败/取消/跳过（F4f 为 38，新增 1 项；约 411 秒） |
| `pnpm test:package` | 229 阶段通过（F4f 为 221，新增 8 个 access-convention 阶段） |
| `examples/access-convention` prepare + typecheck | 退出 0 |

浏览器与独立包消费验收断言：权限映射确实来自 `src/access.ts`（`data-source` 标记 + 管理面板可见）、`setInitialState` 降级后 `canAdmin` 变为 false 并渲染 fallback、恢复后管理面板重新出现、`useAccess` 的 `canRead` 为 true、开发与控制台无错误、无开发覆盖层；类型检查覆盖 `applyAccessConvention` 与 `accessConvention.default` 的真实调用形状。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4g-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- F3 剩余：菜单折叠 helper 与 ProLayout/Antd UI adapter（U15/U17）；F4h 已交付消息目录约定，见 [F4h 消息目录](81-f4h-locale-catalogs.md)；
- F4 后续：微生成器（U27）、工程命令（U28）、输出与资源策略（U25）；
- F5：client loader 与预取（U13/U31）、SSR（U32）、静态导出（U33）、MPA（U34）、生产 API 路由（U35）。
