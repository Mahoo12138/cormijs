# U09-2：模型 subscriptions 与 extraModels

日期：2026-10-22。本切片补齐对象模型的生命周期订阅与外部模型文件：`subscriptions` 在应用挂载后执行并可返回清理函数，`modelPlugin.extraModels` 把目录外的模型文件并入同一模型集合。仍不提供 model 依赖排序。

## 1. 使用方式

```ts
// src/models/session.ts
import { defineModel } from '@cormijs/runtime';

export default defineModel({
  state: { ready: false },
  reducers: { mark(state) { return { ready: true }; } },
  subscriptions: {
    boot({ dispatch }) {
      void dispatch({ type: 'mark' });
      const timer = setInterval(() => void dispatch({ type: 'ping' }), 30_000);
      return () => clearInterval(timer);
    },
  },
});
```

```ts
{ id: 'models', plugin: modelPlugin, options: {
  id: 'application:model',
  extraModels: ['src/extra/boost.ts'],
} },
```

## 2. 契约与语义

- **subscriptions**：对象模型的 `subscriptions` 是函数表，每个函数在 Provider 挂载后执行一次，收到 `{ dispatch, state }`；dispatch 与 `useModelDispatch` 等价，`state()` 读取当前最新 state。返回函数作为清理函数，Provider 卸载时逆序执行。
- **SSR**：subscriptions 在 effect 中执行，服务端渲染不运行；hydration 后在浏览器挂载时执行。StrictMode 开发模式下按 React effect 语义执行/清理/再执行。
- **错误**：订阅函数抛错或清理抛错记录到 `[cormi:model-subscription]`，不阻止其他订阅或应用渲染；订阅内的异步错误由订阅自行处理。
- **extraModels**：`modelPlugin` 选项接受项目相对源文件数组（≤256）；与 `dir`/`files` 的结果合并、去重，并参与观察、生成、类型检查与 inspect。namespace 仍由文件路径派生：`src/extra/boost.ts` 是 `extra.boost`，不是 `boost`。
- **顺序**：订阅按 `subscriptions` 对象的键插入顺序执行；`extraModels` 与目录扫描的模型总体按 namespace 排序，但订阅只依赖各自 store，不承诺跨模型初始化顺序。
- **初始渲染**：订阅在首次提交后运行，首帧可能仍是初始 state；需要首帧即就绪的数据应放在 state 初始化或 loader。

## 3. 边界

- 没有 subscriptions 的 `history` 参数、model 依赖排序、`extraModels` 内联对象、热替换时保留 store 或订阅重放。
- 订阅清理只在 Provider 卸载时执行；路由切换不会重跑（模型 Provider 属于应用挂载层）。
- 订阅中的 dispatch 是异步 Promise；渲染阶段不等待。
- 不做持久化、跨标签页同步或订阅去重。

## 4. 与 Umi/dva 的差异

| 方面 | Umi 4 + dva | cormi U09-2 |
| --- | --- | --- |
| subscriptions | 支持，含 history | 支持，含 dispatch/state |
| extraModels | 配置追加模型 | 配置追加文件 |
| 初始化顺序 | dva 插件管理 | 无跨模型依赖排序 |
| SSR subscriptions | 生态差异 | 不执行 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/model.test.ts` | 外部模型被生成/类型检查；subscription 在挂载后 dispatch 并更新首屏；路由切换保留；reload 重跑；原有 Hook/对象模型用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u09-2-subscriptions-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u09-2-subscriptions-validation.json)。

## 6. 下一步

- U09 剩余：model 依赖排序、选择器等值优化；
- U12 分页/缓存、U16 UI locale 映射、U17 Antd/ProLayout、F6 微前端与状态库适配。
