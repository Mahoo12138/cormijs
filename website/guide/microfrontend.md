# 微前端

cormi 提供两条独立的微前端路径：

- **qiankun**：把 cormi 应用作为子应用产出 UMD/HTML 入口，或在宿主中挂载任意 qiankun 子应用。
- **Module Federation**：在构建期/启动期共享依赖并在宿主创建 Router 前合并远程路由。

两者都是可选包，不进入默认 preset。

## qiankun 子应用

```ts
import { qiankunPlugin } from '@cormijs/plugin-qiankun'

plugins: [{
  id: 'qiankun',
  plugin: qiankunPlugin,
  options: {
    id: 'app:qiankun',
    name: 'CormiMicroApp',
    mountId: 'root',
  },
}]
```

构建后会额外生成：

```text
dist/qiankun.js    # UMD，全局变量 CormiMicroApp
dist/qiankun.html  # 可被 qiankun 加载的 HTML 入口
dist/qiankun.css   # 存在样式时
```

- `name` 必须是合法的 JavaScript 全局标识符，qiankun 从该全局对象读取生命周期。
- `mountId` 是子应用容器内创建的挂载元素 id，默认 `root`。
- 开发期仍是正常自动挂载；UMD 入口只在 build 时生成。

运行时的 `createMicroApp` 也可以手动使用：

```ts
import { createMicroApp } from '@cormijs/runtime/microfrontend'

const app = createMicroApp(cormiApplication, { mountId: 'root' })
await app.bootstrap()
await app.mount({ container: '#subapp', base: '/host/orders/' })
await app.unmount()
```

`mount` 的 `base` 会覆盖本次挂载的浏览器 Router base。非法 base 会直接拒绝。

## qiankun 宿主

安装 `qiankun` 与 `@cormijs/plugin-qiankun`。

### 单页挂载

```tsx
import { QiankunMicroApp } from '@cormijs/plugin-qiankun/host'

export default function OrdersPage() {
  return (
    <QiankunMicroApp
      name="orders"
      entry="./micro/orders/qiankun.html"
      props={{ tenant: 'demo' }}
      fallback={<p role="status">子应用暂不可用</p>}
    />
  )
}
```

- 组件创建一个 `data-qiankun-host` 容器，在 effect 中调用 `loadMicroApp`。
- 加载失败时渲染 `fallback` 或 `role="alert"` 错误文本。
- 卸载、`name` 或 `entry` 变化时调用 `unmount()`。
- `props` 只在加载时读取一次；后续变化不会自动转发。
- 相对 `entry` 以当前页面 URL 解析；深链场景建议使用根相对或绝对 URL。

### 宿主路由与菜单

```ts
import { qiankunHostPlugin } from '@cormijs/plugin-qiankun'

plugins: [{
  id: 'qiankun-host',
  plugin: qiankunHostPlugin,
  options: {
    id: 'app:qiankun-host',
    apps: [{
      name: 'orders',
      entry: 'https://cdn.example.com/orders/qiankun.html',
      path: 'orders',
      title: 'Orders',
      icon: 'Appstore',
      order: 10,
      access: 'canOrders',
      props: { tenant: 'demo' },
    }],
  },
}]
```

每个 app 生成两条路由：

- 父路由 `qiankun:<name>`：静态前缀，组件为 `QiankunRoute`，`meta` 包含标题、图标、排序和 `meta.qiankun` 配置。
- 子路由 `qiankun:<name>:rest`：`path: '*'`，让任意子路径继续匹配父路由，不出现在菜单。

`path` 接受 `orders`、`/orders`、`/orders/` 或 `/orders/*`；`activeRule` 是同一前缀的字符串别名。动态参数、`*` 中间段、query/hash 和目录遍历会被拒绝。

宿主把 `props.base` 传给子应用，例如 `/host/orders/`。cormi 子应用会用这个 base 作为本次挂载的 Router base；非 cormi 子应用可以忽略它。

限制：

- 不调用 qiankun 全局 `registerMicroApps` / `start`，因此没有全局 activeRule 函数/数组、预加载队列或跨路由常驻。
- 不支持 keep-alive、sandbox/样式隔离配置、global state 或 props 双向更新。
- 路由前缀只支持静态段；app 列表在构建期固定。
- 仅在浏览器 effect 中加载，未验证 SSR。

## Module Federation

### 远程应用

