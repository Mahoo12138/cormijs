# U09-4：useModel 选择器等值优化

日期：2026-10-22。本切片为 `useModel(namespace, selector, isEqual?)` 增加等值比较：对象模型状态变化时，若选择器结果与上次相等，不触发该组件重渲染；可选 `isEqual` 支持派生对象。Hook 模型行为不变。

## 1. 使用方式

```tsx
const total = useModel('cart', state => ({ total: state.total }), (a, b) => a.total === b.total);
// 或选择原始值
const total = useModel('cart', state => state.total);
```

## 2. 契约与语义

- **比较**：默认 `Object.is`；第三个参数提供自定义比较。相等时不更新缓存、不通知订阅者、不重渲染；不等时更新一次。
- **选择器执行**：对象模型在每次渲染与每次 store 通知时执行选择器（与既有 API 一致）。派生对象默认每次产生新引用；需要稳定渲染时提供 `isEqual` 或选择原始值。
- **初次渲染**：首次调用建立缓存，不比较；SSR 也使用相同缓存路径。
- **Hook 模型**：没有 store 订阅，选择器仍在渲染时执行；等值参数不适用（保留签名兼容）。
- **无 store**：hook 模型分支的选择器结果不缓存。
- **默认路径**：不传 selector 时返回完整 state，行为与之前一致（store 每次通知都更新）。

## 3. 边界

- 这是“相等则不通知”的优化，不是 deep-equal 默认；对象/数组需显式 `isEqual`（例如浅比较或业务键比较）。
- 选择器必须保持纯函数；不要在 selector 中 dispatch 或创建副作用。
- 没有 memoized selector 组合库、依赖注入或调试计数。
- Hook 模型无法获得该优化；Hook 自身应自行管理状态引用。
- 不改变 effect/reducer/订阅时序。

## 4. 与 Umi 的差异

| 方面 | Umi 4 model | cormi U09-4 |
| --- | --- | --- |
| 默认比较 | fast-deep-equal | Object.is |
| 自定义比较 | 插件内部 | 第三参数 isEqual |
| 对象派生 | 深比较 | 需显式 isEqual |
| Hook 模型 | 同样逻辑 | 不适用 store 优化 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/model.test.ts` | `total` 引用变化但 `isEqual` 判定相等时不重渲染；total 改变时重渲染；既有模型/依赖/订阅用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u09-4-selector-equality-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u09-4-selector-equality-validation.json)。

## 6. 下一步

- U09 剩余：热替换保留 store；
- U17 ProLayout/图表、F6、U12 throttle/持久化、U16 请求 locale、U33 并发/robots 与 SSR 生产化。
