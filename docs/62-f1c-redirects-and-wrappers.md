# cormi F1c：redirect、keepQuery 与路由 wrappers

日期：2026-10-20。基于路线提交 `a802e4b` 的工作区（F1a/F1b/F1c 尚未提交）。本切片交付 Umi U05 的前两项：配置路由的 `redirect`/`keepQuery` 与 `wrappers`。两者仍由 `routeConfigPlugin` 展开为既有扁平 `RouteRecord` IR，不引入第二套路由系统。`layout: false` 未交付：cormi 当前没有全局 layout，它应在 U06/F3 的全局布局能力中实现，而不是现在接受一个无效果字段。

## 1. 使用方式

继续使用 F1b 的显式 `routeConfigPlugin`，在 `src/app-routes.ts` 中声明：

```ts
import type { ConfigRoute } from '@cormijs/plugin-react';

export const routes: readonly ConfigRoute[] = [{
  id: 'shell',
  path: '/',
  component: './src/layouts/Shell.tsx',
  routes: [
    { index: true, component: './src/pages/Home.tsx' },
    {
      path: 'about',
      component: './src/pages/About.tsx',
      wrappers: ['./src/wrappers/Trace.tsx', './src/wrappers/Gate.tsx'],
    },
    { path: 'legacy/:id', redirect: '/team/:id' },
    { path: 'search', redirect: '/about', keepQuery: true },
    {
      path: 'team/:id',
      component: './src/pages/team/Member.tsx',
      errorBoundary: './src/pages/team/MemberError.tsx',
    },
  ],
}];
```

```ts
// cormi.config.ts
import { routeConfigPlugin } from '@cormijs/plugin-react';
import { routes } from './src/app-routes';

export default defineConfig({
  presets: [reactVite],
  plugins: [{ id: 'application-routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } }],
  app: { routes: [] }, // 显式路由模式：关闭 src/pages 约定扫描
});
```

`redirect`/`keepQuery` 是配置字段，展开后写入低层 `RouteRecord` 的同名字段，直接贡献 IR 的插件也可使用；`wrappers` 是配置展开概念，展开后就是普通父路由记录，不需要新增 IR 字段。

## 2. redirect 与 keepQuery

| 字段 | 规则 |
| --- | --- |
| `redirect` | 内部绝对 URL 路径，必须以单个 `/` 开头；拒绝 `//host`、相对路径、反斜杠、控制字符和超过 512 字符的值。目标可带查询串或 hash |
| `keepQuery` | 可选布尔值，只能与 `redirect` 同时出现；为 `true` 时，目标自身不能再带 `?` 或 `#` |

重定向路由不能同时声明 `component`、`errorBoundary`、`routes` 或 `wrappers`；它必须有 `path` 或 `index: true`。顶层 `{ path: '/', redirect: '/home' }` 没有子级时按 index 展开，例如 ID 为 `config:root:index`。

目标路径中的 `:name` 必须能从该路由的完整路径（含父级参数）解析；未知参数在展开阶段直接失败：

```ts
{ path: 'legacy/:id', redirect: '/team/:id' }      // 合法：id 来自当前路由
{ path: 'legacy/:id', redirect: '/team/:missing' } // ROUTE_REDIRECT_INVALID
{ path: 'search', redirect: '/about', keepQuery: true } // 合法
{ path: 'search', redirect: '/about?tab=all', keepQuery: true } // 拒绝：目标已有查询串
```

生成入口为存在 `redirect` 的路由输出急切的 `element:<RedirectRoute .../>`，不加载页面组件。运行时 `RedirectRoute`：

1. 用 `useParams()` 读取当前匹配参数；
2. 用 `generatePath(to, params)` 生成目标；
3. `keepQuery: true` 时追加当前 `location.search + location.hash`；
4. 渲染 `<Navigate replace>`。

因此重定向是**路由匹配后的浏览器渲染行为**，不是服务器 3xx，也不是 loader 级重定向。`replace` 不留下重定向源的历史条目：示例从首页进入 `/legacy/alpha` 后落到 `/team/alpha`，浏览器后退直接回到首页，而不是 `/legacy/alpha`。`keepQuery` 在重定向发生时的 location 上取值；示例 `/search?q=alpha#hits` 落到 `/about?q=alpha#hits`。