```ts
import { federationPlugin } from '@cormijs/plugin-federation'

plugins: [{
  id: 'federation',
  plugin: federationPlugin,
  options: {
    name: 'CormiRemote',
    exposeRoutes: true,
    prefix: '/remote',
    version: '1.0.0',
    exposes: {
      './widget': './src/Widget.tsx',
    },
  },
}]
```

- `name` 是 Federation 容器名。
- `exposeRoutes: true` 生成 `.cormi/federation-routes.ts` 并暴露为 `./routes`。
- `exposes` 可以额外暴露组件。
- 默认共享 `react`、`react-dom`、`react-router`、`@cormijs/runtime`，均为 singleton；可用 `shared` 覆盖。
- 构建产物根目录生成 `cormi-federation.json` 清单。

### 宿主应用

```ts
plugins: [{
  id: 'federation',
  plugin: federationPlugin,
  options: {
    name: 'CormiHost',
    remotes: [{
      name: 'CormiRemote',
      entry: 'https://cdn.example.com/remoteEntry.js',
      prefix: '/remote',
      required: true,
    }],
    routeTimeout: 15000,
  },
}]
```

- `remotes[].name` 必须与远程容器名一致。
- `entry` 接受绝对 http(s) URL 或根相对路径。
- `prefix` 在远程路由树外增加一个 pathless 前缀路由；远端顶层绝对路径会去掉前导 `/` 后挂到该前缀下。嵌套绝对路径在前缀模式下会被拒绝。
- 所有远程路由 id 会加 `<remote>:` 前缀。
- 完整路径冲突会抛 `FEDERATION_ROUTE_CONFLICT`，不会静默覆盖。
- `required: true`（默认）时，加载超时、入口 404、CORS 失败或路由格式错误会使宿主启动失败；设为 `false` 会记录错误并跳过。
- 单 remote 最多 2048 个节点、64 层。

远程路由在 React Router 创建前合并，因此深链、菜单和远程 `clientLoader` 都按本地路由工作。

### 运行时清单

远程构建产出的 `cormi-federation.json`：

```json
{
  "format": "cormi:federation:1",
  "name": "CormiRemote",
  "entry": "./remoteEntry.js",
  "routes": "./routes",
  "prefix": "/remote",
  "version": "1.0.0",
  "hasRoutes": true,
  "buildId": "m9x2k"
}
```

宿主可以：

- 显式 `remotes`；
- 设置 `publicUrls` 指向远程包根、清单 JSON 或 npm `package.json`；
- 使用环境变量 `PACKAGE_PUBLIC_URL`（逗号或空白分隔）；
- 在部署 HTML 注入 `window.__CORMI_PACKAGE_PUBLIC_URL__`。

```ts
federationPlugin({ name: 'CormiHost', publicUrls: [] })
```

空数组声明“启用运行时清单”，避免构建期写死地址。`window.__CORMI_PACKAGE_PUBLIC_URL__` 存在时会替换构建期列表。

- `buildId` 会以 `?v=` 追加到 `entry`，绕过 `remoteEntry.js` 缓存。
- 同名 remote 冲突会抛 `FEDERATION_MANIFEST_CONFLICT`。
- 公开清单失败会阻止启动，不做“先渲染再补路由”。
- 清单响应上限 128 KiB，最多 32 个公开 URL。
- `prefixes` 可以按 remote 覆盖清单中的前缀。

### SSR 边界

Module Federation 当前只在客户端合并路由。开启 SSR 的宿主直接访问远程路径时，服务端 HTML 不包含远程路由，会出现服务端 404 与客户端路由不一致。不要把远程路由用于需要 SSR 的首屏。

## 选择

| 场景 | 建议 |
| --- | --- |
| 子应用是完整独立应用，需要 JS 沙箱 | qiankun |
| 宿主需要按路由挂载、菜单可见 | `qiankunHostPlugin` |
| 共享 React 运行时、合并远程路由 | Module Federation |
| 独立构建、独立部署、运行时发现 | Federation 清单 + `publicUrls` |
| 需要 SSR 的远程页面 | 当前不支持 |

## 限制

- qiankun 与 Federation 都是可选依赖，未安装时导入对应子路径会失败。
- 没有应用间 global state、事件总线、CSS 隔离或版本兼容协商。
- 远程资源 CORS、`publicPath`、CDN 缓存和灰度发布是部署责任。
- 未验证 Firefox/Safari、Windows 或真实公网 CDN 矩阵。

下一步：[生态集成](/guide/integrations)。
