# U17-2：可选 ProLayout 外壳

日期：2026-10-22。本切片在 `@cormijs/plugin-antd` 中增加可选 ProLayout 集成：`ProLayoutShell` 读取 cormi 菜单、折叠状态与当前路由，`proLayoutPlugin` 负责 Vite 预打包声明与选项校验。布局仍由应用的全局 layout 文件显式组合，不把 ProLayout 变成强制依赖。

## 1. 使用方式

```bash
pnpm add antd @ant-design/pro-layout
```

```ts
import { defineConfig } from 'cormi';
import preset from '@cormijs/preset-react-vite';
import { antdPlugin, proLayoutPlugin } from '@cormijs/plugin-antd';
import { appRuntimePlugin, layoutPlugin, localePlugin, menuPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app', plugin: appRuntimePlugin },
    { id: 'locale', plugin: localePlugin },
    { id: 'menu', plugin: menuPlugin, options: { collapse: { storageKey: 'demo:menu' } } },
    { id: 'antd', plugin: antdPlugin },
    { id: 'pro-layout', plugin: proLayoutPlugin },
    { id: 'layout', plugin: layoutPlugin, options: { files: ['src/layouts/index.tsx'] } },
  ],
});
```

```tsx
// src/layouts/index.tsx
import { Outlet } from 'react-router';
import { ProLayoutShell } from '@cormijs/plugin-antd/pro-layout';
import { useIntl } from '@cormijs/runtime';

export default function Layout() {
  const { t } = useIntl();
  return <ProLayoutShell title={t('app.title')}><Outlet /></ProLayoutShell>;
}
```

菜单标题来自路由 `meta.locale`/`meta.title`，与 U15/F4i 的菜单运行时一致；切换 locale 后 ProLayout 菜单与标题随上下文更新。

## 2. 契约与语义

- **`proLayoutPlugin`**（`cormi:pro-layout`，`inject: ['vite']`）：校验 `id`，把 `@ant-design/pro-layout` 加入 Vite `optimizeDeps.include`。该包由应用布局懒加载；不预打包会触发首次访问时的依赖重优化和 504。插件通过 `ctx.effect` 注册，卸载时撤回，不持有运行时资源。
- **`ProLayoutShell`**（`@cormijs/plugin-antd/pro-layout`）：普通 React 组件，不是第二套 Provider。它依赖已挂载的 `menuPlugin`（`useMenu`/`useMenuCollapse`）、`antdPlugin`（ConfigProvider）与 `layoutPlugin`（全局 layout）；缺少 menu 时按 menu 运行时的 `MENU_MISSING` 失败。
- **导航**：菜单项用 React Router `<Link>` 渲染，保留 base、SPA 导航与浏览器前进/后退；`location` 取自 `useLocation`，选中态由 ProLayout 按路径计算。
- **折叠**：由 menu runtime 持久化，`ProLayoutShell` 受控传入 `collapsed`/`onCollapse`。ProLayout 默认的 `breakpoint="lg"` 会在挂载时按视口强制展开并覆盖持久化状态，因此外壳默认 `breakpoint={false}`；需要移动端自动折叠时显式传入 `'lg'` 等断点，并接受该覆盖语义。
- **外观**：`title`、`logo`、`layout`（side/top/mix）、`fixedHeader`、`siderWidth` 透传给 ProLayout；主题与 RTL 仍由 `antdPlugin` 的 ConfigProvider 负责。
- **归属**：应用布局组件拥有 ProLayout 元素与 children；cormi 不缓存、不代理该组件，卸载时随 React 树销毁。
- **子路径边界**：`@cormijs/plugin-antd/pro-layout` 是浏览器模块；包入口仍是 Node 配置模块，`isServerModule` 仅放行 `runtime` 与 `pro-layout` 两个客户端子路径。

## 3. 边界

- ProLayout 7.22.7 的 peer 声明仍是 `antd ^4.24.15 || ^5.11.2`；本切片在 antd 6.6.7 上通过真实 dev/build/preview 与安装包消费验证，但 pnpm 严格 peer 校验会拒绝该组合，安装包消费者需对该可选集成关闭 `strict-peer-dependencies`。上游放宽范围前不能宣称官方兼容。
- 未提供图表、主题编辑器或 ProLayout `SettingDrawer`；菜单图标已由 [U17-3](135-u17-menu-icons.md) 的 `meta.icon`/`icons` 注册表提供，`actionsRender`、头像等由应用自行传入或等待后续切片。
- 未映射 ProLayout 自身的内置文案 locale；菜单/页面标题由 cormi locale 提供，Antd 组件文案由 U17-1 的 locale 表提供。
- 未验证 SSR/SSR 样式抽取；ProLayout 运行时是 CommonJS 包，SSR 组合需单独验证。
- `breakpoint` 默认关闭，移动端不会自动折叠；ProLayout 的 `menu`、`breadcrumbRender`、`token` 等高级配置尚未暴露为外壳选项，应用可等待后续扩展或自行封装。
- 需要 `layoutPlugin` 与手写 `src/layouts/index.tsx`；不提供 Umi 那种仅改配置即自动生成布局的形态。

## 4. 与 Umi Max layout 的差异

| 方面 | Umi 4 + ProLayout | cormi U17-2 |
| --- | --- | --- |
| 接入 | layout 配置自动包裹 | `proLayoutPlugin` + 全局 layout 文件显式组合 |
| 菜单数据 | 路由配置 | menuPlugin 生成的本地化菜单 |
| 折叠 | ProLayout 状态 | menu runtime 持久化 + 受控组件 |
| 移动端断点 | 默认 lg | 默认关闭，显式开启 |
| 依赖 | Max 预设 | 可选包与可选 peer |
| 图标/图表/主题编辑器 | 生态/插件 | 未提供 |

## 5. 验证

验证环境：antd 6.6.7、`@ant-design/pro-layout` 7.22.7、React 19.3.1、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/pro-layout.test.ts` | 插件注册/撤回、非法选项、客户端子路径边界 |
| `tests/browser/pro-layout.test.ts` | dev/build/preview：菜单导航、base、选中态、locale 切换、折叠持久化 |
| 安装包 `pro-layout` consumer | 离线安装、typecheck、公共类型、dev/build/preview 浏览器验收；包 suite 344 阶段 |
| `pnpm check` | 568/568 |
| `pnpm test:browser` | 54/54 |
| `pnpm test:package` | 344 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u17-2-pro-layout-validation.json)。

## 6. 下一步

- U17 剩余：图表、主题编辑器、ProLayout 高级配置与更多 locale 联动；
- 之后推进 F6 微前端/状态库适配，或 U09 热替换、U12 缓存持久化、U33 sitemap index、SSR 生产化。
