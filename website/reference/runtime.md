# Runtime API

`@cormijs/runtime` 是浏览器侧唯一需要直接依赖的运行时包。它重新导出常用 React Router API，并暴露应用、数据、请求、国际化、权限、菜单、head、预取等 Hook。

```ts
import {
  defineApp,
  useModel,
  useRequest,
  useIntl,
  useAccess,
  useMenu,
} from '@cormijs/runtime'
```

另有子路径：

- `@cormijs/runtime/microfrontend`：qiankun 生命周期。
- `@cormijs/runtime/server`：SSR 渲染与 serverLoader。

## 应用

### `defineApp`

```ts
function defineApp<T extends RuntimeConfig>(config: T): T
function defineApp<T extends RuntimeConfig>(factory: () => T): () => T
```

声明 `src/app.tsx` 的运行时配置，提供 `setup`、`render`、`patchClientRoutes`、`rootContainer`、`onRouteChange` 的类型约束。功能 key 由插件登记后生效。

详见[应用运行时](/guide/app-runtime)。

### `mountApplication`

```ts
function mountApplication(options: MountApplicationOptions): Promise<ApplicationHandle>
```

低层挂载入口，通常由生成入口调用。选项包括 `element`、`routes`、`base`、`plugins`、`strict`、`appConfig`、`loading`、`history`、`models`、`prefetch`、`signal`、`hydrate`。返回的 handle 提供 `dispose()`。

### `RuntimePlugin`

运行时插件对象可以声明：

```ts
interface RuntimePlugin {
  Provider?: ComponentType<...>
  setup?(context): void | RuntimeCleanup | Promise<void | RuntimeCleanup>
  routes?(context): void | Promise<void>
  onRouteChange?(location, event, context?): void
}
```

### 其他

| 导出 | 说明 |
| --- | --- |
| `RedirectRoute` | 配置式 redirect 的生成组件 |
| `resolveRouteComponent` | 完成懒加载并保留原始导入错误 |
| `RuntimeConfig`、`RouteChangeEvent`、`RuntimeCleanup` | 应用配置与事件类型 |
| `APP_RUNTIME_KEYS` | 内核应用生命周期 key |

## 路由与导航

从运行时重新导出：

```ts
Link, NavLink, Navigate, Outlet, createSearchParams,
useHref, useLocation, useMatch, useNavigate,
useNavigation, useParams, useSearchParams
```

```ts
useRouteMatches(): readonly CormiRouteMatch[]
```

返回从根到最近匹配的路由，最近的在最后。每项包含 `id`、`pathname`、`params` 和 `meta`；meta 不隐式继承，也不表示权限。

## Loader

### clientLoader

```ts
useClientLoaderData<T>(): T
useRouteLoaderDataFor<T>(routeId: string): T | undefined
useClientLoaderError(): unknown
```

页面 `clientLoader` 在渲染前执行；类型由 `.cormi/loaders.d.ts` 的 `CormiLoaderData.Data<'route-id'>` 提供。

### serverLoader

```ts
useServerLoaderData<T>(routeId?: string): T
```

仅在 SSR 应用中有效。服务端 loader 只在服务端执行，客户端导航通过 `.cormi/server-loader` 取数。

