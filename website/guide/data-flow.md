# 数据流

cormi 提供两层共享状态：

- **初始状态**：应用启动时的一份只读启动数据，由 `initialStatePlugin` + `getInitialState` 提供。
- **模型**：跨页面共享的可变状态，由 `modelPlugin` 发现 `src/models/**`。

两者都需要显式启用。路由切换不会重建模型或初始状态 Provider；完整刷新会重新创建。

## 启用模型

```ts
import { modelPlugin } from '@cormijs/plugin-react'

plugins: [
  { id: 'application-model', plugin: modelPlugin, options: { id: 'application:model' } },
]
```

## Hook 模型

默认导出是一个 React Hook：

```ts
// src/models/counter.ts
import { useState } from 'react'

export default function counter() {
  const [count, setCount] = useState(0)
  return {
    count,
    increment: () => setCount(value => value + 1),
  }
}
```

```tsx
import { useModel } from '@cormijs/runtime'

function Counter() {
  const { count, increment } = useModel<{ count: number; increment: () => void }>('counter')
  return <button onClick={increment}>{count}</button>
}
```

同一挂载内的页面共享状态；路由切换保留，完整刷新重置。Hook 模型可以正常使用 React 状态和 effect，但 Provider 位于 Router 外，因此**不能用 `useLocation` 等路由 Hook**。

## 对象模型

默认导出含 `state` 的对象时，进入对象模型模式：

```ts
// src/models/cart.ts
import { defineModel } from '@cormijs/runtime'

export default defineModel({
  state: { items: [] as string[], total: 0 },

  reducers: {
    add(state, action) {
      return {
        items: [...state.items, String(action.payload)],
        total: state.total + 1,
      }
    },
  },

  effects: {
    async addLater(action, { put, call }) {
      await call((ms: number) => new Promise(resolve => setTimeout(resolve, ms)), 10)
      await put({ type: 'add', payload: action.payload })
    },
  },

  subscriptions: {
    syncTitle({ state, dispatch }) {
      document.title = `购物车 (${(state() as { total: number }).total})`
      return () => { document.title = 'cormi' }
    },
  },
})
```

```tsx
import { useModel, useModelDispatch } from '@cormijs/runtime'

function Cart() {
  const cart = useModel<{ total: number }>('cart')
  const dispatch = useModelDispatch('cart')

  return (
    <button onClick={() => void dispatch({ type: 'addLater', payload: 'apple' })}>
      {cart.total}
    </button>
  )
}
```

### reducer

- 必须返回新 state；返回 `undefined` 会以 `MODEL_REDUCER_INVALID` 失败。
- 不做隐式 mutation 合并。
- 同一 namespace 内 reducer 与 effect 同名时，reducer 优先。

### effect

`effect(action, helpers)` 的 helpers：

| 方法 | 作用 |
| --- | --- |
| `put(action)` | 派发本模型的 reducer/effect；`namespace/action` 形式走全局派发 |
| `call(fn, ...args)` | 调用并等待函数或异步函数 |
| `state()` | 读取当前最新 state |

effect 的返回值（通常是 Promise）由 dispatch 返回；错误原样抛给调用方。effect **不接收取消信号**，卸载不会中断已经在执行的 Promise。

### subscriptions

- 在挂载后按 `dependencies` 拓扑顺序执行。
- 可以返回清理函数。
- SSR 不执行。
- `dispatch` 的裸动作作用于本模型；`namespace/action` 走全局。

### 依赖与顺序

```ts
export default defineModel({
  state: { ... },
  dependencies: ['user'],
  subscriptions: { ... },
})
```

`dependencies` 声明必须先初始化的 namespace。缺失依赖或循环依赖会明确失败。

## 选择器与等值比较

```ts
// 只订阅派生值
const count = useModel('counter', (state: { count: number }) => state.count)

// 派生对象时显式传入比较函数
const view = useModel(
  'cart',
  (state: { items: string[]; total: number }) => ({ total: state.total, count: state.items.length }),
  (previous, next) => previous.total === next.total && previous.count === next.count,
)
```

对象模型支持 selector + 自定义等值比较：结果相等时不重渲染。Hook 模型不适用该优化。派生对象不要省略 `isEqual`，否则每次都会得到新引用。

