# cormi U17 增量：Antd/ProLayout 菜单适配器

日期：2026-10-21。本切片为 U17 提供不绑定 UI 库的纯适配器：把 `useMenu()` 的菜单树转换为 Ant Design Menu 的 `items` 形状或 ProLayout 的 `routes` 形状。cormi 不引入 antd/ProLayout 依赖，应用仍持有 UI 库、主题、图标与路由跳转。

## 1. 使用方式

```tsx
import { Menu } from 'antd';
import { useNavigate } from '@cormijs/runtime';
import { toAntdMenuItems } from '@cormijs/runtime';

function SideMenu() {
  const navigate = useNavigate();
  const items = toAntdMenuItems(useMenu());
  return <Menu items={items} onClick={({ key }) => navigate(key)} />;
}
```

```tsx
import { toLayoutRoutes, useMenu } from '@cormijs/runtime';
const route = { path: '/', routes: toLayoutRoutes(useMenu()) };
// 传给 ProLayout 的 route 配置
```

## 2. 契约与语义

- `toAntdMenuItems(items)`：输出 `{ key, label, routeId, children? }`；`key` 为可导航的 `path`，`label` 为菜单运行时已解析的本地化标题，`routeId` 保留路由 id；
- `toLayoutRoutes(items)`：输出 `{ path, name, routes? }`，空 children 时省略 `routes`；
- 纯函数：不访问 React、DOM、Router 或 UI 库；输入顺序（menu 的 order/title 排序）保持不变；
- 输入已是 `useMenu()` 的结果：`meta.hideInMenu`、access 过滤、`meta.locale` 标题已在菜单运行时处理；
- 返回对象全部冻结；不对输入做修改；
- 退出：函数无状态，无监听器；应用卸载菜单组件即结束。

## 3. 与 Umi 4 的差异

Umi 的 layout 插件面向 ProLayout/antd 提供开箱集成；cormi 只提供结构化适配函数，应用显式安装并渲染 UI 库。

| 方面 | Umi 4 | cormi 本增量 |
| --- | --- | --- |
| 依赖 | ProLayout/antd 集成 | 无 UI 库依赖 |
| 渲染 | 框架提供布局 | 应用渲染 |
| 主题/图标 | 集成 | 未提供 |
| 图表 | 官方生态文档 | 未提供 |
| 路由跳转 | 内置 | 应用用 key/path 自行导航 |

## 4. 限制

- 不提供 Antd 组件、主题、图标、徽章或 ProLayout 的完整字段；
- 不自动绑定 `onClick`/`selectedKeys`，需应用结合 `useActiveMenuKeys()`；
- 不处理面包屑到 ProLayout 的映射（`useBreadcrumb` 可自行组合）；
- 不支持多级菜单图标、外部链接或权限按钮；
- 官方 Antd/dayjs 语言联动与图表集成仍未交付。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/menu-adapters.test.ts`（Antd items、ProLayout routes、空 children、空列表） | 2/2 |
| `pnpm check` | 546/546，0 失败/取消/跳过（F5z 系列为 544，新增 2 项） |
| `pnpm test:browser` | 52/52，0 失败/取消/跳过（无浏览器变更） |
| `pnpm test:package` | 328 阶段通过（menu consumer 新增适配器公共类型断言） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/u17-menu-adapters-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U17 后续：可选 Antd/ProLayout 集成包、主题/图标/图表与 locale 联动；
- U32：serverLoader、流式渲染；U16 dayjs 联动；
- F6 多 builder/微前端。
