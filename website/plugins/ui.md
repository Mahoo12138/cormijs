# UI 与状态插件

这些插件都是可选的。它们把第三方库接到 cormi 的运行时贡献上，但不把组件库或状态库塞进内核。

## `antdPlugin`

```ts
import { antdPlugin } from '@cormijs/plugin-antd'
```

| 选项 | 说明 |
| --- | --- |
| `id` | 插件实例 id，默认 `cormi:antd` |
| `theme.token` | Antd seed token，最多 128 项，值为字符串或有限数字 |
| `theme.dark` | 使用 Antd dark 算法 |

- `inject: ['react']`
- 通过 runtime 贡献包裹 `ConfigProvider`
- locale 来自 `localePlugin` 的 UI locale 回退链
- `direction` 来自 `localeDirection`
- 必须先挂载 `localePlugin`，Antd Provider 才能读取当前语言
- 卸载时贡献撤回；Antd 自身不是 Cordis 服务

## `proLayoutPlugin` + `ProLayoutShell`

```ts
import { proLayoutPlugin } from '@cormijs/plugin-antd'
```

| 选项 | 说明 |
| --- | --- |
| `id` | 插件 id，默认 `cormi:pro-layout` |

`proLayoutPlugin` 只做 Vite 预打包声明（`@ant-design/pro-layout`），避免首次懒加载时才发现依赖。真正的外壳是浏览器组件：

```tsx
import { ProLayoutShell } from '@cormijs/plugin-antd/pro-layout'
```

| Prop | 说明 |
| --- | --- |
| `title`、`logo` | 品牌信息 |
| `layout` | `side`、`top` 或 `mix` |
| `fixedHeader`、`siderWidth` | 布局尺寸 |
| `breakpoint` | 默认 `false`；避免 antd Sider 在桌面宽度强制展开 |
| `icons` | `meta.icon` → ReactNode 的注册表 |
| `settings` | 初始 ProLayout 设置，后续变化忽略 |
| `settingDrawer` | 渲染主题/布局编辑抽屉 |
| `settingsStorageKey` | 持久化设置 |
| `syncLocale` | 同步当前 locale 到 ProLayout 文案，默认 true |
| `formatMessage` | 覆盖主文案；SettingDrawer 仍使用内置五语言包 |

`useProLayoutSettings()` 提供 `{ settings, update, reset }`，必须在 `ProLayoutShell` 内使用。

依赖：

- `antd`
- `@ant-design/pro-layout`
- `menuPlugin`（菜单树）
- `localePlugin`（可选，但推荐）

ProLayout 7.22.7 仍声明 antd 4/5 peer；使用 antd 6 时严格 peer 安装需要对该可选集成关闭校验。

## `reactQueryPlugin`

```ts
import { reactQueryPlugin } from '@cormijs/plugin-react-query'
```

| 选项 | 说明 |
| --- | --- |
| `id` | 插件实例 id |
| `defaults.staleTime` | 0–86,400,000ms |
| `defaults.gcTime` | 0–86,400,000ms |
| `defaults.retry` | 0–10 或 false |
| `defaults.refetchOnWindowFocus` | boolean |

- `inject: ['react']`
- 只提供 `QueryClientProvider` 和默认项
- 应用直接使用 `@tanstack/react-query`
- 不把 query 结果注入 cormi model
- 卸载时 Provider 撤回；QueryClient 随 Provider 卸载

## `@cormijs/valtio`

不是 Cordis 插件，而是 valtio 的显式再导出：

```ts
import { proxy, useSnapshot } from '@cormijs/valtio'
```

导出：

```text
proxy, ref, snapshot, subscribe, useSnapshot
proxyWithDevtools, proxyMap, proxySet, subscribeKey, useProxy, watch
```

没有 Provider、服务注入或卸载清理。不要与 `modelPlugin` 管理同一份状态。

## `dvaPlugin` / `createDvaRuntime`

### 自动发现

```ts
import { dvaPlugin } from '@cormijs/plugin-dva'
```

| 选项 | 说明 |
| --- | --- |
| `id` | 插件实例 id |
| `immer` | 允许 reducer 修改 draft，默认 false |
| `loading` | 注册 `loading` namespace，默认 true |

- `inject: ['react', 'vite']`
- 发现 `src/models/**/*.{ts,tsx}`
- 每个文件默认导出 model 对象
- 固定目录和 Vite；不支持自定义目录或 `extraModels`
- 模型 eager 导入，无按路由拆包

### 显式 runtime

```ts
import { createDvaRuntime } from '@cormijs/dva'
```

`createDvaRuntime(models, options?)` 返回 `{ Provider }`，通过 `app.runtime` 挂载。适合自定义模型列表或非 Vite 组合。

`@cormijs/dva` 导出 `useDvaApp`、`useStore`、`useDispatch`、`useSelector`、`connect`。

- 使用 `dva-core` + `redux`，不使用 react-redux
- Provider 每次应用挂载创建独立 store
- 无 SSR store 注水
- 不桥接 cormi `useModel`

## 图表

没有图表插件。应用自行安装图表库，并用：

```tsx
<ClientOnly fallback={...}>
  <Suspense fallback={...}>
    <Chart />
  </Suspense>
</ClientOnly>
```

cormi 不提供服务端图表渲染配置；SSR 下的图表需要应用自己处理或跳过。

## 所有权

| 能力 | 资源所有者 | 退出时 |
| --- | --- | --- |
| Antd Provider | `antdPlugin` runtime 贡献 | 从生成入口移除 |
| ProLayout 预打包 | `proLayoutPlugin` 的 Vite 扩展 | 撤销扩展 |
| React Query | `reactQueryPlugin` runtime 贡献 | Provider 卸载 |
| dva 自动发现 | `dvaPlugin` 的 Vite 扩展 + runtime | 两者一起撤销 |
| valtio | 应用模块 | 应用自己管理 |

## 限制

- 所有 UI 包只提供适配层，不包含组件库。
- ProLayout 与 antd 6 的 peer 范围不一致。
- Valtio 无持久化/SSR。
- dva 无 SSR 注水、model 热替换或复杂 saga 取消验证。
- React Query 与 `useRequest` 是两套缓存，不要混用同一份数据。

下一步：[微前端插件](/plugins/microfrontend)。
