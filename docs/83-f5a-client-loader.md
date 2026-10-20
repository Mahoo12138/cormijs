# cormi F5a：路由 client loader

日期：2026-10-20。本切片交付 U13 的核心：配置式路由可用 `clientLoader` 指定页面模块里的数据加载导出，浏览器在渲染该路由前执行它，页面用 `useClientLoaderData()` 读取结果；映射到 React Router 7 的数据路由 loader，因此深链接、重载与前进后退都会取得同一数据。服务端 loader、SSR 数据注水与 `routePrefetch`（U31）不在本切片。

## 1. 使用方式

```ts
// cormi.config.ts
import { routeConfigPlugin } from '@cormijs/plugin-react';

plugins: [{ id: 'routes', plugin: routeConfigPlugin, options: { id: 'app:routes', routes: [
  { path: 'member/:id', component: './src/Member.tsx', clientLoader: 'clientLoader' },
] } }]
```

```tsx
// src/Member.tsx
import { useClientLoaderData } from '@cormijs/runtime';
interface Data { id: string }
export default function Member() {
  const data = useClientLoaderData<Data>();
  return <p data-id>{data.id}</p>;
}
export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  return { id: params.id ?? '-' };
}
```

也可用 `useRouteLoaderDataFor(id)` 读取任意匹配路由的数据、`useClientLoaderError()` 在边界里读取 loader 抛出的错误。

## 2. 契约与语义

- 声明面：`ConfigRoute.clientLoader` 与扁平 IR `RouteRecord.clientLoader` 都是导出名字符串（`^[A-Za-z_$][A-Za-z0-9_$]{0,63}$`），必须与 `component`/`module` 同时出现；redirect 路由不能带 loader；违规以 `ROUTE_CLIENT_LOADER_INVALID` 在 `validateRoutes`/`expandRouteConfig` 阶段失败，配置式路由的未知字段仍由 `ROUTE_CONFIG_INVALID` 拒绝；
- 生成：`generateApplication` 对该路由改为一次性解析页面模块，再从同一模块取出 loader 导出：
  `lazy:async()=>{const page=await import("../src/Member.tsx");return {Component:await resolveRouteComponent(async()=>page["default"]),loader:clientLoaderOf(page,"clientLoader","config:member")};}`；页面模块只 import 一次，入口按需引入 `clientLoaderOf`；
- 运行时：`clientLoaderOf(page, exportName, routeId)` 在非函数导出时抛 `CLIENT_LOADER_INVALID: <routeId> expects <exportName> to export a function`，即缺失导出表现为路由 loader 错误而不是渲染期崩溃；loader 的入参、返回与重验证语义交给 React Router（`LoaderFunctionArgs`/`useLoaderData`）；
- 组合：loader 与既有 access 守卫、wrappers、`layout:false`、errorBoundary、meta 共存；被 access 拒绝时页面组件与其 loader 都不执行（守卫在父路由，页面路由不会匹配）；
- 退出：移除 `clientLoader` 声明后，生成入口回到不带 `clientLoaderOf` 的形状，不影响其它路由。

## 3. 与 Umi 4 的差异

Umi 的 `clientLoader` 由 `packages/preset-umi/src/features/clientLoader` 生成，配合 `useClientLoaderData`/`routeProps`、SSR 注水与 `routePrefetch`；cormi 直接把声明映射到 React Router 的数据路由，不引入第二套数据层，也不提供 `getPluginData`、SSR loader 与预取策略。

| 方面 | Umi 4 | cormi F5a |
| --- | --- | --- |
| 声明 | `clientLoader` + `clientLoaderData` | `clientLoader` 导出名 + `useClientLoaderData` |
| 执行层 | 框架生成的数据层 | React Router loader |
| SSR/预取 | 支持（`ssr`/`routePrefetch`） | 未交付 |
| 加载失败 | 框架错误呈现 | 交给路由边界（本切片未验证该呈现，见限制） |

## 4. 限制

- 只支持浏览器执行，没有服务端 loader、数据注水或流式渲染；loader 结果不进入 `.cormi/routes.d.ts` 类型推导，页面需自带返回类型；
- **loader 抛错时的呈现未在本切片验证**：验收曾包含“`/broken` 路由的 loader 抛错后由其 `errorBoundary` 渲染失败页”，实测该页面根节点没有挂载；本切片未定位原因，因此回退相关改动、移除该断言，不能把“loader 失败已由路由边界呈现”当作可用能力宣传。React Router 7.18.2 自身会派生该标记（`chunk-62JRHF6Z.mjs:6615`：`hasErrorBoundary: route.hasErrorBoundary || route.ErrorBoundary != null || route.errorElement != null`；`:5452` 只在 `hasErrorBoundary === true` 的匹配里自内向外挑选边界，否则回退 `matches[0]`），且 `lazy` 返回值里的 `hasErrorBoundary` 会被忽略（`:4677`），因此后续排查应从生成入口的静态 `ErrorBoundary` 与 `lazy` 合并顺序入手，而不是再补显式标记；
- 没有 `routePrefetch`/`routePreloadOnLoad`（U31），也不提供 loading 期间的 Suspense 骨架；
- 约定式路由不自动获得 loader 声明（页面模块的 `clientLoader` 导出不会被约定层识别），需要配置式路由显式声明；
- loader 无并行/依赖编排、无缓存控制 API，重验证行为沿用 React Router。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。开发中暴露两点：入口的运行时导入顺序是 `…type RuntimeEntry, clientLoaderOf`（断言需按实际形状写），以及为 errorBoundary 路由补 `hasErrorBoundary` 后 `/broken` 整棵树未挂载；后者未被证明可用，因此回退该改动并从验收中移除 loader 失败呈现，作为限制明确记录（不宣称 loader 失败已由边界呈现）。

| 检查 | 结果 |
| --- | --- |
| `tests/client-loader.test.ts`（IR/配置校验、缺失 component、redirect 冲突、展开、生成入口形状、模块单次解析、无 loader 路由不受影响） | 2/2 |
| `tests/browser/client-loader.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 496/496，0 失败/取消/跳过（F4i 为 494，新增 2 项；约 107 秒） |
| `pnpm test:browser` | 41/41，0 失败/取消/跳过（F4i 为 40，新增 1 项；约 433 秒） |
| `pnpm test:package` | 245 阶段通过（F4i 为 237，新增 8 个 client-loader 阶段） |

浏览器与独立包消费验收断言：站内导航到 `member/42` 渲染 loader 数据（`data-id`=42、`data-hits`=7）、直接深链接 `member/7` 在渲染前完成取数、`page.reload()` 后 loader 重新执行且数据一致、返回 `/` 正常渲染、dev 与静态 preview 结果相同、无控制台错误与开发覆盖层；类型检查覆盖 `clientLoader` 导出形状与 `useClientLoaderData` 的泛型读取（非函数值被 `@ts-expect-error` 拒绝）。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5a-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U13 剩余：loader 失败的边界呈现契约（含上述未挂载现象的定位）、约定式路由的 loader 识别、数据类型生成；
- U31：路由预取与拆包策略；U32/U33/U34：SSR、静态导出、MPA；U35：生产 API 路由；
- F4 剩余：U25 输出与资源策略、U27 微生成器（需先扩展 CLI 多参数命令）、U28 工程命令。
