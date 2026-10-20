# cormi F1e：约定式 404 与 loading

日期：2026-10-20。本切片补齐 U06 的剩余约定：根 `src/pages/404.tsx` 自动成为终端 catch-all，显式启用的 `loadingPlugin` 发现 `src/loading.*` 并作为首次路由解析期间的加载回退。全局布局已在 [F1d](63-f1d-global-layout.md) 交付。

## 1. 使用方式

### 1.1 404

在约定式页面目录放置根级 `404.tsx` 即可：

```tsx
// src/pages/404.tsx
export default function NotFound() {
  return <main>
    <h1>页面不存在</h1>
  </main>;
}
```

它会被扫描为 `path: "*"` 的终端路由，ID 仍是 `file:src/pages/404.tsx`。未知路径匹配该页面；没有 404 文件时继续使用运行时默认 404。

规则：

- 只处理页面根目录的 `404.tsx`/`404.jsx`；`src/pages/docs/404.tsx` 仍是普通 `docs/404` 页面；
- 与 `[...rest].tsx` 等其他 catch-all 冲突时，由统一路由校验以 `ROUTE_CONFLICT` 失败；
- 设置 `app.routes` 的显式 IR/配置模式不享受此约定；需要时自行声明 `path: "*"`；
- 自定义 404 是普通顶层路由，因此会经过已启用的全局布局；运行时默认 404 仍是布局之外的最终兜底。

### 1.2 loading

显式加入 `loadingPlugin`：

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { layoutPlugin, loadingPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'application-layout', plugin: layoutPlugin, options: { id: 'application:layout' } },
    { id: 'application-loading', plugin: loadingPlugin, options: { id: 'application:loading' } },
  ],
  app: { base: '/conventions/' },
});
```

```tsx
// src/loading.tsx
export default function Loading() {
  return <p role="status">正在加载页面…</p>;
}
```

默认候选为 `src/loading.tsx`、`src/loading.jsx`、`src/loading.ts`、`src/loading.js`，可用 `options.files` 覆盖。找不到文件时使用 runtime 内置的 `Loading…`，不报错；多个实际存在的加载组件以 `LOADING_CONFLICT` 失败。

`loadingPlugin` 与 `layoutPlugin` 一样是普通原生 Cordis 插件：`inject: ['react']`，通过 `ctx.effect(() => ctx.react.loading.tap(...))` 登记，卸载即撤回。生成入口静态导入加载组件并传给 `mountApplication`；运行时把它作为根路由的 `HydrateFallback`，在首次路由及其懒加载模块解析期间显示。

**当前边界：** 该回退覆盖首次路由解析，不改变客户端导航期间 React Router 保留旧页面的行为。Umi 的每路由 `<Suspense fallback>` 语义需要配合 U13/F5 的惰性加载策略；本切片不宣称完整等价。

## 2. 展开、生成与生命周期

- `routesFromFiles` 对根级 `404` 页面生成 `path: "*"`，其余约定规则不变；
- `loadingPlugin` 的候选文件进入现有开发观察：缺失、创建、删除、替换或变为符号链接都会触发重新生成或明确错误；
- 加载组件通过 `clientSpecifier` 进入浏览器边界检查，项目外、Node-only、符号链接或隐藏目录中的文件会被拒绝；
- 生成入口包含静态加载模块 import 和 `loading` mount 选项，不在 Node 生成阶段执行组件；
- inspect 清单记录 `loading.owner/module` 与 `loading` hook；加载组件变化同样受贡献 revision 检查保护；
- 404 路由、全局布局和既有 redirect/wrapper/errorBoundary 记录继续走同一扁平 IR、生成器和校验。

## 3. 与 Umi 4 的差异

参考 `references/umi`（HEAD `2d368e378d10831e7a56b6eaa6e2ae705b1f3c78`，`packages/umi/package.json` 4.7.25）：

- `packages/preset-umi/src/features/404/404.ts` 在约定模式下把 path 为 `404` 的路由改为 `*`；
- `packages/preset-umi/src/features/appData/appData.ts` 查找 `src/loading.*`，渲染器把加载组件作为路由 `Suspense` fallback。

| 方面 | Umi | cormi F1e |
| --- | --- | --- |
| 404 发现 | 约定路由自动改写 | 根级 `src/pages/404.tsx` 自动 catch-all |
| 嵌套 404 | 取决于约定路径 | 仍为普通嵌套页面 |
| 404 与全局布局 | 由布局路由包裹 | 自定义 404 经过全局布局；默认 404 在布局外 |
| loading 发现 | 默认约定 | 显式 `loadingPlugin` |
| loading 使用时机 | 每路由 Suspense | 首次路由 `HydrateFallback`；导航期保留旧页面 |
| 多 loading | 约定只取一个 | 只允许一个实际模块，冲突失败 |

本切片不承诺 Umi 路由或渲染器的二进制兼容。

## 4. 错误、限制与生命周期

- `LOADING_INVALID`：加载贡献/选项为空、ID 非法、候选文件路径非法或重复；
- `LOADING_CONFLICT`：多个实际存在的 loading 模块同时激活；
- `CLIENT_MODULE_INVALID`：loading 候选是目录、符号链接或不可用客户端模块；
- `ROUTE_CONFLICT`：根 404 与其他 catch-all 页面冲突；
- 404 文件名约定只覆盖根级页面；显式路由模式不受影响；
- loading 候选最多 16 个文件（每个贡献），贡献最多 8 个；
- 配置/约定文件变化按 Node 配置或生成更新策略生效；组件内容仍由 Vite/Fast Refresh 处理；
- 插件卸载后，下一次编译不再包含其 loading 模块；失败生成保留上一次有效产物。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/conventions.test.ts`（404 扫描、loading 贡献/冲突/卸载） | 2/2 |
| `tests/browser/conventions.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 454/454，0 失败/取消/跳过（F1d 为 452，新增 2 项；约 103 秒） |
| `pnpm test:browser` | 24/24，0 失败/取消/跳过（F1d 为 23，新增 conventions 用例；约 248 秒） |
| `pnpm test:package` | 125 阶段满足预期（F1d 为 117，新增 8 个 conventions 阶段） |
| `examples/conventions` prepare + typecheck | 退出 0 |

浏览器验收覆盖：约定首页位于全局布局；未知路径渲染自定义 404 且仍在布局内；延迟模块首次加载时显示 `src/loading.tsx`，随后渲染页面；开发与生产预览行为一致。独立打包消费覆盖加载插件公开类型、custom 404、loading 回退和生产预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f1e-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U07 已完成：history 与公共导航/查询入口由 [F1f](65-f1f-history-and-navigation.md) 交付；
- F2：在 F1a 运行时入口上登记 model/initial-state/request 的 key 与 Provider；
- U13/F5：结合路由惰性加载补齐导航期间的 Suspense/loading 语义。
