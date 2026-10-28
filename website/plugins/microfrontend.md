# 微前端插件

## `qiankunPlugin`

把 cormi 应用构建为 qiankun 子应用：

```ts
import { qiankunPlugin } from '@cormijs/plugin-qiankun'

plugins: [{
  id: 'qiankun',
  plugin: qiankunPlugin,
  options: { name: 'CormiMicroApp', mountId: 'root' },
}]
```

| 选项 | 说明 |
| --- | --- |
| `id` | 插件实例 id |
| `name` | UMD 全局名，必须是合法 JavaScript 标识符，默认 `CormiMicroApp` |
| `mountId` | 子应用容器内挂载元素 id，默认 `root` |

- `inject: ['vite']`
- 构建时额外生成 `qiankun.js`、`qiankun.html` 和可选 `qiankun.css`
- 开发期仍是正常自动挂载
- 卸载插件后额外入口不再生成

运行时生命周期来自：

```ts
import { createMicroApp } from '@cormijs/runtime/microfrontend'

const app = createMicroApp(cormiApplication, { mountId: 'root' })
await app.bootstrap()
await app.mount({ container: '#subapp', base: '/host/orders/' })
await app.unmount()
```

`base` 覆盖本次挂载的 Router base；非法 base 会被拒绝。

## `qiankunHostPlugin`

把子应用接入宿主路由和菜单：

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

| App 选项 | 说明 |
| --- | --- |
| `name` | 子应用名，唯一 |
| `entry` | qiankun HTML 入口，绝对或页面相对 |
| `path` / `activeRule` | 静态路由前缀；两者同时出现时必须一致 |
| `title`、`icon`、`order` | 菜单元数据 |
| `access` | 路由守卫 key |
| `props` | 受审 JSON，挂载时传入 |
| `className`、`style` | 容器样式 |

生成两条 RouteRecord：

- 父路由 `qiankun:<name>`，组件 `QiankunRoute`，带 `meta.qiankun`。
- 子路由 `qiankun:<name>:rest`，`path: '*'`，不出现在菜单。

`QiankunRoute` 从最近的 `meta.qiankun` 读取配置，计算包含宿主 `app.base` 的 base，并传给子应用。限制：

- 不调用全局 `registerMicroApps` / `start`
- 无函数/数组 activeRule
- 无 keep-alive、sandbox 配置、global state
- 路由前缀只支持静态段
- app 列表在构建期固定
- 无 SSR

## 单独挂载组件

```tsx
import { QiankunMicroApp } from '@cormijs/plugin-qiankun/host'
```

| Prop | 说明 |
| --- | --- |
| `name` | 子应用名 |
| `entry` | HTML 入口 |
| `props` | 加载时传入一次 |
| `className`、`style` | 容器样式 |
| `fallback` | 加载失败时渲染 |

组件在 effect 中调用 `loadMicroApp`，卸载时 `unmount()`。`props` 后续变化不会自动转发。

## `federationPlugin`

```ts
import { federationPlugin } from '@cormijs/plugin-federation'
```

### 远程

```ts
options: {
  name: 'CormiRemote',
  exposeRoutes: true,
  prefix: '/remote',
  version: '1.0.0',
  exposes: { './widget': './src/Widget.tsx' },
  shared: ['react', 'react-dom', 'react-router', '@cormijs/runtime'],
}
```

- 输出固定 `remoteEntry.js`
- `exposeRoutes` 生成并暴露 `./routes`
- 默认共享 React、React DOM、React Router、cormijs runtime，全部 singleton
- 构建产物根目录生成 `cormi-federation.json`
- 路由模块导出 `getRoutes()`，且不会触发第二份应用挂载

### 宿主

```ts
options: {
  name: 'CormiHost',
  remotes: [{
    name: 'CormiRemote',
    entry: 'https://cdn.example.com/remoteEntry.js',
    module: './routes',
    prefix: '/remote',
    required: true,
  }],
  prefixes: { CormiRemote: '/remote' },
  publicUrls: [],
  routeTimeout: 15000,
}
```

| 选项 | 说明 |
| --- | --- |
| `name` | 容器名，必填 |
| `remotes` | 静态远程列表 |
| `prefixes` | 按 remote 覆盖清单前缀 |
| `publicUrls` | 运行时清单 URL 列表或逗号/空白分隔字符串 |
| `routeTimeout` | 单个清单/远程路由超时，默认 15000ms |
| `shared` | 覆盖共享依赖列表 |
| `exposes` | 额外 expose |

- 远程路由在 Router 创建前合并，支持深链、菜单和远程 clientLoader。
- 路由 id 加 `<remote>:` 前缀。
- 前缀路由是 pathless chrome route；远端嵌套绝对路径会被拒绝。
- 精确路径冲突抛 `FEDERATION_ROUTE_CONFLICT`。
- `required: true` 失败会阻止启动；false 会记录并跳过。
- 单 remote 最多 2048 节点、64 层。

### 运行时清单

`publicUrls` 可以指向：

- 远程包根（自动补 `cormi-federation.json`）
- 直接清单 JSON
- npm 包的 `package.json`

也支持：

```bash
PACKAGE_PUBLIC_URL="https://cdn.example.com/orders/,https://cdn.example.com/reports/"
```

```html
<script>
  window.__CORMI_PACKAGE_PUBLIC_URL__ = ['https://cdn.example.com/orders/']
</script>
```

`window.__CORMI_PACKAGE_PUBLIC_URL__` 存在时替换构建期列表。`publicUrls: []` 表示启用运行时清单能力但构建期不写死地址。

清单字段：`format`、`name`、`entry`、`routes`、`prefix`、`version`、`hasRoutes`、`buildId`。

- `buildId` 以 `?v=` 追加到 `entry`，绕过缓存。
- 同名 remote 冲突抛 `FEDERATION_MANIFEST_CONFLICT`。
- 清单失败会阻止启动；不做“先渲染再补路由”。
- 清单响应上限 128 KiB，最多 32 个 URL。

## SSR

qiankun 只在浏览器 effect 中加载。

Federation 只在客户端合并路由。SSR 宿主的服务端 HTML 不包含远程路由；直接访问远程路径会出现服务端 404 与客户端不一致。

## 所有权与退出

| 资源 | 所有者 | 退出 |
| --- | --- | --- |
| qiankun UMD 入口 | `qiankunPlugin` 构建扩展 | 下一次 build 不再生成 |
| 子应用实例 | `QiankunMicroApp` / `QiankunRoute` | React 卸载时 `unmount()` |
| 宿主路由 | `qiankunHostPlugin` / `federationPlugin` | 插件撤回，下一次生成消失 |
| 远程模块 | Module Federation runtime | 应用卸载时释放 |

## 限制

- 两者都是可选依赖，未安装时导入对应子路径会失败。
- 没有应用间 global state、事件总线、CSS 隔离或版本协商。
- 远程 CORS、publicPath、CDN 缓存与灰度是部署责任。
- 未验证 Firefox/Safari、Windows 或真实公网 CDN 矩阵。

下一步：[设计原则](/about/design)。
