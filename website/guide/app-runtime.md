# 应用运行时

`src/app.tsx` 是**浏览器侧**的运行时配置入口。它不参与 Node 配置求值，也不会在生成阶段执行。

cormi 把协议与发现分开：

- `@cormijs/runtime` 提供 `defineApp` 和生命周期类型。
- `@cormijs/plugin-react` 的 `appRuntimePlugin` 负责可选的文件约定。
- 默认 preset 不接管 `src/app.tsx`，避免把普通 React 组件静默解释成配置。

## 启用

```ts
import { defineConfig } from 'cormijs'
import reactVite from '@cormijs/preset-react-vite'
import { appRuntimePlugin } from '@cormijs/plugin-react'

export default defineConfig({
  presets: [reactVite],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
  ],
})
```

默认候选是 `src/app.ts`、`src/app.tsx`、`src/app.js`、`src/app.jsx`，同一时刻只允许一个。多个候选、符号链接或混合导出会明确失败。可用 `options.files` 覆盖。

## 最小示例

```tsx
// src/app.tsx
import { defineApp } from '@cormijs/runtime'

export default defineApp({
  async render(next) {
    const response = await fetch(import.meta.env.BASE_URL + 'startup.json')
    if (!response.ok) throw new Error('初始化失败')
    await next()
  },

  patchClientRoutes({ routes }) {
    routes.push({
      id: 'help',
      path: 'help',
      Component: Help,
    })
  },

  rootContainer(container) {
    return <PreferencesProvider>{container}</PreferencesProvider>
  },

  onRouteChange({ location, action, isFirst, basename }) {
    console.log(action, location.pathname, isFirst, basename)
  },
})
```

## 生命周期顺序

```text
runtime 插件 setup
  → app.setup
  → app.render（可异步阻塞首屏）
  → app.patchClientRoutes
  → app.rootContainer
  → 创建 Router 与 React root，挂载
```

### `setup`

```ts
export default defineApp({
  setup({ signal, basename }) {
    const stop = startSomething({ signal, basename })
    return () => stop()
  },
})
```

可以返回清理函数或异步清理函数。它在运行时插件 `setup` 之后执行，适合注册监听器、连接外部状态，而不是阻塞首屏。

### `render`

```ts
async render(next) {
  await loadCriticalData()
  await next()
}
```

- `next` 只能调用一次；未调用前不会创建 Router 或 React root。
- 取消启动后，迟到的 `next()` 会被拒绝。
- 可以直接 `return next()`；返回 Promise 或使用回调形式都可以。
- 抛错会中止挂载，错误按应用启动失败处理。

### `patchClientRoutes`

```ts
patchClientRoutes({ routes, basename, signal }) {
  routes.push({
    id: 'runtime-help',
    path: 'help',
    Component: Help,
  })
}
```

在 Router 创建前修改可变的路由数组。这里适合追加运行时路由；复杂声明仍建议使用配置式路由，便于生成类型和冲突校验。

### `rootContainer`

```tsx
rootContainer(container, { routes, basename }) {
  return <PreferencesProvider>{container}</PreferencesProvider>
}
```

每次挂载只执行一次。**不能直接使用 React Hooks**；需要 Context 时用 Provider 组件。

### `onRouteChange`

```ts
onRouteChange({ location, action, history, basename, isFirst, routes, clientRoutes }) {
  if (isFirst) return
  reportPageView(location.pathname)
}
```

- 首次事件的 `isFirst` 为 `true`。
- `location` 是包含 basename 的原始 history location。
- `routes` 是传给 `mountApplication` 的原始路由；`clientRoutes` 是 `patchClientRoutes` 之后实际挂载的树。
- 处理函数抛错只记录，不阻塞导航。

## 由插件注册的配置项

`getInitialState`、`request`、`locale`、`access`、`accessForbidden` 等字段不是内核内置，而是由对应插件登记后生效：

```ts
import {
  accessPlugin,
  appRuntimePlugin,
  initialStatePlugin,
  localePlugin,
  requestPlugin,
} from '@cormijs/plugin-react'

plugins: [
  { id: 'app-runtime', plugin: appRuntimePlugin },
  { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'app:initial-state' } },
  { id: 'request', plugin: requestPlugin, options: { id: 'app:request' } },
  { id: 'locale', plugin: localePlugin, options: { id: 'app:locale' } },
  { id: 'access', plugin: accessPlugin, options: { id: 'app:access' } },
]
```

```tsx
export default defineApp({
  getInitialState: async () => ({
    user: await fetch('/api/me').then(response => response.json()),
  }),
  request: { baseURL: '/api', timeout: 5000 },
  locale: {
    default: 'zh',
    fallback: 'en',
    messages: {
      zh: { title: '控制台' },
      en: { title: 'Console' },
    },
  },
  access: state => ({
    canAdmin: (state as { user?: { role?: string } })?.user?.role === 'admin',
  }),
})
```

插件卸载时，它登记的配置 key 和运行时 key 会一起撤回。

## 更底层的入口

需要更细的运行时控制时，可以关闭约定插件，使用 `app.runtime` 声明运行时模块：

```ts
app: {
  runtime: [{
    id: 'example:theme',
    module: { specifier: './src/runtime.tsx', exportName: 'default' },
    options: { label: 'My theme' },
  }],
}
```

运行时模块的默认导出是 `RuntimePlugin`：

```ts
import type { RuntimePlugin } from '@cormijs/runtime'

export default {
  setup({ signal, options }) {
    // 注册资源；返回清理函数
  },
  routes({ routes }) {
    // 在 Router 创建前追加路由
  },
  onRouteChange(location, event) {
    // 每次导航
  },
  Provider({ children, options }) {
    return <ThemeProvider>{children}</ThemeProvider>
  },
} satisfies RuntimePlugin
```

运行时插件也可以通过 `ctx.react.runtime.tap()` 贡献。具体的插件作者接口见[编写插件](/plugins/authoring)。

## 类型扩展

原生插件可以登记额外的运行时 key。应用侧用 module augmentation 扩展 `RuntimeConfig`：

```ts
declare module '@cormijs/runtime' {
  interface RuntimeConfig {
    preferences?: {
      theme: 'light' | 'dark'
    }
  }
}
```

这样 `defineApp` 会校验未知 key，不会让拼写错误静默通过。

## 限制

- `src/app.tsx` 只在浏览器执行；不要在这里读取 Node 环境变量或私有配置。
- `rootContainer` 不能使用 Hooks。
- `render` 的 `next` 只调用一次；取消后的迟到调用会失败。
- 当前只支持一个应用运行时文件，不支持同一应用挂载多个 React root。
- 没有 SSR 专属的 `app.tsx` 入口；SSR 复用同一份浏览器配置，浏览器 API 需自行隔离。

下一步：[数据流](/guide/data-flow)。
