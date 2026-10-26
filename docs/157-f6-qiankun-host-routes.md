# F6-9：qiankun host 路由与菜单集成

日期：2026-10-26。本切片把 qiankun 子应用接入 cormi 的路由/菜单体系：`qiankunHostPlugin` 为每个子应用生成顶层宿主路由和捕获子路径的 `*` 子路由，`QiankunRoute` 按匹配前缀计算子应用 base 并用既有 `QiankunMicroApp` 挂载。它采用 qiankun 的 `loadMicroApp` 手动模式，而不是全局 `registerMicroApps`/`start` 自动循环，因此挂载/卸载由 React 和插件生命周期拥有。

## 1. 使用方式

```ts
import { qiankunHostPlugin } from '@cormijs/plugin-qiankun';

qiankunHostPlugin({
  apps: [{
    name: 'orders',
    entry: 'https://cdn.example.com/orders/qiankun.html',
    path: 'orders',                 // 或 activeRule: '/orders/*'
    title: 'Orders',
    icon: 'Appstore',
    order: 10,
    access: 'canOrders',
    props: { tenant: 'demo' },
  }],
});
```

同时启用 `menuPlugin` 后，宿主菜单会出现 `Orders`，路径为宿主 base 下的 `/orders`；`/orders/:any` 深链也由同一路由承接。子应用拿到 `props.base`（例如 `/host/orders/`），cormi 子应用的 `createMicroApp` 会用它作为本次挂载的浏览器路由 base。

仍需手动放置时继续使用 `QiankunMicroApp`；`QiankunRoute` 是它的受控路由包装。

## 2. 契约与语义

- 每个 app 生成两条 `RouteRecord`：
  - 父路由 `qiankun:<name>`：`path` 为静态前缀，模块为 `@cormijs/plugin-qiankun/host#QiankunRoute`，`meta` 包含 `title`/`icon`/`order` 与 `meta.qiankun` 的 `name`/`entry`/`props`/`className`/`style`，`access` 放在父路由；
  - 子路由 `qiankun:<name>:rest`：`path: '*'`、无组件，只负责让任意子路径继续匹配父路由，菜单不会出现子项。
- `path` 接受 `orders`、`/orders`、`/orders/`、`/orders/*`；`activeRule` 是同一前缀的字符串别名（便于从 qiankun 配置迁移）。两者同时出现时必须归一化为同一前缀。动态参数、`*` 中间段、query/hash、目录遍历都拒绝。
- 前缀必须唯一、app name 唯一；最多 64 个 app。`props`/`style` 必须是受审 JSON；`style` 值只允许 string/number。
- `QiankunRoute` 从最近的 `meta.qiankun` 匹配读取配置；base 使用 `useHref(match.pathname)` 计算，因此包含宿主 `app.base`（例如 `/host/orders/`），再以路由派生值覆盖 `props.base` 传入子应用。
- `@cormijs/runtime/microfrontend` 的 `MicroAppProps.base` 在每次 `mount` 时生效，覆盖 `createMicroApp` options 或应用默认 base；非法 base（非 `/.../`）直接拒绝。qiankun UMD 入口已把 qiankun props 原样交给 lifecycle，因此宿主传 base 即可。
- 路由切换离开子应用时 React 卸载 `QiankunMicroApp`，由它调用 qiankun `unmount`；同一路由内子路径变化不会重建应用。`update()` 不改变 base。
- 菜单/面包屑使用父路由 meta；无 `title` 时不会生成菜单项，但路由仍可直接访问。`access` 由既有路由守卫处理，菜单按 access 过滤。

## 3. 边界

- 不调用 qiankun 全局 `registerMicroApps`/`start`；没有全局 activeRule 函数/数组、全局生命周期钩子、预加载队列或跨路由常驻应用。每个路由只拥有自己的 `loadMicroApp`。
- 不支持 keep-alive/Tab 缓存、qiankun sandbox/样式隔离配置、global state、props 双向更新或同名前缀多实例。`singular`/sandbox 仍沿用 `QiankunMicroApp` 当前的 `{ sandbox: true, singular: false }`。
- 路由前缀只支持静态段；不支持参数化前缀、嵌套宿主布局分组、同一子应用多处挂载或按权限动态增删 app（app 列表在构建期固定）。
- 路由模式应使用根相对或绝对 `entry`；相对 `entry` 会按当前深链页面解析，语义不稳定。
- base 只影响 cormi 子应用的 React Router；非 cormi 子应用可以忽略 `props.base`，需自行处理路由和资源路径。资源/CDN base 仍由子应用构建配置和部署决定。
- 无 SSR：qiankun 只在浏览器 effect 中加载；未验证真实 qiankun 主应用框架、Windows、Firefox/Safari 或生产 CDN。
- `activeRule` 仅作为前缀别名，不实现 qiankun 的全局 URL 匹配引擎。

## 4. 验证

验证环境：qiankun 2.10.16、React 19.3.1、Playwright 1.58.2、Edge 156.0.4314.42、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/qiankun-host.test.ts` | 3 项：路由/child 生成、前缀与 activeRule 归一化、非法配置与 JSON |
| `tests/browser/qiankun-host.test.ts` | 菜单点击、`/host/slave/` deep link、base 透传、手动组件挂载/卸载/重建 |
| `tests/browser/qiankun.test.ts` | UMD lifecycle 以 `props.base=/mounted/` 挂载 cormi 子应用 |
| 安装包 qiankun-host consumer | 路由/菜单/组件、typecheck、公共类型、dev/build/preview |
| `pnpm check` | 584/584 |
| `pnpm test:browser` | 62/62 |
| `pnpm test:package` | 83 阶段（`CORMI_PACKAGE_ONLY=qiankun-host`，暖缓存离线安装；全量未重跑） |

完整日志哈希与源码集合见 [机器证据](../artifacts/f6-qiankun-host-routes-validation.json)。

## 5. 下一步

- qiankun 后续：全局 `registerMicroApps`/函数 activeRule、keep-alive/Tab、sandbox/样式隔离配置；
- 联邦后续：SSR 远端路由、清单签名/完整性；
- F6 剩余：多 builder/MFSU、dva 自动发现/immer/loading；
- U33 按语言拆分、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