详见[路由](/guide/routing#数据加载)。

## 模型

```ts
function defineModel<S>(model: ObjectModel<S>): ObjectModel<S>

function useModel<State, Selected = State>(
  namespace: string,
  selector?: (state: State) => Selected,
  isEqual?: (previous: Selected, next: Selected) => boolean,
): Selected

function useModelDispatch(namespace: string): ModelDispatch
function useGlobalModelDispatch(): ModelDispatch
```

相关类型：`ObjectModel`、`ModelDescriptor`、`ModelReducer`、`ModelEffect`、`ModelSubscription`、`ModelDispatch`。

Hook 模型默认导出函数；对象模型导出 `state + reducers + effects + subscriptions`。详见[数据流](/guide/data-flow)。

## 初始状态

```ts
function useInitialState<Data>(): InitialState<Data>
```

`InitialState`：

```ts
{
  loading: boolean
  error: unknown
  data: Data | undefined
  setInitialState(value: Data): void
  refresh(): Promise<void>
}
```

需要 `appRuntimePlugin` + `initialStatePlugin`。首屏不被阻塞。

## 请求

### 客户端

```ts
function createRequestClient(config?: RequestConfig): RequestClient
function useRequestClient(): RequestClient
```

`RequestClient`：

```ts
{
  request<T>(path, options?): Promise<T>
  get<T>(path, options?): Promise<T>
  post<T>(path, body?, options?): Promise<T>
  put<T>(path, body?, options?): Promise<T>
  delete<T>(path, options?): Promise<T>
  invalidateCache(tags?): number
  activate(): void
  dispose(): void
}
```

`RequestOptions` 支持 `headers`、`params`、`body`、`cacheTime`、`cacheBust`、`cacheTags` 以及标准 `RequestInit` 字段。

### Hook

```ts
function useRequest<T>(
  service: (client: RequestClient, signal: AbortSignal) => Promise<T>,
  options?: UseRequestOptions<T>,
): UseRequestResult<T>

function usePagination<T>(service, options?): UsePaginationResult<T>
function useCursorPagination<T>(service, options?): UseCursorPaginationResult<T>
```

`useRequest` 返回 `{ data, error, loading, run, refresh, cancel }`。选项包括 `manual`、`retry`、`retryDelay`、`pollingInterval`、`pollingWhenHidden`、`refreshDeps`、防抖/节流和回调。

详见[请求](/guide/request)。

## 国际化

```ts
function useIntl(): IntlApi
function useLocaleOptional(): IntlApi | null
const FormattedMessage: ComponentType<...>
function formatIcu(message, values, locale): string
function formatIcuParts(message, values, locale): readonly RichPart[]
```

`IntlApi`：

```ts
{
  locale: string
  setLocale(locale: string): void
  subscribe(listener): () => void
  t(key, values?): string
  peek(key): string | undefined
  formatNumber(value, options?): string
  formatDate(value, options?): string
  formatRelativeTime(value, unit, options?): string
  tp(key, count, values?): string
  rich(key, values, tags): ReactNode
}
```

UI locale：

```ts
normalizeLocaleTag(input): string | undefined
localeCandidates(locale): readonly string[]
dayjsLocaleCandidates(locale): readonly string[]
localeDirection(locale, overrides?): 'ltr' | 'rtl'
resolveLocaleResource(locale, resources): LocaleResourceMatch<T> | undefined
useLocaleResource<T>(resources, fallback?): UiLocaleResource<T>
```

纯格式化函数：`formatNumberFor`、`formatDateFor`、`formatRelativeTimeFor`。

详见[国际化](/guide/i18n)。

## 权限

```ts
function useAccess(): Readonly<Record<string, boolean>>
function useAccessOptional(): Access | null
function Access(props: {
  accessible: boolean
  fallback?: ReactNode
  children?: ReactNode
}): JSX.Element
function AccessRoute(props: { name: string }): JSX.Element
```

`AccessRoute` 由生成入口用于路由守卫；应用通常不需要直接使用。

## 菜单

```ts
useMenu(): readonly MenuItem[]
useBreadcrumb(): readonly BreadcrumbItem[]
useActiveMenuKeys(): readonly string[]
useMenuCollapse(): { collapsed, setCollapsed, toggle }
```

适配器：

```ts
toAntdMenuItems(items): readonly AntdMenuItem[]
toLayoutRoutes(items, icons?): readonly LayoutRoute[]
```

`MenuItem` 包含 `key`、`id`、`path`、`title`、`locale`、`order`、`meta`、`children`。

## Head

```ts
function Helmet(props: RouteHead): null
function collectHead(routes, pathname, basename?): RouteHead
function mergeHeads(base, entries): RouteHead
function normalizeHead(input): RouteHead
function serializeJsonLd(value): string
const HEAD_ATTRIBUTE = 'data-cormi-head'
```

`RouteHead`：

```ts
{
  title?: string
  metas?: { name?: string; property?: string; content: string }[]
  links?: { rel: string; href: string }[]
  jsonLd?: object | object[]
}
```

详见 [Head 与 SEO](/guide/head)。

## 预取

```ts
usePrefetch(): { ids, prefetch(id), prefetchAll() }
usePrefetchOnIntent(id, options?): {
  onMouseEnter, onMouseLeave, onFocus, onBlur
}
usePrefetchOnVisible(id, options?): (element) => void
```

需要 `routePrefetchPlugin`。只预取模块，不预取 loader 数据。

## 其他

| 导出 | 说明 |
| --- | --- |
| `ClientOnly` | SSR fallback，客户端挂载后渲染 children |
| `analyticsRuntime` | pageview 运行时贡献 |
| `PrefetchProvider`、`LocaleProvider`、`ModelProvider`、`RequestProvider`、`AccessProvider`、`MenuProvider`、`HeadProvider`、`InitialStateProvider` | 生成入口使用的 Provider |
| `richNodes` | 把富文本片段渲染为 ReactNode |

## 服务端子路径

```ts
import {
  renderServerApplication,
  renderServerApplicationStream,
  renderServerLoaderData,
} from '@cormijs/runtime/server'
```

- 渲染同一棵路由树和 Provider。
- `renderServerApplication` 返回 `{ html, status, headers, head }` 或一个 `Response`。
- `renderServerApplicationStream` 返回可读流与 hydration Promise。
- `renderServerLoaderData` 为客户端导航执行匹配路由的 serverLoader。
- 应用生命周期 `setup`、`render`、`onRouteChange` 不会在服务端调用。

## 微前端子路径

```ts
import { createMicroApp } from '@cormijs/runtime/microfrontend'
```

返回 qiankun 兼容的 `bootstrap`、`mount`、`unmount`、`update`。`mount` 支持 `container` 与 `base`。

下一步：[包列表](/reference/packages)。
