# cormi F2b：getInitialState 与初始状态

日期：2026-10-20。本切片交付 F2 的初始状态部分：显式启用的 `initialStatePlugin` 为应用配置登记 `getInitialState`，浏览器 Provider 在挂载后执行一次，页面通过 `useInitialState` 读取 loading/error/data，并可使用 `refresh`、`setInitialState`。`useModel('@@initialState')` 的 Umi 模型级集成、首屏阻塞和 SSR/hydration 尚未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, initialStatePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
  ],
  app: { base: '/initial-state/' },
});
```

```tsx
// src/app.tsx
import { defineApp } from '@cormijs/runtime';

export default defineApp({
  async getInitialState() {
    const response = await fetch(import.meta.env.BASE_URL + 'bootstrap.json');
    return { user: await response.json() };
  },
});
```

```tsx
// 页面
import { useInitialState } from '@cormijs/runtime';

const { loading, error, data, refresh, setInitialState } = useInitialState<{ user: { name: string } }>();
```

`initialStatePlugin` 是普通原生 Cordis 插件：`inject: ['react']`，登记一个 `getInitialState` app-config key 和一个 runtime Provider，二者都随 `ctx.effect` 撤回。它必须与 `appRuntimePlugin`（或其他提供应用配置模块的贡献）一起使用；单独启用插件但没有 app 模块时，loading 为 false、data 为 undefined。

## 2. 运行时语义

Provider 位于 Router 外、模型 Provider 外：

1. 首次渲染时若存在 `getInitialState`，`loading` 为 true、data 为 undefined；渲染不被阻塞；
2. 挂载后执行一次 `getInitialState`，成功写入 data，失败写入 error；
3. `refresh()` 重新执行；并发 refresh 以最后一次为准，旧结果不会覆盖新结果；
4. `setInitialState(value)` 立即覆盖 data，并使尚未完成的 refresh 结果失效；
5. 卸载后完成的请求不会更新状态；
6. StrictMode 下的重复 effect 不会重复启动首次请求；
7. 模型 Provider 在初始状态 Provider 内层，因此模型 Hook 可以使用 `useInitialState`；路由组件同样可以读取。

`getInitialState` 的返回值是应用自定义 JSON/对象，cormi 不解释其业务结构。Provider 不把错误抛到路由边界；页面根据 `error` 自行呈现或重试。

## 3. 与既有入口的关系

- `getInitialState` 是 `RuntimeConfig` 的可选 key，但运行时仍要求 `initialStatePlugin` 登记该 key；未启用时 `resolveAppConfig` 会拒绝未知 key；
- runtime Provider 由 `@cormijs/runtime` 的 `initialStateRuntime` 导出，生成入口把它作为普通 runtime 插件 import，不新增生成器分支；
- `useInitialState` 从 `@cormijs/runtime` 导出，应用无需直接依赖具体实现包；
- inspect 清单记录 runtime 贡献和 appRuntime keys，组件源码不在 Node 阶段执行；
- 插件卸载后下一次编译不再包含 `initialStateRuntime`，旧 Provider 不会泄漏到新入口。

## 4. 与 Umi 4 的差异

参考 Umi `packages/plugins/src/initial-state.ts` 与 `getInitialState` 文档：

| 方面 | Umi | cormi F2b |
| --- | --- | --- |
| 声明位置 | src/app.tsx 的 getInitialState | 同一位置 |
| 读取方式 | `useModel('@@initialState')` | `useInitialState`；模型级 `@@initialState` 未交付 |
| 首次加载 | 有 loading/error 状态，可阻塞 | 不阻塞首屏，显式 loading |
| 刷新 | refresh，防竞态 | refresh + generation 防旧结果覆盖 |
| 直接设置 | setInitialState | setInitialState，并取消在途 refresh |
| SSR/hydration | 支持 | 尚未交付 |

本切片不承诺 Umi initial-state 模型或 `@@initialState` 的二进制兼容。

## 5. 限制

- 仅提供 `useInitialState`，不注册 `@@initialState` model；
- 不阻塞首屏；需要阻塞的应用可在 `app.render` 中自行等待；
- 不提供 SSR/hydration 初始状态序列化；
- `getInitialState` 标记为应用 runtime key，运行前必须由插件登记；
- 多个 `initialStatePlugin` 贡献会因 key/hook 冲突失败；应用只应启用一个；
- 错误不自动重试；页面通过 `refresh` 或业务策略重试。

## 6. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/initial-state.test.ts`（贡献、key、非法选项、卸载） | 3/3 |
| `tests/browser/initial-state.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 460/460，0 失败/取消/跳过（F2a 为 457，新增 3 项；约 104 秒） |
| `pnpm test:browser` | 28/28，0 失败/取消/跳过（F2a 为 27，新增 initial-state 用例；约 291 秒） |
| `pnpm test:package` | 149 阶段满足预期（F2a 为 141，新增 8 个 initial-state 阶段） |
| `examples/initial-state` prepare + typecheck | 退出 0 |

浏览器验收覆盖：首屏 loading 状态、成功后的 data、`setInitialState` 覆盖、`refresh` 重新请求与调用计数、刷新页面重新创建 Provider；开发与生产 preview 一致。独立打包消费覆盖插件公开类型、`InitialState`/`useInitialState`、appRuntime key、构建与静态预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f2b-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 7. 下一步

- F2c：request/useRequest，覆盖传输、拦截器、取消、重试、并发/竞态和分页，基础能力已由 [F2c](68-f2c-request.md) 交付；
- U10 后续：`@@initialState` 模型集成、首屏阻塞策略与 SSR/hydration；
- 完成 F2 的真实应用联动：初始化用户 → 共享模型 → 请求 → 权限。
