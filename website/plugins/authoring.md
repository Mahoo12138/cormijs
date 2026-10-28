# 编写插件

cormi 不建立第二套插件生命周期。一个插件就是原生 Cordis 插件，使用 `inject` 声明依赖，用 `ctx.effect()` 登记贡献并释放资源。

## 最小插件

```ts
import { CormiError, type Plugin } from '@cormijs/core'

export interface StatusOptions {
  readonly id?: string
}

export const statusPlugin: Plugin.Object<StatusOptions> = {
  name: 'example:status',
  inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => key !== 'id')) {
      throw new CormiError('STATUS_INVALID', 'Invalid status plugin options.')
    }
  },
}
```

- `name` 是稳定插件名。
- `inject` 声明所需服务；没有 `react` 时插件不会激活。
- `apply` 中只执行激活逻辑；资源通过 `ctx.effect` 绑定到插件作用域。

## 贡献路由

```ts
import { CormiError, type Plugin } from '@cormijs/core'
import { clientModule } from '@cormijs/plugin-react'

export const statusPlugin: Plugin.Object<{ id?: string }> = {
  name: 'example:status',
  inject: ['react'],
  apply(ctx, options = {}) {
    const id = options.id ?? 'example:status'
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) {
      throw new CormiError('STATUS_INVALID', 'Invalid status plugin id.')
    }

    ctx.effect(() => ctx.react.routes.tap({
      id: id + ':routes',
      owner: id,
      ownerOrder: 0,
      run: current => [
        ...current,
        {
          id: id + ':page',
          path: 'status',
          module: clientModule('./Page.tsx', import.meta.url),
          source: { pluginId: id },
        },
      ],
    }))
  },
}
```

```tsx
// features/status/Page.tsx
import { Link } from 'react-router'

export default function Status() {
  return (
    <main>
      <h1>状态页面</h1>
      <Link to="/">回到首页</Link>
    </main>
  )
}
```

`clientModule` 只记录模块引用，不在 Node 执行页面源码；`from: import.meta.url` 让相对路径按插件文件位置解析，而不是按项目根。

路由贡献在所有来源合并后统一校验。冲突、未知模块、非法 meta 会明确失败。

## 更简单的声明式封装

```ts
import { clientModule, defineReactFeature } from '@cormijs/plugin-react'

export default defineReactFeature({
  id: 'example:status',
  description: 'A status page and its runtime banner.',
  routes: [{
    id: 'example:status:page',
    path: 'status',
    module: clientModule('./Page.tsx', import.meta.url),
  }],
  runtime: [{
    id: 'example:status:runtime',
    module: { specifier: './runtime.tsx', exportName: 'default' },
  }],
})
```

`defineReactFeature` 返回原生插件，内部用 `ctx.react.*` 登记路由、运行时、locale 目录、模型文件和全局样式。它不替代 Cordis；激活、注入和释放仍由 Cordis 拥有。

支持的声明：

| 字段 | 贡献 |
| --- | --- |
| `routes` | 路由 IR |
| `runtime` | 运行时插件描述 |
| `localeDirectory` | 消息目录 |
| `models` | 额外模型文件 |
| `styles` | 全局样式文件 |
| `description` | 诊断/文档描述 |
| `configSchema` | 该 feature 的 `app.*` schema |

`access` 字段目前不会贡献（多个 access 源会冲突），需要权限能力时使用 `accessPlugin` 或显式 `useAccess`。

## 浏览器运行时插件

运行时模块只在浏览器执行：

```tsx
// features/status/runtime.tsx
import type { RuntimePlugin } from '@cormijs/runtime'

export default {
  setup({ signal, options }) {
    const onClick = () => console.log('status', options)
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  },

  routes({ routes }) {
    // 在 Router 创建前追加路由；返回 Promise 也可以
  },

  Provider({ children, options }) {
    return <div data-status-runtime>{children}</div>
  },
} satisfies RuntimePlugin
```

- `setup` 可返回同步/异步清理函数。
- `routes` 只能修改传入的数组，不能返回新路由树。
- `Provider` 位于应用 Router 之外，不能使用路由 Hook。
- `onRouteChange` 处理每次导航。

运行时贡献随插件卸载从下一次生成入口中消失；已经加载的页面刷新后生效。

## 消费已有服务

```ts
const myPlugin: Plugin.Object = {
  name: 'example:consumer',
  inject: ['react', 'vite', 'commands'],
  apply(ctx) {
    // 只依赖声明的契约
  },
}
```

不要把提供者的内部字段当作公共 API。例如：

- 路由通过 `ctx.react.routes`，不是读取生成文件。
- 构建服务通过 `ctx.vite` / `ctx.commands`，不是直接持有 Vite server。
- 配置通过 `ctx.application` 或 `appConfig` 贡献，不是修改别人的 `app` 对象。

需要新服务时，用 Cordis 的 `ctx.provide` / `Service`，并声明消费者 `inject`，不要新增一套 enable/disable 状态机。

## 校验选项

- 拒绝未知字段。
- 校验 id 格式、路径边界、长度和类型。
- 用 `CormiError(code, message, details)` 抛出稳定错误码。
- 不要在 Node 求值阶段执行浏览器源码。
- 不要用 `as any` 绕过边界校验。

## 资源所有权

| 资源 | 谁释放 |
| --- | --- |
| Cordis 插件作用域 | `ctx.effect` 返回的清理函数 |
| 文件观察器 / 定时器 | 插件自己，在 effect 清理中停止 |
| HTTP 服务 / 端口 | 创建它的插件或命令消费者 |
| 浏览器监听器 | runtime `setup` 的清理函数 |
| React Provider | 应用卸载时由 React 释放 |

插件卸载后不能继续响应请求、写文件或更新全局状态。测试应覆盖：

1. 激活后贡献可见。
2. 停用后贡献消失。
3. 反复激活/停用不重复注册。
4. 异步初始化迟到结果不会写入已释放的作用域。
5. 替换提供者后消费者仍能独立工作。

## 测试

```sh
pnpm cormi diagnose --root my-app --for dev --json
pnpm cormi prepare --root my-app
```

- `diagnose` 查看插件、服务和贡献图。
- `prepare` 验证生成结果。
- 浏览器行为用真实构建结果测试，不只做首页 smoke。
- 测试探针也应是显式测试插件，不要把监控端点或测试开关塞进产品内核。

独立消费验证至少包括：安装打包后的 tarball、运行 typecheck、dev、build、preview，并确认卸载后没有残留。

## 边界

- 不要为了“看起来插件化”把纯函数或数据类型包成服务。
- 不要给 core 增加 React、Vite 或业务特判。
- 不要在插件里偷偷修改 `process.env`、全局样式选择器或别人的配置。
- 不要声称 Umi 插件二进制兼容；这里只吸收使用方式，不照搬旧后端内部机制。

下一步：[构建与运行时插件](/plugins/framework)。