## Dispatch

```ts
import {
  useGlobalModelDispatch,
  useModelDispatch,
} from '@cormijs/runtime'

const dispatch = useModelDispatch('cart')
await dispatch({ type: 'addLater', payload: 'apple' })

const globalDispatch = useGlobalModelDispatch()
await globalDispatch({ type: 'prefs/touch', payload: 'dark' })
```

- `useModelDispatch(namespace)`：裸 `type` 只在绑定的模型内解析；带其他 namespace 前缀会失败。
- `useGlobalModelDispatch()`：必须使用 `namespace/action` 形式。
- Hook 模型没有 store，调用其 dispatch 会得到 `MODEL_DISPATCH_UNSUPPORTED`。
- 未知动作返回 `MODEL_ACTION_NOT_FOUND`。

## 发现与命名

默认扫描 `src/models`，namespace 由路径派生：

| 文件 | namespace |
| --- | --- |
| `src/models/counter.ts` | `counter` |
| `src/models/admin/user.ts` | `admin.user` |
| `src/models/user.model.ts` | `user` |
| `src/pages/users/models/state.ts` | `users.state` |

路径中的 `src`、`pages`、`models` 段会被移除，扩展名与 `.model` 后缀去掉，剩余部分用 `.` 连接。重复 namespace 以 `MODEL_CONFLICT` 失败。

```ts
plugins: [{
  id: 'application-model',
  plugin: modelPlugin,
  options: {
    id: 'application:model',
    dir: 'src/models',
    extraModels: ['src/shared/session.ts'],
  },
}]
```

`dir`、`files`、`extraModels` 都是项目相对路径。`dir` 与 `files` 不能同时设置。隐藏文件、`.d.ts`、test/spec 文件和符号链接不参与扫描。

## 初始状态

同时启用 app 运行时与 `initialStatePlugin`：

```ts
import { appRuntimePlugin, initialStatePlugin } from '@cormijs/plugin-react'

plugins: [
  { id: 'app-runtime', plugin: appRuntimePlugin },
  { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'app:initial-state' } },
]
```

```tsx
// src/app.tsx
import { defineApp } from '@cormijs/runtime'

export default defineApp({
  async getInitialState() {
    const response = await fetch(import.meta.env.BASE_URL + 'bootstrap.json')
    return { user: await response.json() }
  },
})
```

```tsx
import { useInitialState } from '@cormijs/runtime'

function Profile() {
  const { loading, error, data, refresh, setInitialState } =
    useInitialState<{ user: { name: string } }>()

  if (loading) return <p>加载中…</p>
  if (error) return <button onClick={() => void refresh()}>重试</button>
  return <p>{data?.user.name}</p>
}
```

语义：

- Provider 在挂载后执行一次 `getInitialState`，**不阻塞首屏**。
- `refresh()` 重新执行；并发刷新以最后一次结果为准。
- `setInitialState(value)` 立即覆盖数据，并使在途刷新失效。
- 错误不自动重试，也不会抛到路由边界；页面自行呈现。
- 初始状态 Provider 位于模型 Provider 外层，所以模型 Hook 可以读取初始状态。

需要首屏阻塞时，可以在 `app.render` 里等待自己的初始化，而不是依赖 `getInitialState`。

## 如何选择

| 需求 | 建议 |
| --- | --- |
| 启动时加载用户、配置、权限角色 | 初始状态 |
| 跨页面共享的可变 UI 状态 | Hook 模型 |
| 需要 reducer/effect/subscription 的领域状态 | 对象模型 |
| 服务端数据缓存 | `useRequest` 或 React Query，不要塞进模型 |
| 只在一个组件内使用 | 普通 React state |

## 限制

- 没有状态持久化；刷新或重新挂载回到初始 `state`。
- effect 没有取消、超时或并发策略。
- 没有 `@@initialState` 模型、SSR 初始状态注水或跨请求共享。
- 对象模型与 Hook 模型可以共存，但 dispatch 只适用于对象模型。
- 模型 Provider 在 Router 外层，模型不能使用路由 Hook。

下一步：[请求](/guide/request)。
