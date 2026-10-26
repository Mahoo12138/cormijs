# F6-8：PACKAGE_PUBLIC_URL 与运行时远端清单

日期：2026-10-26。本切片补上 hzero `PACKAGE_PUBLIC_URL` 对应的部署方式：远端构建产出自描述清单，宿主启动时按公开 URL 拉取清单、注册 Module Federation remote 并合并路由。这样各模块可以独立开发、构建和部署；宿主构建时不必知道远端地址，开发期引用源码 dev server，生产期引用已发布的 npm/CDN 产物目录。

## 1. 使用方式

远端构建仍使用 `federationPlugin`。构建结束时产物根目录生成 `cormi-federation.json`，dev server 也在同一路径提供它：

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

```ts
federationPlugin({ name: 'CormiRemote', exposeRoutes: true, prefix: '/remote', version: '1.0.0' });
```

宿主两种加载方式可组合静态 `remotes`：

```ts
// 构建/启动环境提供 PACKAGE_PUBLIC_URL 时自动读取；显式列表优先。
federationPlugin({ name: 'CormiHost' });
// 完全由部署 HTML 注入时，用空数组声明“启用运行时清单”。
federationPlugin({ name: 'CormiHost', publicUrls: [] });
```

```bash
PACKAGE_PUBLIC_URL="https://cdn.example.com/orders/,https://cdn.example.com/reports/" cormi build
```

```html
<script>
  window.__CORMI_PACKAGE_PUBLIC_URL__ = [
    'https://cdn.example.com/orders/',
    'https://unpkg.com/@acme/reports@1.2.3/package.json'
  ];
</script>
```

- `publicUrls` 接受 URL 字符串（逗号/空白分隔）或数组；未显式配置时读取 `process.env.PACKAGE_PUBLIC_URL`。
- 启动时 `window.__CORMI_PACKAGE_PUBLIC_URL__` 若存在则**替换**构建期列表，可用空字符串清空。宿主需用 `publicUrls: []` 或构建期列表声明运行时清单能力，否则不会生成联邦运行时插件。
- URL 可以是包根（自动补 `cormi-federation.json`）、直接清单 `.json`，或 npm 包的 `package.json`。
- npm 产品包在 `package.json` 中携带：

```json
{
  "name": "@acme/reports",
  "version": "1.2.3",
  "cormi": {
    "federation": {
      "format": "cormi:federation:1",
      "name": "CormiReports",
      "entry": "./dist/remoteEntry.js",
      "routes": "./routes",
      "prefix": "/reports"
    }
  }
}
```

`entry` 相对 `package.json` 所在目录解析。发布物仍需能被浏览器加载（CDN/静态服务器、CORS）；npm 只是分发载体。

## 2. 契约与语义

- 清单格式固定为 `cormi:federation:1`；校验 `name`（容器名）、`entry`（http(s)，相对清单解析）、`routes`（`./` 深路径）、`prefix`、`version`、`buildId`、`hasRoutes`。未知字段忽略，便于后续扩展。
- `buildId` 会以 `?v=<buildId>` 追加到 `entry`，用于部署后绕过 `remoteEntry.js` 缓存；远端内部 chunk 仍由 Module Federation 管理。
- 启动顺序：先并行拉取公开清单，逐个解析并与静态 `remotes` 合并；同名 remote 直接抛 `FEDERATION_MANIFEST_CONFLICT`，不以后者静默覆盖。然后 `init`/`loadRemote` 加载路由，再创建 router。所有远端清单与路由都在首屏挂载前完成，失败会阻止启动，不做“先渲染再悄悄补路由”。
- 清单无 `routes`/`hasRoutes:false` 时不参与路由合并；它仍可作为纯组件 expose 的联邦容器，由业务自己 `loadRemote`。
- 公开清单失败（网络、CORS、JSON、格式、超时）抛 `FEDERATION_MANIFEST_FAILED`；每个清单和每个 remote 使用同一个 `routeTimeout`（默认 15000ms）。单个清单响应上限 128 KiB，最多 32 个公开 URL。
- `prefix` 由远端清单发布，宿主可用 `prefixes` 覆盖，例如 `prefixes: { CormiReports: '/analysis' }`；空串或 `/` 可去掉清单前缀。
- `publicUrls` 只接受 http(s) 或根相对路径；拒绝凭据、fragment、目录遍历。清单内的 `entry` 允许相对、根相对或绝对 http(s)。
- dev 与生产共用同一清单路径：`https://<remote>/cormi-federation.json`。remote 的 `app.base` 若为子路径，清单随产物部署在该 base 下，`publicUrls` 应指向该 base。
- 静态 `remotes` 与运行时清单可并存，适合核心模块固定、活动模块动态上线的组合。

## 3. 边界

- 只做清单发现与路由合并，不自动安装 npm 包、不做 semver 选择/回滚、不校验签名或 SRI；公开清单是受信部署配置。
- 不做服务端清单聚合或 SSR 远端路由；服务端 HTML 仍不包含远端页面。
- 清单在启动时一次性拉取，不持久化、不后台刷新，也不按路径懒加载；更新清单需刷新页面。
- 远端地址变更可只改 `window.__CORMI_PACKAGE_PUBLIC_URL__` 或部署脚本，无需重建宿主；但构建期 `PACKAGE_PUBLIC_URL` 会写入生成入口，仍属于该次构建的默认值。
- 依赖共享仍由双方构建期 `shared` 配置决定；运行时清单不会把 npm 包里的 React 等模块自动注入 share scope。
- 远端资源 CORS、`publicPath`/base、CDN 缓存与灰度不在本切片内；未验证 Firefox/Safari、Windows 或真实公网 npm CDN。
- 不兼容 hzero `microConfig.json` 的 `mfCodeExposes`/`registerRegex` 字段；需要时可加本清单的自定义字段，但核心解析只认上述结构。

## 4. 验证

验证环境：`@module-federation/vite@1.23.5`、`@module-federation/runtime@2.9.2`、Vite 7.3.2、React 19.3.1、Playwright 1.58.2、Edge 156.0.4314.42、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/federation.test.ts` | 8 项：路由合并、前缀、冲突、畸形路由、runtime 选项、公开 URL、清单解析、npm package.json |
| `tests/browser/federation.test.ts` | 开发期静态 remotes；`PACKAGE_PUBLIC_URL` dev；远端 build 清单；宿主 `publicUrls: []` + 运行时窗口注入 preview；npm 风格 `package.json` 清单 |
| 安装包 federation consumer | remote build 产出并校验清单；host 从已服务产物清单启动，dev/build/preview 浏览器验收 |
| `pnpm check` | 581/581 |
| `pnpm test:browser` | 62/62 |
| `pnpm test:package` | 87 阶段（`CORMI_PACKAGE_ONLY=federation`，暖缓存离线安装；全量未重跑） |

完整日志哈希、源码集合与计数见 [机器证据](../artifacts/f6-runtime-manifest-validation.json)。

## 5. 下一步

- 联邦后续：SSR 远端路由、清单签名/完整性、并发多 remote 菜单排序、按环境灰度清单与 CSS 隔离；
- F6 剩余：qiankun `registerMicroApps`/activeRule/菜单集成、多 builder/MFSU、dva 自动发现/immer/loading；
- U33 按语言拆分、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
