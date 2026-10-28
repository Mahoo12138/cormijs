# 插件

cormi 的产品能力由原生 Cordis 插件提供。这里的“插件”不是目录约定：每个能力都必须说明它贡献了什么、声明了哪些 `inject`、如何替换、退出时释放什么资源。

## 默认组合

`@cormijs/preset-react-vite` 是一份可阅读的插件清单：

```text
application-config
web
application-commands
react
vite
react-vite
inspect
typescript
```

它提供 React SPA 的开发、构建、预览和类型检查，不包含 model、request、locale、access、Mock、SSR、微前端等应用级能力。

```ts
import reactVite from '@cormijs/preset-react-vite'

export default defineConfig({
  presets: [reactVite],
  plugins: [
    // 应用能力需要显式挂载
  ],
})
```

## 能力插件

| 能力 | 插件 | 归属 |
| --- | --- | --- |
| 应用运行时 | `appRuntimePlugin` | `@cormijs/plugin-react` |
| 配置式路由 | `routeConfigPlugin` | `@cormijs/plugin-react` |
| 全局布局 | `layoutPlugin` | `@cormijs/plugin-react` |
| 首次加载回退 | `loadingPlugin` | `@cormijs/plugin-react` |
| 全局样式 | `globalStylePlugin` | `@cormijs/plugin-react` |
| Hook/对象模型 | `modelPlugin` | `@cormijs/plugin-react` |
| 初始状态 | `initialStatePlugin` | `@cormijs/plugin-react` |
| 请求客户端 | `requestPlugin` | `@cormijs/plugin-react` |
| 国际化 | `localePlugin` | `@cormijs/plugin-react` |
| 权限 | `accessPlugin` | `@cormijs/plugin-react` |
| 菜单与面包屑 | `menuPlugin` | `@cormijs/plugin-react` |
| 路由 head | `headPlugin` | `@cormijs/plugin-react` |
| 路由预取 | `routePrefetchPlugin` | `@cormijs/plugin-react` |
| pageview 分析 | `analyticsPlugin` | `@cormijs/plugin-react` |
| 微生成器 | `generatorPlugin` | `@cormijs/plugin-react` |
| 样式类型 | `styleTypesPlugin` | `@cormijs/plugin-react` |
| lint/format 包装 | `toolPlugin` | `@cormijs/plugin-react` |
| HTML head | `htmlPlugin` | `@cormijs/plugin-react-vite` |
| 别名 | `aliasPlugin` | `@cormijs/plugin-react-vite` |
| 编译期常量 | `definePlugin` | `@cormijs/plugin-react-vite` |
| 输出策略 | `outputPlugin` | `@cormijs/plugin-react-vite` |
| 静态导出 | `staticExportPlugin` | `@cormijs/plugin-react-vite` |
| API 路由 | `apiRoutePlugin` | `@cormijs/plugin-react-vite` |
| MPA | `mpaPlugin` | `@cormijs/plugin-react-vite` |
| 代理 | `proxyPlugin` | `@cormijs/plugin-react-vite` |
| SSR / 预渲染 | `ssrPlugin` | `@cormijs/plugin-react-vite` |
| 独立 serve | `servePlugin` | `@cormijs/plugin-react-vite` |
| Mock | `mockPlugin` + `devApiVitePlugin` | `@cormijs/plugin-dev-api` |
| TypeScript 检查 | `typescriptPlugin` | `@cormijs/plugin-typescript` |
| Antd Provider | `antdPlugin` | `@cormijs/plugin-antd` |
| ProLayout | `proLayoutPlugin` + `ProLayoutShell` | `@cormijs/plugin-antd` |
| React Query | `reactQueryPlugin` | `@cormijs/plugin-react-query` |
| dva | `dvaPlugin` / `createDvaRuntime` | `@cormijs/plugin-dva` / `@cormijs/dva` |
| qiankun | `qiankunPlugin`、`qiankunHostPlugin` | `@cormijs/plugin-qiankun` |
| Module Federation | `federationPlugin` | `@cormijs/plugin-federation` |

## 挂载

```ts
export default defineConfig({
  presets: [reactVite],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'app:model', plugin: modelPlugin, options: { id: 'app:model' } },
    { id: 'app:request', plugin: requestPlugin, options: { id: 'app:request' } },
  ],
})
```

- `id` 必须是稳定、唯一的实例 id。
- `options` 由插件自己校验；未知字段应明确失败。
- `enabled: false` 可以暂时停用条目而不删除配置。

## 撤回意味着什么

插件通过 `ctx.effect()` 登记贡献。停用或卸载时：

- 路由、布局、菜单项从下一次生成中消失。
- 运行时 Provider 不再出现在生成入口。
- 文件观察和命令注册随作用域释放。
- 已写入 `dist` 的产物不会自动回滚；需要重新构建。

这不是“热替换所有状态”。配置和 Node 插件变更会重启 worker；组件修改才走 Fast Refresh。

## 可替换性

判断一个能力是否真的可替换，不看文件放在哪个目录，而看：

1. 契约是否独立于提供者（例如 `ctx.react.routes`、`RuntimePlugin`、`RequestClient`）。
2. 消费者是否只声明 `inject`，不依赖提供者的内部字段。
3. 是否能在测试中关闭或替换提供者，并验证消费者独立运行。
4. 退出时谁拥有资源，是否随 Cordis 作用域释放。

默认 preset 可以整体替换，单个能力插件也可以替换；但替换为另一个真实构建器仍需要适配其原生插件，不代表自动兼容。

下一步：[编写插件](/plugins/authoring)。
