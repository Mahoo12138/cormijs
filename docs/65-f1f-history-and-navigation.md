# cormi F1f：history 选择与公共导航/查询入口

日期：2026-10-20。本切片完成 U07：应用可选择 `browser`、`hash` 或 `memory` history；页面可从 `@cormijs/runtime` 使用统一的导航、参数和查询 Hook，不再直接依赖 `react-router` 包名。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';

export default defineConfig({
  presets: [preset],
  app: {
    base: '/history/',
    history: 'hash', // 'browser' | 'hash' | 'memory'，也可写成 { type: 'hash' }
  },
});
```

```tsx
// src/pages/_layout.tsx
import { Link, Outlet, useLocation } from '@cormijs/runtime';

export default function Layout() {
  const location = useLocation();
  return <div>
    <nav>
      <Link to="/">首页</Link>
      <Link to="/query?tab=one">查询</Link>
    </nav>
    <p data-path={location.pathname} />
    <Outlet />
  </div>;
}
```

`app.history` 缺省为 `browser`。字符串或 `{ type }` 形式等价；对象只接受 `type` 一个字段，其他值以 `CONFIG_INVALID` 失败。

## 2. 三种 history 的行为

| 模式 | Router | 与 `app.base` 的关系 | URL/刷新 |
| --- | --- | --- | --- |
| `browser` | `createBrowserRouter` | 作为 basename；真实路径包含部署前缀 | 深链需要服务器 HTML fallback；刷新保留路径 |
| `hash` | `createHashRouter` | `app.base` 只用于资源和页面挂载；路由路径在 `#` 之后 | `/base/#/about`；刷新保留 hash 路由；不需要逐路由 fallback |
| `memory` | `createMemoryRouter` | `app.base` 只用于资源和页面挂载 | 地址栏不变；内部从 `/` 开始；刷新回到首页 |

`hash` 与 `memory` 的 Router basename 固定为 `/`，因此：

- 页面 `Link to="/about"` 在 hash 模式生成 `#/about`，不把部署前缀写进 hash；
- `useLocation().pathname` 是应用相对路径（如 `/about`），不是部署前缀；
- `app.base` 仍由 Vite/构建负责，用于加载 `/.cormi/app.tsx` 和静态资源；
- `memory` 模式适合嵌入、测试或没有地址栏的宿主；它不提供可分享 URL，浏览器后退也不会驱动内部历史。

`onRouteChange` 事件新增 `history` 字段（`browser`/`hash`/`memory`）。browser 模式的 `location` 保持既有的包含 basename 的 history 位置；hash/memory 模式的位置是路由相对路径。

## 3. 公共导航与查询入口

`@cormijs/runtime` 现在重新导出 React Router 的稳定应用面：

```ts
import {
  Link, NavLink, Navigate, Outlet,
  createSearchParams,
  useHref, useLocation, useMatch,
  useNavigate, useNavigation, useParams,
  useSearchParams,
  useRouteMatches, // cormi 自身路由元数据 Hook
} from '@cormijs/runtime';
```

这不是第二套 Router，也不改变 `mountApplication` 的每挂载实例所有权；它只是把应用页面从具体 Router 包名解耦。`useSearchParams`、`useNavigate` 等行为与 React Router 7 相同，路由配置、生成、HMR 和清理逻辑不分叉。

## 4. 与 Umi 4 的差异

参考 Umi 4.7.25 的 `history` 配置、`packages/preset-umi/templates/history.tpl` 与 React Router 适配：

| 方面 | Umi | cormi F1f |
| --- | --- | --- |
| 配置形态 | `history: { type }` | 字符串或 `{ type }` |
| hash basename | 在 push 时把 basename 拼到 hash 路径 | hash 路径保持应用相对，`base` 只用于资源 |
| memory | `history` 包 memory history | `createMemoryRouter`，初始 `/`，不读写地址栏 |
| 导航 API | 从 `umi` 导出的 history/hooks | 从 `@cormijs/runtime` 导出的 hooks 与组件 |
| 全局 history 单例 | 存在 | 每个 mount 拥有自己的 Router，不使用模块级单例 |

本切片不承诺 Umi history 对象或配置的二进制兼容。

## 5. 限制与生命周期

- invalid history 在编译前失败，不生成入口；
- browser 模式仍要求部署服务器提供 SPA fallback；hash/memory 不要求逐路由 fallback；
- memory 模式刷新会丢失内部历史；需要可分享 URL 时使用 browser/hash；
- HMR 继续由 Vite 处理，history 变更属于 Node 配置更新；修改 `cormi.config.ts` 会重启 worker；
- Router 仍由每次 `mountApplication` 创建和释放，没有新增全局 history 单例；
- 公共导出来自 `react-router`，cormi 不承诺跨 React Router 主版本的稳定 ABI。

## 6. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/history.test.ts`（生成、inspect、非法配置） | 1/1 |
| `tests/browser/history.test.ts`（hash/memory，dev/typecheck/build/preview） | 2/2 |
| `pnpm check` | 455/455，0 失败/取消/跳过（F1e 为 454，新增 1 项；约 107 秒） |
| `pnpm test:browser` | 26/26，0 失败/取消/跳过（F1e 为 24，新增 hash/memory 两项；约 272 秒） |
| `pnpm test:package` | 133 阶段满足预期（F1e 为 125，新增 8 个 history 阶段） |
| `examples/history` prepare + typecheck | 退出 0 |

浏览器验收覆盖：

- hash 模式：导航后 URL 为 `/history/#/about`，刷新保留路由；`useSearchParams` 更新 hash 查询并保持；
- memory 模式：URL 保持 `/memory/`，内部路径变化；刷新回到首页；
- 两种模式都从 `@cormijs/runtime` 使用 `Link`、`useNavigate`、`useSearchParams`；
- dev 与生产 preview 行为一致。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f1f-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 7. 下一步

F1 的运行时、路由配置、全局布局、404/loading 与 history 已交付。下一阶段进入 F2：model/useModel、初始状态、request/useRequest，继续把应用级能力登记到 F1a 的运行时入口，而不是扩展 Node bootstrap。
