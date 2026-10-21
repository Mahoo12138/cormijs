# U09-1：对象模型、reducers 与 effects

日期：2026-10-22。本切片在 Hook 模型之外增加 cormi 原生对象模型：`state + reducers + effects`，同步 reducer 触发订阅更新，effect 可通过 `put/call/state` 组合异步流程；`useModelDispatch` 提供绑定与全局派发。不是 dva 兼容层。

## 1. 使用方式

```ts
// src/models/cart.ts
import { defineModel } from '@cormijs/runtime';

export default defineModel({
  state: { items: [] as string[], total: 0 },
  reducers: {
    add(state, action) {
      return { items: [...state.items, String(action.payload)], total: state.total + 1 };
    },
  },
  effects: {
    async addLater(action, { put, call }) {
      await call((ms: number) => new Promise(resolve => setTimeout(resolve, ms)), 10);
      await put({ type: 'add', payload: action.payload });
    },
    async touchPrefs(action, { put }) {
      await put({ type: 'prefs/touch', payload: action.payload });
    },
  },
});
```

```tsx
import { useModel, useModelDispatch } from '@cormijs/runtime';

function Cart() {
  const cart = useModel<{ total: number }>('cart');
  const dispatch = useModelDispatch('cart');
  return <button onClick={() => void dispatch({ type: 'addLater', payload: 'apple' })}>{cart.total}</button>;
}
```

## 2. 契约与语义

- **识别**：模型默认导出为函数时保持 Hook 模型语义（每次 Provider 渲染调用一次，返回值共享）；默认导出为含 `state` 的对象时作为对象模型。`defineModel` 仅提供类型推断，不做运行时包装。
- **store**：对象模型每个应用挂载创建一次 store；`useModel(namespace, selector?)` 通过 `useSyncExternalStore` 订阅状态，selector 只做派生，不做等值去重。Hook 模型与对象模型可在同一应用共存。
- **reducers**：`reducer(state, { type, payload })` 必须返回新 state；返回 `undefined` 以 `MODEL_REDUCER_INVALID` 失败，不做隐式 mutation 合并。reducer 名称与 effect 名称在同一 namespace 内不能重复解释：同名时 reducer 优先。
- **effects**：`effect(action, helpers)`；helpers 提供：
  - `put(action)`：派发本模型 reducer/effect；带其他 namespace 的 `type`（`prefs/touch`）走全局派发。
  - `call(fn, ...args)`：调用并 await 函数/异步函数。
  - `state()`：读取当前最新 state。
  effect 的返回值（通常 Promise）由 dispatch 返回；错误原样向调用方抛出。
- **dispatch**：`useModelDispatch(namespace)` 返回绑定该模型的 dispatch；裸 `type` 只在该模型解析，带其他前缀会 `MODEL_ACTION_INVALID`。`useGlobalModelDispatch()` 要求 `namespace/action` 形式。未知动作 `MODEL_ACTION_NOT_FOUND`；Hook 模型没有 store，调用其 dispatch 为 `MODEL_DISPATCH_UNSUPPORTED`。
- **生命周期**：store 随应用挂载创建、随卸载由订阅清理；不做状态持久化，刷新/重新挂载回到初始 `state`。effect 不接收取消信号，卸载不会中断已在执行的 Promise。
- **SSR**：对象模型可在服务端创建 store 并参与渲染；不执行 effect，不做跨请求共享（每次渲染独立 Provider）。
- **类型**：`ModelReducer`/`ModelEffect` 的 state 由 `defineModel` 的 `state` 推断；action 仅约束 `{ type, payload? }`，payload 由应用自行收窄。

## 3. 边界

- 不实现 dva 的 `subscriptions`、`connect`、model 依赖排序、`extraModels` 或 action 中间件。
- 没有 selector 等值比较、批量更新或事务；每个 reducer 派发一次通知。
- 没有 effect 取消、超时、并发策略或 SSR 数据注水。
- 对象模型默认导出若是函数并返回含 `state` 的对象，仍按 Hook 模型处理；需要对象模型时必须直接导出对象。
- 跨 namespace 的 `put` 只允许对象模型，Hook 模型无法被派发。

## 4. 与 Umi/dva 的差异

| 方面 | Umi 4 + dva | cormi U09-1 |
| --- | --- | --- |
| 模型形态 | Hook 模型；dva 对象模型 | Hook + 原生对象模型 |
| 状态更新 | reducer/immer 生态 | reducer 返回新 state |
| effect helpers | call/put/select 等 | put/call/state |
| 订阅 | model 插件 + dva connect | useSyncExternalStore |
| 持久化 | 生态方案 | 无 |
| subscriptions | 支持 | 未提供 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/model.test.ts` | Hook+对象模型共存、reducer、异步 effect、跨模型 put、未知动作错误、导航保持、reload 重置 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u09-object-models-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u09-object-models-validation.json)。

## 6. 下一步

- U09 剩余：model 依赖排序、extraModels、对象模型 subscriptions/选择器优化；
- U16 UI locale 映射、U17 Antd/ProLayout、F6 微前端与状态库适配。
