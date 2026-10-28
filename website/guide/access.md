# 权限

cormi 的 access 层把初始状态映射为一组布尔能力，并据此控制组件、菜单和路由。**它只保护 UI，不能替代后端授权。**

## 启用

同时启用 app 运行时、初始状态与 access：

```ts
import {
  accessPlugin,
  appRuntimePlugin,
  initialStatePlugin,
} from '@cormijs/plugin-react'

plugins: [
  { id: 'app-runtime', plugin: appRuntimePlugin },
  { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'app:initial-state' } },
  { id: 'access', plugin: accessPlugin, options: { id: 'app:access' } },
]
```

## 声明权限函数

```tsx
// src/app.tsx
import { defineApp } from '@cormijs/runtime'

export default defineApp({
  async getInitialState() {
    return { role: 'admin' }
  },

  access(state) {
    const user = state as { role?: string } | undefined
    return {
      canAdmin: user?.role === 'admin',
      canRead: user !== undefined,
    }
  },
})
```

`access` 必须是同步函数，接收初始状态数据，返回 `Record<string, boolean>`。初始状态 Provider 位于 access Provider 外层；`setInitialState` 改变数据后权限会自动重算。

### `src/access.ts` 约定

启用 `accessPlugin` 后，也可以把权限函数放在约定文件：

```ts
// src/access.ts
export default function access(state: unknown) {
  const user = state as { role?: string } | undefined
  return {
    canAdmin: user?.role === 'admin',
    canRead: user !== undefined,
  }
}
```

`src/app.tsx` 显式提供的 `access` 优先。可用 `options.files` 覆盖候选文件。

## 在组件中使用

```tsx
import { Access, useAccess } from '@cormijs/runtime'

function Toolbar() {
  const access = useAccess()

  return (
    <>
      <Access accessible={access.canAdmin} fallback={<p>没有权限</p>}>
        <AdminPanel />
      </Access>

      {access.canRead && <ReadOnlyPanel />}
    </>
  )
}
```

`useAccess()` 返回布尔映射；`Access` 只做条件渲染，不是安全边界。

## 路由守卫

在配置式路由上声明 `access` key：

```ts
{
  path: 'admin',
  component: './src/Admin.tsx',
  access: 'canAdmin',
  meta: { title: '管理', access: 'canAdmin' },
}
```

生成器会为该路由创建守卫：

- `access.canAdmin` 为 true 时加载页面。
- 否则渲染内置 403，**不加载页面模块**。
- 有 wrappers 时，守卫覆盖首个 wrapper 及整条链。
- 菜单读取同一个 key 过滤显示。

### 自定义 403

```tsx
// src/app.tsx
function Forbidden() {
  return <main role="status"><h1>无权访问</h1></main>
}

export default defineApp({
  getInitialState() { return { role: 'user' } },
  access(state) { return { canAdmin: (state as { role: string }).role === 'admin' } },
  accessForbidden: Forbidden,
})
```

`accessForbidden` 只影响路由守卫，不改变 `Access` 组件的 fallback。

## 菜单与权限

```ts
meta: { title: '管理', access: 'canAdmin' }
```

启用 access 后，`meta.access` 为 false 或缺失的菜单项会隐藏。菜单过滤不是导航守卫；直接输入 URL 仍需要路由级 `access`。

## 与服务端的关系

客户端权限能阻止页面模块加载，但不能阻止用户调用接口。任何敏感操作都必须在服务端重新校验身份和权限：

- 不要把角色、密钥或完整权限表写进公开 bundle。
- 初始状态可以包含用户可见的权限映射，但服务端不能信任它。
- 路由守卫不是鉴权中间件。

## 限制

- access 函数必须是同步的；没有异步权限加载。
- 没有权限指令、角色继承或条件路由 DSL。
- SSR 尚未按请求计算权限；不要在服务端渲染的公开 HTML 中放入敏感数据。
- 路由守卫的行为属于生成入口；修改 access 配置会重启 worker。

下一步：[样式与静态资源](/guide/assets)。
