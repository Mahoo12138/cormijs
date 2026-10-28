# 项目结构

一个 cormi 应用由 **Node 侧配置**、**浏览器侧运行时**、**约定源码** 和 **生成目录** 四部分组成。

```text
my-app/
├─ cormi.config.ts        # Node 侧配置：preset、插件、app 选项
├─ index.html             # HTML 模板，应用自己维护
├─ tsconfig.json
├─ public/                # 原样复制的静态资源
├─ src/
│  ├─ app.tsx             # 浏览器运行时入口（需显式启用）
│  ├─ pages/              # 页面约定
│  │  ├─ index.tsx
│  │  ├─ about.tsx
│  │  ├─ users/[id].tsx
│  │  ├─ _layout.tsx
│  │  └─ 404.tsx
│  ├─ layouts/index.tsx   # 全局布局（需 layoutPlugin）
│  ├─ loading.tsx         # 首次加载回退（需 loadingPlugin）
│  ├─ models/             # model 约定（需 modelPlugin）
│  ├─ locales/            # 消息目录（需 localePlugin.directory）
│  ├─ access.ts           # 权限约定（需 accessPlugin）
│  ├─ api/                # Fetch API 路由（需 apiRoutePlugin）
│  ├─ global.css          # 全局样式（需 globalStylePlugin）
│  ├─ assets.d.ts         # 资源与 CSS Modules 声明
│  └─ style.css
├─ mock/                  # 开发期 Mock（需 mockPlugin）
├─ .cormi/                # 生成目录，不要手改
└─ dist/                  # 构建产物
```

## 四个边界

### `cormi.config.ts`：Node 侧

配置在独立的 Node worker 中求值，可以使用 `node:fs`、读取环境变量、创建 Cordis 插件。它不会执行 `src/app.tsx` 或页面源码。

```ts
import { defineConfig } from 'cormijs'
import reactVite from '@cormijs/preset-react-vite'
import { appRuntimePlugin, modelPlugin, requestPlugin } from '@cormijs/plugin-react'

export default defineConfig({
  presets: [reactVite],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'model', plugin: modelPlugin, options: { id: 'app:model' } },
    { id: 'request', plugin: requestPlugin, options: { id: 'app:request' } },
  ],
  app: {
    base: '/',
    outDir: 'dist',
    server: { host: '127.0.0.1', port: 8000 },
  },
})
```

配置也可以写成工厂函数，以便读取本次启动快照：

```ts
export default defineConfig(({ env, command, mode }) => ({
  app: { base: mode === 'staging' ? '/staging/' : '/' },
}))
```

`env` 可能包含私有值，**不要整体展开到 `app`、runtime options、路由 meta 或 console.log**。

### `src/app.tsx`：浏览器侧

`src/app.tsx` 是浏览器运行时配置，不是 Node 配置，也不是页面组件。它需要显式启用 `appRuntimePlugin` 才会被发现。可以在这里声明首屏异步初始化、根容器、路由调整、初始状态、请求、locale 和权限函数。

完整生命周期见[应用运行时](/guide/app-runtime)。

### `src/` 约定：按需启用

基础路由扫描始终存在；其余约定都需要挂载对应插件。这样普通 React 文件不会被静默解释成框架配置。

| 约定 | 默认位置 | 启用方式 |
| --- | --- | --- |
| 页面与目录布局 | `src/pages/**` | 基础路由扫描 |
| 目录内布局 | `src/pages/**/_layout.tsx` | 基础路由扫描 |
| 根 404 | `src/pages/404.tsx` | 基础路由扫描 |
| 全局布局 | `src/layouts/index.tsx` | `layoutPlugin` |
| 首次加载回退 | `src/loading.tsx` | `loadingPlugin` |
| 模型 | `src/models/**` | `modelPlugin` |
| 权限函数 | `src/access.ts` | `accessPlugin` |
| 消息目录 | `src/locales/<locale>.json` | `localePlugin` 的 `directory` |
| API 路由 | `src/api/**` | `apiRoutePlugin` |
| Mock | `mock/**` | `mockPlugin` + DevApi Vite bridge |
| 全局样式 | `src/global.css` 等 | `globalStylePlugin` |
| 浏览器运行时 | `src/app.tsx` | `appRuntimePlugin` |

显式设置 `app.routes` 会关闭 `src/pages` 约定扫描；此时使用配置式路由，或由插件贡献路由 IR。

### `src/pages` 的命名规则

| 文件 | URL |
| --- | --- |
| `src/pages/index.tsx` | `/` |
| `src/pages/about.tsx` | `/about` |
| `src/pages/docs/index.tsx` | `/docs` |
| `src/pages/users/[id].tsx` | `/users/:id` |
| `src/pages/files/[...path].tsx` | `/files/*` |
| `src/pages/_layout.tsx` | 当前目录的布局 |
| `src/pages/404.tsx` | 根级 catch-all |

布局必须渲染 `<Outlet />`。页面内使用从 `@cormijs/runtime` 重新导出的 `Link`、`useNavigate`、`useSearchParams`，不要创建第二个 Router 或 React root。

## `.cormi/` 生成目录

`.cormi` 由 `prepare`、`dev`、`build`、`typecheck` 维护。**不要手改**，也不要把整个目录当作源码提交为业务实现。

| 文件 | 内容 |
| --- | --- |
| `.cormi/app.tsx` | 浏览器入口：导入运行时、路由、Provider、全局样式 |
| `.cormi/routes.d.ts` | 路由 id、参数与路径类型 |
| `.cormi/loaders.d.ts` | `CormiLoaderData.Data<'route-id'>` 的 loader 返回类型 |
| `.cormi/locale.d.ts` | `CormiLocale.Code` 与 `MessageKey` |
| `.cormi/styles.d.ts` | `styleTypesPlugin` 生成的 CSS Modules / 资源类型 |
| `.cormi/inspect.jsonc` | 上一次成功生成的快照，`cormi inspect` 读取它 |
| `.cormi/api/` | 构建后的 API 处理器 |
| `.cormi/ssr/` | 构建后的 SSR bundle |

生成的 `.d.ts` 是环境声明，不需要 import。创建器模板的 `tsconfig.json` 会把 `.cormi/**/*` 纳入 include；如果使用 TypeScript project references，需要把生成文件明确归到浏览器项目，详见[配置](/reference/config#typescript-项目)。

`.cormi/inspect.jsonc` 是**上一次成功生成**的结果，而不是当前源码的实时状态。源码改动后还没有重新生成时，`inspect` 不会发现。

## `dist/` 与所有权

构建先写 staging，验证成功后替换受管产物。`dist/.cormi-build.json` 记录本机输出归属：

- 没有该文件的旧目录不会被自动清空。
- 用户新增或修改过的文件会导致替换被拒绝。
- 失败时保留旧结果；切换由两个目录 rename 完成，但不是无间隙原子交换。

发布时只复制纯站点文件。不要把 `.cormi-build.json`、`.cormi-local/`、`.env*`、源码或 `node_modules` 放进静态目录。

## 其他目录

- `public/`：构建时原样复制；开发期由 Vite 提供。开发期需要的静态文件放这里，而不是依赖 `outputPlugin` 的复制。
- `mock/`：只在开发期生效，生产预览不提供。
- `src/api/`：开发、构建、预览都能提供，构建后编译进 `dist/.cormi/api`。
- `features/`：不是框架约定，是示例中自定义 Cordis 插件的位置；需要在配置里显式挂载。

下一步：[路由](/guide/routing)。
