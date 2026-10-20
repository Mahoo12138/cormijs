# cormi F3e：可定制 403 与菜单选中助手

日期：2026-10-20。本切片补齐 F3 的两个易用性缺口：access 路由守卫可以渲染 app 配置提供的自定义 403 组件；菜单提供 `useActiveMenuKeys`，从当前 location 计算选中项及其祖先。菜单折叠状态、ProLayout/Antd adapter 与路由级服务端授权仍未交付。

## 1. 自定义 403

```tsx
// src/app.tsx
import { defineApp } from '@cormijs/runtime';

function Forbidden() {
  return <main role="status">
    <h1>无权访问</h1>
    <p>请联系管理员开通权限。</p>
  </main>;
}

export default defineApp({
  getInitialState() { return { role: 'user' }; },
  access(state) { return { canAdmin: (state as { role?: string }).role === 'admin' }; },
  accessForbidden: Forbidden,
});
```

- `accessPlugin` 额外登记 `accessForbidden` app-config key；
- `AccessProvider` 校验它是组件（函数）并放入上下文；
- `AccessRoute` 在权限不足时渲染该组件；未提供时继续使用内置 403；
- 自定义 403 可以使用 React Hooks、locale、access 等 Provider 上下文；
- 403 仍不跳转、不增加历史记录，也不加载受保护页面模块。

## 2. 菜单选中

```tsx
import { useActiveMenuKeys, useMenu } from '@cormijs/runtime';

const items = useMenu(), active = useActiveMenuKeys();
// active 包含当前匹配项及其祖先 key；用 item.key 做样式判断
```

规则：

- 使用 React Router `matchPath({ path, end: false })` 匹配当前 pathname；
- 根项 `/` 只在 pathname 恰为 `/` 时选中；
- 子项选中会把父项 key 一并加入结果；
- 结果只包含 key，不修改菜单数据，也不保存折叠/展开状态；
- 选择逻辑对动态路径（如 `/users/:id`）使用 React Router 的匹配语义。

## 3. 与 Umi 4 的差异

| 方面 | Umi/ProLayout | cormi F3e |
| --- | --- | --- |
| 403 定制 | 项目页面/路由策略 | accessForbidden 组件 |
| 菜单选中 | ProLayout 内部 | useActiveMenuKeys |
| 折叠/展开 | UI 组件 | 尚未封装 |
| 图标/UI 渲染 | Antd/ProLayout | 菜单数据 + 应用渲染 |

仍不承诺 Umi layout 配置或 ProLayout 组件的二进制兼容。

## 4. 限制

- 未提供菜单折叠状态、受控 openKeys、选中样式组件或图标映射；
- 未提供 Antd/ProLayout adapter；
- accessForbidden 只用于路由守卫，不替换 404/error boundary；
- 客户端 403 不是服务端授权；
- 菜单匹配只基于静态路径和 React Router 参数语义，不处理外链或自定义匹配函数。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 469/469，0 失败/取消/跳过（约 105 秒） |
| `pnpm test:browser` | 32/32，0 失败/取消/跳过；menu 用例覆盖自定义 403 与选中项（约 336 秒） |
| `pnpm test:package` | 181 阶段满足预期；menu 消费覆盖自定义 403 与开发/生产预览 |
| `examples/menu` prepare + typecheck | 退出 0 |

浏览器验收覆盖：user 直接访问 `/menu/admin` 显示自定义 “Custom forbidden”；首页选中 Home；Team 页选中 Team 与 Overview；About 页仅选中 About；升级后 Admin 选中并可访问。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f3e-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- F4：Mock 约定、配置/别名、HTML/head、样式与资源、微生成器等日常工程能力，HTML head 已由 [F4a](74-f4a-html-head.md) 交付；
- menu 后续：折叠/选中 UI helper 与可选 ProLayout/Antd adapter；
- access 后续：src/access.ts 自动发现与服务端授权边界。
