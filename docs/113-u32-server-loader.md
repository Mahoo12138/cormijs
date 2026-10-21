# U32-1：serverLoader 服务端数据

日期：2026-10-22。本切片补齐 U32 的 serverLoader 契约：路由页面可导出仅在服务端执行的 loader，SSR 首屏执行并把数据写入 React Router hydration；客户端导航通过 SSR 回退端点取数。流式渲染仍属后续切片。

## 1. 使用方式

```tsx
// src/pages/user.tsx
import { Link, useServerLoaderData } from '@cormijs/runtime';

interface Data { id: string; display: string }
export default function User() {
  const data = useServerLoaderData<Data>();
  return <main><h1>{data.display}</h1><Link to="/">Home</Link></main>;
}

export async function serverLoader({ request, params }: {
  request: Request;
  params: { id?: string };
}): Promise<Data> {
  return { id: params.id ?? '', display: `user ${params.id}` };
}
```

```ts
// cormi.config.ts
const routes = [{ id: 'user', path: 'users/:id', component: './src/pages/user.tsx', serverLoader: 'serverLoader' }];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
    { id: 'ssr', plugin: ssrPlugin, options: { id: 'application:ssr' } },
    { id: 'serve', plugin: servePlugin, options: { id: 'application:serve' } },
  ],
  app: { ssr: true },
});
```

约定页面（`app.routes` 未显式配置时）也会识别 `export function serverLoader`、`export const/let/var serverLoader =` 与值形式 `export { load as serverLoader }`；注释、字符串、`declare`、类型别名和 type-only 导出不会被误判。

## 2. 契约与语义

- **IR**：`RouteRecord.serverLoader` / `ConfigRoute.serverLoader` 保存页面模块的导出名；必须同时有页面模块，且不能与 `clientLoader` 同时声明（`ROUTE_SERVER_LOADER_INVALID`）。存在 serverLoader 路由时应用必须声明 `app.ssr: true` 并启用 `ssrPlugin`，否则编译失败（`ROUTE_SERVER_LOADER_UNSUPPORTED`）。
- **生成**：`generateServerLoaders` 产出 `.cormi/server-loaders.tsx`，按路由 id 绑定页面导出；该文件只被 SSR 入口 `.cormi/ssr.tsx` 导入，应用入口不静态引用它。浏览器路由生成 `loader: serverLoaderOf(routeId, base)` 作为回退取数桩。
- **SSR**：`renderServerApplication` 在 `patchClientRoutes` 之后用 `.cormi/server-loaders.tsx` 的真实 loader 替换桩，再交给 React Router `createStaticHandler`；匹配链按父到子顺序执行，数据以路由 id 写入 `__staticRouterHydrationData.loaderData`。首次 hydration 直接消费该数据，不再请求回退端点。
- **参数**：loader 收到 `{ request, params }`；`request.url` 是包含 `app.base` 的完整请求 URL，与 static handler 中 clientLoader 收到的请求一致。子路由参数由匹配结果提供。
- **客户端导航**：桩调用 `loadServerLoaderData`，请求 `GET <base>.cormi/server-loader?url=<pathname+search>`；同一位置并发 loader 共享一个进行中的请求，完成后不保留缓存，下次导航重新取数。`serverLoaderOf` 返回的函数带内部标记，服务端渲染不会调用它。
- **端点**：dev、preview 与 `cormi serve` 都实现该端点；它剥离 `app.base` 后匹配路由，只执行带 serverLoader 的匹配路由，响应 `{ "data": { "<routeId>": ... } }` 并带 `cache-control: no-store`。未匹配返回 404，非 GET/HEAD 返回 405；loader 抛出的 `Response`（例如重定向）原样返回，其他异常返回 500 并记录日志。
- **数据**：结果必须可 JSON 序列化；循环引用等序列化失败以 `SERVER_LOADER_SERIALIZE` 失败。函数、Symbol 等不可序列化值不会被保留。
- **读取**：`useServerLoaderData<T>(routeId?)` 读取当前路由或指定匹配路由的 loader 数据；它与其他 loader 共用 React Router 的 `loaderData`，因此 `useRouteLoaderDataFor(routeId)` 也可读取。
- **base**：本切片同时修正 static 渲染的 basename 传递：`createStaticHandler` 接收 `basename`，`StaticRouterProvider` 使用同一 context，`<Link>` 的服务端 `href` 与客户端一致地带 `app.base` 前缀。

## 3. 边界

- 鉴权与 SSR 页面同权：任何能访问站点的请求都能触发 serverLoader（直接导航或回退端点）。鉴权必须在 loader 内完成，不能依赖客户端路由 `access` 守卫。
- 执行隔离而非源码剥离：页面模块仍是客户端组件依赖，其源码（包括 serverLoader 函数体）可能进入浏览器 chunk。不要把凭据硬编码在页面模块；服务端秘钥应从运行环境读取，并保持页面模块可被浏览器解析。Umi 的 serverLoader 同样以执行位置而非独立 bundle 为边界。
- 不支持流式渲染、端点级缓存、并发限流或跨路由依赖；`patchClientRoutes` 若修改路由 id，`.cormi/server-loaders.tsx` 的绑定会失效。
- `serverLoader` 与 `clientLoader` 互斥；需要两端不同数据时，当前应只选其一，或用 clientLoader 自行请求。

## 4. 与 Umi 4 的差异

| 方面 | Umi 4 | cormi U32-1 |
| --- | --- | --- |
| 声明 | 页面导出 serverLoader，构建期记录 hasServerLoader | IR/配置字段 + 约定导出检测 |
| 服务端执行 | SSR 匹配后执行并收集 loaderData | static handler 执行，写入 React Router hydration |
| 客户端回退 | `/__serverLoader` 端点 | `<base>.cormi/server-loader` 端点 |
| 数据读取 | `useServerLoaderData`（合并多级） | `useServerLoaderData(id?)`（按路由 id） |
| 源码剥离 | 不提供 | 不提供 |
| 流式 | 支持 | 未提供 |

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/server-loader.test.ts`、`tests/page-loaders.test.ts`、`tests/routes.test.ts` | IR 校验、导出检测、匹配链顺序、base 剥离、JSON 序列化失败、Response 透传、hydration 数据 |
| `tests/browser/ssr.test.ts` | dev/preview/serve 的 SSR 首屏、hydration 不触发回退请求、客户端导航触发端点、base `<Link>` 一致 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u32-server-loader-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u32-server-loader-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U32 剩余：流式 SSR 与更细的服务端渲染入口；
- U17 官方 Antd/ProLayout 集成、U16 dayjs/Antd locale 映射、F6 多 builder/微前端。
