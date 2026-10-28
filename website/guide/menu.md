# 菜单与面包屑

`menuPlugin` 从实际挂载的路由树和 `meta` 生成菜单数据。它只提供数据 Hook，不提供具体的侧边栏组件；外壳由应用或 UI 集成包实现。

```ts
import { menuPlugin } from '@cormijs/plugin-react'

plugins: [
  { id: 'application-menu', plugin: menuPlugin, options: { id: 'application:menu' } },
]
```

## 路由 meta

```ts
{
  path: 'admin',
  component: './src/pages/Admin.tsx',
  access: 'canAdmin',
  meta: {
    title: '管理',
    order: 3,
    icon: 'dashboard',
    access: 'canAdmin',
  },
}
```

| 字段 | 说明 |
| --- | --- |
| `title` / `name` | 菜单标题，`title` 优先 |
| `order` | 数字排序，越小越靠前 |
| `hideInMenu` / `hidden` / `menu: false` | 不在菜单中显示 |
| `access` | 权限 key；启用 access 后为 false 或缺失的项会隐藏 |
| `locale` | 消息目录 key；命中时优先于 `title` |
| `icon` | 图标 key，由外壳的图标注册表解析 |

无标题的布局路由和 wrapper 会被折叠。嵌套路由形成子菜单。

## 数据 Hook

```tsx
import { useBreadcrumb, useMenu } from '@cormijs/runtime'

const menu = useMenu()
const crumbs = useBreadcrumb()
```

`MenuItem` 的结构：

```ts
interface MenuItem {
  key: string          // 导航路径
  id: string           // 路由 id
  path: string
  title: string
  locale?: string      // meta.locale，便于外壳自行翻译
  order: number
  meta: Readonly<Record<string, unknown>>
  children: readonly MenuItem[]
}
```

`BreadcrumbItem` 包含 `id`、`pathname`、`title` 和 `meta`。

### 选中项

```tsx
import { useActiveMenuKeys } from '@cormijs/runtime'

const active = useActiveMenuKeys()
<Link to={item.path} data-active={active.includes(item.key) ? 'true' : undefined}>
  {item.title}
</Link>
```

根路径 `/` 精确匹配，其他路径使用 `matchPath(..., { end: false })`。返回值包含当前项和活动祖先的 key。

### 折叠状态

```ts
plugins: [{
  id: 'application-menu',
  plugin: menuPlugin,
  options: {
    id: 'application:menu',
    collapse: { storageKey: 'app:menu:collapsed', defaultCollapsed: false },
  },
}]
```

```tsx
import { useMenuCollapse } from '@cormijs/runtime'

const { collapsed, setCollapsed, toggle } = useMenuCollapse()
```

折叠状态独立于菜单树；配置了 `storageKey` 时会尽力持久化到 `localStorage`。

## 标题国际化

标题解析顺序：

```text
meta.locale（消息目录命中）→ meta.title → meta.name
```

```ts
// 路由
meta: { locale: 'menu.admin', order: 2 }

// src/locales/zh-CN.json
{ "menu.admin": "管理后台" }
```

未命中的 key 不会被当成标题显示。需要手动翻译时，`MenuItem.locale` 保留了原始 key。

## 权限过滤

启用 `accessPlugin` 后，`meta.access` 为 false 或缺失的菜单项会隐藏。它只是显示层过滤，**不是路由守卫**；真正的访问控制应同时在路由上声明 `access` 或使用 `Access` 组件。详见[权限](/guide/access)。

## Antd 与 ProLayout 适配

适配器不引入 antd 或 ProLayout，只做结构转换：

```tsx
import { toAntdMenuItems, useMenu, useNavigate } from '@cormijs/runtime'

const items = toAntdMenuItems(useMenu())
const navigate = useNavigate()

<Menu items={items} onClick={({ key }) => navigate(key)} />
```

```tsx
import { toLayoutRoutes } from '@cormijs/runtime'

const routes = toLayoutRoutes(useMenu(), {
  dashboard: <DashboardOutlined />,
})

<ProLayout route={{ path: '/', routes }} />
```

- `key` 为导航路径，可直接用于 `navigate(key)`。
- `label` / `name` 已本地化。
- `routeId` 保留路由 id，便于埋点或调试。
- `icon` 从 `meta.icon` 经调用方图标注册表解析，找不到时回退到路由 id。

需要完整外壳时使用 `@cormijs/plugin-antd` 的 `ProLayoutShell`，见[布局](/guide/layout#prolayout-外壳)。

## 限制

- 菜单只反映**已经挂载**的路由；插件卸载后对应项消失。
- 没有内置菜单搜索、权限指令或布局组件。
- 不提供 `meta.hideBreadcrumb` 等额外字段；需要时读取 `meta` 自行处理。

下一步：[应用运行时](/guide/app-runtime)。
