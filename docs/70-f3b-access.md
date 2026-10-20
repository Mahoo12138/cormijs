# cormi F3b：access 与 useAccess

日期：2026-10-20。本切片交付 F3 的权限基础：显式启用的 `accessPlugin` 在 app 配置中登记 `access` 函数，Provider 从初始状态数据计算布尔权限表；页面可通过 `useAccess` 读取，或用 `<Access accessible>` 控制 UI。`src/access.ts` 自动发现、路由级 access 守卫和服务端授权尚未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { accessPlugin, appRuntimePlugin, initialStatePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
    { id: 'access', plugin: accessPlugin, options: { id: 'application:access' } },
  ],
  app: { base: '/access/' },
});
```

```tsx
// src/app.tsx
import { defineApp } from '@cormijs/runtime';

export default defineApp({
  async getInitialState() {
    return { role: 'admin' };
  },
  access(state) {
    const user = state as { role?: string } | undefined;
    return { canAdmin: user?.role === 'admin', canRead: user !== undefined };
  },
});
```

```tsx
import { Access, useAccess } from '@cormijs/runtime';

const access = useAccess();
<Access accessible={access.canAdmin} fallback={<p>没有权限</p>}>
  <AdminPanel />
</Access>
```

`accessPlugin` 是普通原生 Cordis 插件：`inject: ['react']`，登记 `access` app-config key 和 runtime Provider，均随 `ctx.effect` 撤回。

## 2. 依赖与顺序

Access Provider 读取 `initialState` 上下文，因此：

- 必须同时启用 `initialStatePlugin`（或等价的初始状态 Provider）；
- access 的 runtime 贡献使用 stage 10，initial-state 使用默认 stage，确保 AccessProvider 位于 InitialStateProvider 内层；
- 未启用 initial-state 时 `useAccess` 会以明确错误失败，不会静默给出空权限；
- `getInitialState` 尚未完成时 `data` 为 undefined，access 函数会先以 undefined 计算；数据到达后自动重新计算。

## 3. 语义

1. `access(initialState.data)` 返回 `Record<string, boolean>`；键和值在 Provider 中校验并冻结；
2. `useAccess()` 返回当前权限表；初始状态通过 `setInitialState`/`refresh` 改变后会重新计算；
3. `<Access accessible={boolean}>` 仅按调用方传入的布尔值决定是否渲染 children/fallback，不自行猜测权限；
4. 权限表是客户端 UI 状态，不是后端授权；隐藏按钮不能阻止直接调用 API；
5. `access` 函数抛错或返回非布尔表会以 `ACCESS_INVALID` 失败；Provider 每个挂载独立。

## 4. 与 Umi 4 的差异

参考 Umi 4.7.25 的 `packages/plugins/src/access.ts` 与 access 文档：

| 方面 | Umi | cormi F3b |
| --- | --- | --- |
| 访问定义 | `src/access.ts` 自动发现 | app.tsx 的 `access` 函数 |
| 启用方式 | access 插件/配置 | 显式 accessPlugin |
| 读取 | useAccess/Access | useAccess/Access |
| 与初始状态 | 自动绑定 initialState | 显式依赖 initialStatePlugin |
| 路由级 access | 支持 | 尚未交付 |
| 菜单/按钮权限 | 支持 | 仅提供 Hook/组件，菜单后续 |
| 服务端授权 | 由后端负责 | 同样由后端负责 |

本切片不承诺 Umi access API 或 `src/access.ts` 约定的二进制兼容。

## 5. 限制

- 不扫描 `src/access.ts`；权限函数必须放在 app 配置模块；
- 不提供路由级 access 字段或导航拦截；
- 不提供菜单过滤、UI 库权限组件或服务端授权；
- access 在初始状态加载期间以 undefined 计算，页面需处理 loading 或使用默认拒绝策略；
- 多个 access 插件贡献会因 key/hook 冲突失败；
- 权限结果不持久化，完全由当前挂载和初始状态决定。

## 6. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/access.test.ts`（贡献、key、顺序、非法选项、卸载） | 2/2 |
| `tests/browser/access.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 466/466，0 失败/取消/跳过（F3a 为 464，新增 2 项；约 108 秒） |
| `pnpm test:browser` | 31/31，0 失败/取消/跳过（F3a 为 30，新增 access 用例；约 332 秒） |
| `pnpm test:package` | 173 阶段满足预期（F3a 为 165，新增 8 个 access 阶段） |
| `examples/access` prepare + typecheck | 退出 0 |

浏览器验收覆盖：初始状态加载后 canAdmin 为 true、Admin 面板渲染、降级后 fallback 渲染、升级后恢复；开发与生产 preview 一致。独立打包消费覆盖 access 插件公开类型、AccessMap/useAccess/Access、开发、构建与静态预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f3b-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 7. 下一步

- F3c：layout/menu/面包屑与可选 UI adapter，菜单/面包屑基础已由 [F3c](71-f3c-menu.md) 交付；
- access 后续：`src/access.ts` 约定、路由级 access、菜单过滤；
- U16 后续：消息目录与 UI 库语言联动。
