# cormi F3d：路由级 access 守卫

日期：2026-10-20。本切片补齐 U14 的路由级权限：`ConfigRoute`/`RouteRecord` 支持 `access` key，生成器为受保护路由创建访问守卫；权限不满足时渲染内置 403，而不是加载页面。`src/access.ts` 自动发现、可定制 403/重定向和服务端授权仍未交付。

## 1. 使用方式

```ts
const routes: readonly ConfigRoute[] = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', routes: [
    {
      path: 'admin',
      component: './src/Admin.tsx',
      access: 'canAdmin',
      meta: { title: 'Admin', access: 'canAdmin' },
    },
  ],
}];
```

`access` 是 `accessPlugin` 计算的权限键。启用 `appRuntimePlugin`、`initialStatePlugin`、`accessPlugin` 与 `routeConfigPlugin` 后，直接访问 `/admin` 时：

- `access.canAdmin === true`：正常渲染页面；
- 否则渲染内置 `<AccessRoute>` 的 403 页面，不加载 Admin 组件；
- 菜单构建读取同一 key，权限不足时隐藏条目。

## 2. IR 与生成

- `RouteRecord`/`ConfigRoute` 新增可选 `access: string`；只接受合法访问键，非法值以 `ROUTE_ACCESS_INVALID`/`ROUTE_CONFIG_INVALID` 失败；
- 配置路由有 `wrappers` 时，access 写入第一个 wrapper 记录，保证守卫位于整个 wrapper 链之外；
- 生成器为受保护记录输出额外守卫路由（内部 ID `<route id>:access`）：
  - 普通 path：守卫拥有原 path，真实页面 path 为 `''`；
  - index：守卫无 path，真实页面保留 `index: true`；
  - 守卫 `element:<AccessRoute name="key"/>` 渲染 `<Outlet/>` 或 403；
- 低层 `app.routes` IR 同样支持 access；
- 菜单通过 `handle.cormi.access` 识别路由守卫并过滤；没有 `meta.access` 也可过滤；
- 路由类型继续描述应用路由，不暴露内部守卫记录。

## 3. 语义与边界

- 守卫在路由匹配后、页面模块解析前生效；403 是内联默认 UI，不跳转、不增加历史记录；
- 守卫需要 access Provider；未启用 `accessPlugin` 时 `useAccess` 明确失败；
- access 变化通过 Provider 重新渲染，已打开的受保护路由会立即显示 403；
- 403 不可定制，也没有 access fallback 路由；
- 客户端守卫只保护 UI/模块加载，不保护直接 API 调用；后端必须独立授权；
- 不提供 `src/access.ts` 自动发现、路由 access 与菜单的独立配置或 SSR 守卫。

## 4. 与 Umi 4 的差异

| 方面 | Umi | cormi F3d |
| --- | --- | --- |
| access 定义 | src/access.ts | app.tsx access 函数 |
| 路由 access | 支持 | 支持配置/IR |
| 拒绝行为 | 由项目/文档决定，常见 403 页面 | 内置 403 组件 |
| 守卫与 wrapper | 布局/权限组合 | access 传播到首个 wrapper |
| 菜单过滤 | 支持 | 支持 |
| 服务端授权 | 由后端负责 | 同样由后端负责 |

本切片不承诺 Umi 路由 access 配置或 403 行为的二进制兼容。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/route-access.test.ts`（配置/IR、wrapper 传播、非法 key） | 1/1 |
| `tests/browser/menu.test.ts`（直接访问受保护路由、升级后进入） | 通过 |
| `pnpm check` | 469/469，0 失败/取消/跳过（F3c 为 468，新增 1 项；约 102 秒） |
| `pnpm test:browser` | 32/32，0 失败/取消/跳过（menu 用例扩展 route guard；约 335 秒） |
| `pnpm test:package` | 181 阶段满足预期（menu 消费覆盖 route guard 与 403） |
| `examples/menu` prepare + typecheck | 退出 0 |

浏览器验收覆盖：user 直接访问 `/menu/admin` 得到 403 且不渲染 Admin 页面；升级为 admin 后菜单出现 Admin 并可正常导航。独立打包消费覆盖公开 ConfigRoute access 类型、菜单/守卫生成、开发、构建与静态预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f3d-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- F3e：菜单选中/折叠 helper、可定制 403 与可选 ProLayout/Antd adapter；
- F4：Mock 约定、配置/别名、HTML/head、样式与资源、微生成器等工程能力；
- access 后续：`src/access.ts` 自动发现、服务端授权边界文档与 SSR。
