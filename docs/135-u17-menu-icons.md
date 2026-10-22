# U17-3 / U24：菜单图标注册表

日期：2026-10-22。本切片把菜单图标从“应用自己拼 ProLayout 数据”提升为可复用契约：路由 `meta.icon` 提供稳定图标键，应用用 `icons` 注册表映射到任意 React 图标组件，`toLayoutRoutes` 与 `ProLayoutShell` 负责解析。cormi 不绑定具体图标库，也不引入图标代码生成。

## 1. 使用方式

```tsx
// src/layouts/index.tsx
import { Outlet } from 'react-router';
import { HomeOutlined, TeamOutlined } from '@ant-design/icons';
import { ProLayoutShell } from '@cormijs/plugin-antd/pro-layout';
import { useIntl } from '@cormijs/runtime';

const icons = { home: <HomeOutlined />, users: <TeamOutlined /> };

export default function Layout() {
  const { t } = useIntl();
  return <ProLayoutShell title={t('app.title')} icons={icons}><Outlet /></ProLayoutShell>;
}
```

```ts
const routes = [
  { id: 'home', path: '/', component: './src/Home.tsx', meta: { title: 'Home', icon: 'home' } },
  { id: 'users', path: '/users', component: './src/Users.tsx', meta: { title: 'Users', icon: 'users' } },
];
```

图标键与图标库解耦：同一份路由配置可换用 `@ant-design/icons`、lucide、内联 SVG 或自有组件，只需替换 `icons` 注册表。

## 2. 契约与语义

- **`toLayoutRoutes(items, icons?)`**：`LayoutRoute.icon` 从 `meta.icon` 字符串解析；未提供 `meta.icon` 时回退到路由 `id`；注册表只读取自有属性，不命中 `Object.prototype` 等继承键。输出仍冻结，未命中时省略 `icon`。
- **`ProLayoutShell.icons`**：透传同一注册表；菜单、嵌套子菜单与 locale 切换后的重建都复用该解析，图标不随标题变化丢失。
- **无插件/无资源**：这是纯数据适配与 React 渲染，不新增 Cordis 插件、服务或生命周期；应用拥有图标组件及代码分割。`proLayoutPlugin` 仍只负责 ProLayout 的 Vite 预打包。
- **类型**：`LayoutRoute` 与 `ProLayoutShellProps.icons` 使用 React `ReactNode`；未安装任何图标库的消费者不受影响。

## 3. 边界

- 不提供字符串到组件的自动解析、图标自动发现、SVG 资源管线或按需导入代码生成；应用需显式导入图标并构建注册表。
- 不强制 `@ant-design/icons`；该库仅用于本切片的浏览器与安装包验证。
- `meta.icon` 必须是字符串键；不能直接放 ReactNode（路由 meta 需可序列化）。
- 未命中时静默省略图标，不报错；需要校验时由应用在构建注册表阶段完成。
- 图表、主题编辑器与 ProLayout 高级 header/actions 配置仍未提供。

## 4. 验证

验证环境：antd 6.6.7、`@ant-design/pro-layout` 7.22.7、`@ant-design/icons` 6.3.4、React 19.3.1、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/menu-adapters.test.ts` | meta.icon 优先、id 回退、未知键/继承键不解析 |
| `tests/browser/pro-layout.test.ts` | dev/build/preview 中 Home/Users 图标渲染、locale 切换后保留 |
| 安装包 `pro-layout` consumer | 安装 `@ant-design/icons`，typecheck、dev/build/preview 断言图标 |
| `pnpm check` | 569/569 |
| `pnpm test:browser` | 54/54 |
| `pnpm test:package` | 344 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u17-3-menu-icons-validation.json)。

## 5. 下一步

- U17 剩余：图表集成说明/验证、主题编辑器、ProLayout 内置文案 locale；
- 随后 F6 微前端/状态库适配，或 U09 热替换、U12 缓存持久化、U33 sitemap index、SSR 生产化。
