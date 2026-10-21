# cormi F5d：路由预取

日期：2026-10-20。本切片交付 U31 的模块预取部分：生成入口为每个页面/布局路由建立惰性注册表，`routePrefetchPlugin` 暴露 `usePrefetch()` 供手动预热，或用 `mode: 'idle'` 在首屏空闲时预热全部路由。不含悬停/视口触发的链接级预取、SSR 预取或按数据依赖的预取编排。

## 1. 使用方式

```ts
// cormi.config.ts
import { routeConfigPlugin, routePrefetchPlugin } from '@cormijs/plugin-react';

plugins: [
  { id: 'routes', plugin: routeConfigPlugin, options: { id: 'app:routes', routes } },
  { id: 'prefetch', plugin: routePrefetchPlugin, options: { id: 'app:prefetch', mode: 'idle' } },
]
```

```tsx
import { usePrefetch } from '@cormijs/runtime';

const { ids, prefetch, prefetchAll } = usePrefetch();
// ids: ['config:guide', 'config:root:index', 'shell']（按 id 排序）
// prefetch('config:guide') -> Promise<boolean>；未知 id 返回 false
// prefetchAll() -> Promise<readonly string[]>
```

示例：`pnpm cormi dev --root examples/prefetch`（默认 `/prefetch/`，使用 `mode: 'idle'`）。

## 2. 契约与语义

- 生成：`generateApplication` 为每个带模块的路由生成 `const prefetch = {"<routeId>":()=>import("<specifier>"),...}` 并作为 `prefetch` 选项传给 `mountApplication`；重定向路由不进入注册表；模块说明符与路由懒加载使用同一来源，构建后落到同一代码块；
- 运行时：`PrefetchProvider` 持有注册表与在途 Promise 映射；同一 id 并发调用复用同一个 Promise，模块加载失败按 `false` 返回而不抛出（失败不阻断后续导航，浏览器下次仍会重新请求）；
- 手动模式（默认）：只提供 `usePrefetch()`，由应用决定何时预热（按钮、路由守卫、分析事件等）；
- 空闲模式：首屏挂载后通过 `requestIdleCallback`（2 秒超时；无该 API 时 `setTimeout 200ms`）调用 `prefetchAll()`，卸载时取消；
- 提供者：`cormi:route-prefetch`（`inject: ['react']`），RuntimeContribution 形式注册 `prefetchRuntime`（stage 40，包在最内层）；`Provider` 契约新增可选 `prefetch` 属性；
- 退出：卸载插件后 Provider 与注册表一起消失，`usePrefetch` 抛 `PREFETCH_MISSING`；生成入口的注册表本身只在使用时被引用，没有额外副作用。

## 3. 与 Umi 4 的差异

Umi 的 `routePrefetch` 是链接驱动策略：配置 `defaultPrefetch: 'none' | 'intent' | 'render' | 'viewport'` 与 `defaultPrefetchTimeout`，由渲染器在链接悬停/进入视口/渲染时触发对应路由的预取；另有 `routePreloadOnLoad` 在特定请求下预加载路由文件。cormi 的注册表更接近“可编程预热”：应用显式调用或空闲预热全量，不绑定链接组件。

| 方面 | Umi 4 | cormi F5d |
| --- | --- | --- |
| 触发方式 | intent/render/viewport 链接策略 | 手动 `prefetch(id)` 或空闲全量 |
| 配置面 | routePrefetch / routePreloadOnLoad | `mode: 'manual' \| 'idle'` |
| 粒度 | 路由 + 数据/依赖 | 路由代码块 |
| SSR/数据预取 | 与数据层联动 | 未交付 |
| 失败语义 | 由框架重试策略处理 | 返回 false，不阻断导航 |

## 4. 限制

- 只预取模块代码，不预取 client loader 的数据；`clientLoader` 与 `lazy` 会各自导入页面模块，预取注册表复用同一模块说明符（浏览器缓存命中一次执行）；
- 不做链接级 intent/视口触发，也没有 `defaultPrefetchTimeout` 这类策略配置；
- `ids` 含布局路由（例如 `shell`），布局模块同样可被预热；重定向路由与 404 不进入注册表；
- 空闲预热会在首屏后为**所有**路由发起请求，路由很多时应使用手动模式；
- 预取 Promise 不提供取消；页面卸载后完成的请求仍会留在浏览器缓存中。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。开发中确认了一个预期外的事实：注册表包含布局路由（`shell`），因此 `ids` 断言按真实集合修正，而不是只断言页面路由。

| 检查 | 结果 |
| --- | --- |
| `tests/prefetch.test.ts`（注册表生成、Provider 贡献与撤回、选项校验） | 2/2 |
| `tests/browser/prefetch.test.ts`（手动：dev/typecheck/build/preview；空闲：dev） | 2/2 |
| `pnpm check` | 501/501，0 失败/取消/跳过（F5c 为 499，新增 2 项；约 120 秒） |
| `pnpm test:browser` | 44/44，0 失败/取消/跳过（F5c 为 42，新增 2 项；约 479 秒） |
| `pnpm test:package` | 261 阶段通过（F5c 为 253，新增 8 个 prefetch 阶段） |
| `examples/prefetch` prepare + typecheck | 退出 0 |

浏览器与独立包消费验收断言：`data-ids` 为排序后的 `config:guide,config:root:index,shell`；点击“预取指南”后 `prefetch` 返回 `true`，且开发环境新增包含 `Guide` 的模块请求、构建产物新增一个 JS 资源请求；预取后导航仍正常渲染；`mode: 'idle'` 在首屏后 8 秒内自动出现 Guide 模块请求；无控制台错误与开发覆盖层。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5d-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U31 剩余：链接 intent/视口预取、按数据依赖预取、SSR 侧预取；
- U32/U33/U34/U35：SSR、静态导出、MPA、生产 API 路由；
- F4 剩余：U27 微生成器（需 CLI 多参数协议）、U28 工程命令；U25 输出与资源策略已由 [F4j](86-f4j-output-policy.md) 交付一部分；
