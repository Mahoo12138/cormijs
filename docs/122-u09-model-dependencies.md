# U09-3：模型依赖排序与初始化顺序

日期：2026-10-22。本切片补齐对象模型依赖：`dependencies` 声明前置 namespace，Provider 先创建全部 store，再按依赖优先顺序启动 subscriptions；缺失依赖、自依赖与循环依赖在挂载时明确失败。同时明确 subscription dispatch 的裸动作/跨模型语义。

## 1. 使用方式

```ts
// src/models/prefs.ts
export default defineModel({
  state: { theme: 'light' },
  subscriptions: { boot({ dispatch }) { void dispatch('audit/record'); } },
});

// src/models/cart.ts
export default defineModel({
  state: { items: [] },
  dependencies: ['prefs'],
  subscriptions: { boot({ dispatch }) { void dispatch('audit/record'); } },
});
```

`audit` 的 `record` reducer 会依次收到 `prefs`、`cart`，因为 `cart` 依赖 `prefs`，即使文件/namespace 排序不是这个顺序。

## 2. 契约与语义

- **dependencies**：对象模型可选字符串数组（≤64）；namespace 必须存在于同一应用模型集合，且不能自引用。重复项去重。
- **顺序**：`modelInitializationOrder(models)` 做稳定拓扑排序：每个模型在其依赖之后；无关模型按输入顺序（通常是 namespace 排序）。Provider 用该顺序启动对象模型 subscriptions。
- **hook 模型**：依赖只对对象模型有效；Hook 模型没有 store/subscription，按输入顺序在渲染中调用；依赖它或它依赖对象模型不会改变 Hook 调用顺序。
- **创建与启动分离**：所有 store 在首次渲染时创建（依赖顺序不影响创建，因为创建无副作用）；subscriptions 在挂载 effect 中按拓扑顺序启动，清理按启动逆序。
- **错误**：重复/非法 namespace 为 `MODEL_INVALID`；缺失依赖 `MODEL_DEPENDENCY_MISSING`；自依赖/循环 `MODEL_DEPENDENCY_CYCLE`；依赖字段非字符串数组 `MODEL_DEPENDENCY_INVALID`。错误在 Provider 首次渲染时抛出，由应用错误边界接管。
- **subscription dispatch**：裸动作（`mark`）派发到本模型；带 namespace 的动作（`audit/record`）走全局派发，可更新其他对象模型。effect 的 `put` 规则相同。
- **Effect/reducer 方向**：依赖只保证 subscription 启动顺序；effect/reducer 运行时可跨模型派发，不强制等待依赖状态就绪。

## 3. 边界

- 没有模型销毁/重建、热替换保留 store、异步依赖（如等待某个模型加载完成）或按依赖注入构造参数。
- 没有跨应用/跨请求模型实例；SSR 每个渲染独立 Provider。
- 依赖不会改变 `useModel` 的可用性；所有模型在首帧均可读取初始 state。
- 没有循环的延迟检测或自动拆分；错误直接失败。
- 拓扑排序为稳定但非唯一；不要依赖无关模型之间的相对顺序。

## 4. 与 Umi/dva 的差异

| 方面 | Umi + dva | cormi U09-3 |
| --- | --- | --- |
| 模型依赖 | 生态约定/插件 | `dependencies` 拓扑排序 |
| 初始化顺序 | 插件管理 | subscriptions 按依赖启动 |
| 循环检测 | 生态差异 | 明确失败 |
| subscription dispatch | 全局 dispatch | 裸动作本模型，带 namespace 全局 |
| 异步依赖 | 生态方案 | 未提供 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/model.test.ts` | 拓扑排序、循环/自依赖/缺失依赖/重复 namespace |
| `tests/browser/model.test.ts` | cart 依赖 prefs 时 subscription 记录顺序为 `prefs,cart`，reload 后重放；既有对象模型/subscriptions 用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u09-3-dependencies-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u09-3-dependencies-validation.json)。

## 6. 下一步

- U09 剩余：选择器等值优化、热替换保留；
- U17 Antd/ProLayout、U12 容量/失效、U16 RTL/请求 locale、U33 自动路径发现、F6。