## 3. wrappers

`wrappers` 是外层到内层的组件文件数组，最多 32 项；每项规则与 `component` 相同：项目相对、带运行时源码扩展名、默认导出组件。每个 wrapper 必须用 `<Outlet />` 渲染下一层；cormi 不执行组件，因此无法静态验证 Outlet，这一点与 Umi 相同。

展开结果直接使用既有 IR。以 `about` 为例：

| 记录 ID | 父级 | path | 模块 |
| --- | --- | --- | --- |
| `config:about:wrapper:1` | `shell` | `about` | `Trace.tsx` |
| `config:about:wrapper:2` | `config:about:wrapper:1` | `''` | `Gate.tsx` |
| `config:about` | `config:about:wrapper:2` | `''` | `About.tsx` |

规则：

- 第一个 wrapper 拥有原路由的 URL path，后续 wrapper 和真实页面使用空路径；页面因此位于 wrapper 链末端；
- index 路由的 wrapper 链从无路径布局开始，真实页面记录为 `index: true`；
- wrapper ID 固定为 `<route id>:wrapper:<序号>`，冲突会以 `ROUTE_ID_CONFLICT` 失败；
- 因为第一个 wrapper 拥有路径，wrapper 内可用 `useParams()` 读取动态参数；示例中 `/team/alpha` 的 `Trace` 读到 `id=alpha`；
- 有子路由时，子路由仍以真实页面记录为父级，wrapper 只是页面之上的额外布局层；
- 路由的 `errorBoundary` 仍在真实页面记录上；wrapper 是父路由，不自动获得页面边界；
- catch-all 路由不能声明 wrappers。展开器明确拒绝，而不是生成无法正确匹配的路径链；
- 重定向路由不能声明 wrappers。

wrapper 组件和页面一样按需懒加载，不进入 Node 生成阶段执行。`inspection.summary.routes` 能看到 wrapper 记录及其 `parentId/path/module`，`routes.d.ts` 也会包含 wrapper ID 与对应参数类型。

## 4. 与既有 IR、生成和插件生命周期的关系

- `RouteRecord` 新增可选 `redirect`、`keepQuery`；`validateRoutes` 继续是所有来源的统一校验入口，直接贡献 IR 的插件也受同样约束；
- `ConfigRoute` 新增 `redirect`、`keepQuery`、`wrappers`；`expandRouteConfig` 在插件 apply 时一次性展开并校验；
- 生成器仅在存在 redirect 时 import `RedirectRoute`；wrapper 与页面都通过既有 `resolveRouteComponent` 懒加载；
- route types、inspect、生成队列、开发 watcher 和产物替换没有分叉；
- `routeConfigPlugin` 仍是 `inject: ['react']` + `ctx.effect(() => ctx.react.routes.tap(...))`；卸载时全部 wrapper/重定向记录随 hook 撤回；
- 修改 `src/app-routes.ts` 仍按 Node 配置更新（worker 重启）生效；修改 wrapper/页面源码走 Vite/Fast Refresh。

## 5. 与 Umi 4 的差异

参考 `references/umi`（HEAD `2d368e378d10831e7a56b6eaa6e2ae705b1f3c78`，`packages/umi/package.json` 4.7.25）：

- `packages/renderer-react/src/routes.tsx` 的 `NavigateWithParams` 使用 `useParams` + `generatePath`，按 route props 的 `keepQuery` 追加 `location.search + location.hash`，并渲染 `<Navigate replace>`；
- `packages/core/src/route/routesConfig.ts` 把 wrappers 逐层转成额外父路由：第一个 wrapper 拿原 path，后续 wrapper 用空路径，真实页面路径置空，并记录 `originPath`。

| 方面 | Umi | cormi F1c |
| --- | --- | --- |
| redirect 执行层 | React renderer 的 `<Navigate replace>` | 生成 `RedirectRoute`，同样 `generatePath` + replace |
| keepQuery 来源 | route props | 配置字段，生成时传给 `RedirectRoute` |
| redirect 校验 | 配置/渲染层自行处理 | 只接受内部绝对路径，并校验参数与 keepQuery 组合 |
| wrapper 路径归属 | 首个 wrapper 拥有 path，后续与页面为空 | 相同 |
| wrapper 顺序 ID | 遍历顺序数字 ID | `<route id>:wrapper:N` |
| catch-all wrapper | 用 `*` 继续 wrapper 链 | 明确拒绝 |
| originPath | 记录供 layout 使用 | 未记录；cormi 尚无全局 layout |
| `layout: false` | 仅退出全局 layout | 未实现，且当前会被当作未知字段拒绝 |
| 约定 wrappers | 约定路由也支持 | 仅配置式声明 |
| 类型/别名 | 支持别名、省略扩展名 | 项目相对源码文件且必须带运行时扩展名 |

本切片不承诺 Umi 路由配置的二进制兼容，也不引入 Umi PluginAPI。

## 6. 错误、限制与生命周期

- `ROUTE_REDIRECT_INVALID`：目标非内部绝对路径、keepQuery 非布尔、keepQuery 无 redirect、keepQuery 与目标查询串/hash 冲突、目标引用未知参数、重定向同时声明页面/错误边界/子路由/wrappers、redirect 无 path/index；
- `ROUTE_CONFIG_INVALID`：wrappers 为空、超过 32 项、模块路径非法、wrapper 包裹 catch-all、wrapper ID 过长；
- `ROUTE_ID_CONFLICT`：显式路由 ID 与自动 wrapper ID 冲突；
- `ROUTE_PARENT_MISSING`、`ROUTE_PATH_INVALID` 等既有校验继续生效；
- 单次展开上限仍为 10000 条、嵌套深度 64；wrapper 数量限制为每路由 32；
- 展开错误使本次生成失败，上一次有效产物不被替换；插件卸载后下一次编译不再包含其 redirect/wrapper 记录；
- 没有为路由声明增加进程内热替换，也没有新增服务器重定向、loader 重定向或全局布局语义。

## 7. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/route-config.test.ts`（配置展开/校验/生成/插件生命周期） | 10/10（F1b 为 6，新增 4 项 redirect/keepQuery/wrappers 契约） |
| 真实应用浏览器验收（dev、组件更新、typecheck、build、preview） | 1/1 |
| `pnpm check` | 449/449，0 失败/取消/跳过（F1b 为 445，新增 4 项；约 111 秒） |
| `pnpm test:browser` | 23/23，0 失败/取消/跳过（用例数不变，config-routes 用例增加重定向/wrapper 断言；约 253 秒） |
| `pnpm test:package` | 117 阶段满足预期（阶段数不变；config-routes fixture 与公开类型覆盖新字段） |
| `examples/config-routes` prepare + typecheck | 退出 0；生成清单 owner/pluginId 为 `application:routes` |

浏览器用例覆盖：

- `/legacy/alpha` 按参数重定向到 `/team/alpha`，后退回到首页而不是旧路径；
- `/search?q=alpha#hits` 保留查询串和 hash 到 `/about`；
- About 的外层 `Trace`、内层 `Gate` 按声明顺序嵌套，真实页面位于最内层；
- 成员路由的 wrapper 在 `/team/alpha` 读到 `id=alpha`；
- 重定向与 wrapper 加入后，错误边界、深链刷新、未知路径 404 和开发无错误覆盖仍通过。

最终复跑目录为 `.cache/f1c-final`；独立打包结果为 `.cache/package-test-1792476105299/result.json`，同目录的 `config-routes-preview.png` 是实际生产预览截图；浏览器用例的开发/生产截图写入 `.cache/f1c-config-routes-dev.png` 与 `.cache/f1c-config-routes-preview.png`。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f1c-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 8. 下一步

- U05 剩余：`layout: false` 与全局 layout 一起设计，避免提供无效果字段；
- U06：可选择的 404/loading 约定，保持默认 404 与懒加载语义；
- U07：browser/hash/memory history 选择与公共导航/查询入口；
- F2：在 F1a 运行时入口上登记 model/initial-state/request 的 key 与 Provider。
