# 构建与运行时插件

这些插件构成 React–Vite preset 和可选应用能力。它们的公共契约是 `ctx.react.*`、`ctx.vite`、`ctx.commands` 与原生 Cordis 作用域。

## 核心 React 插件

### `reactPlugin`

```ts
import { reactPlugin } from '@cormijs/plugin-react'
```

- `name: cormi:react`
- 无 `inject`
- 提供 `ctx.react`：`routes`、`runtime`、`appConfig`、`layouts`、`loading`、`styles`、`access`、`locale`、`models`、`styleTypes`、`onManifest`

它只负责 React 编译服务，不导入 Vite。物理独立消费者可以在没有 Vite 的宿主中使用它准备入口。

### `appRuntimePlugin`

| 选项 | 说明 |
| --- | --- |
| `files` | 应用运行时候选文件，默认 `src/app.{ts,tsx,js,jsx}` |

提供 `defineApp` 文件约定；它与 `initialStatePlugin`、`requestPlugin`、`localePlugin`、`accessPlugin` 等配合。

### `routeConfigPlugin`

| 选项 | 说明 |
| --- | --- |
| `id` | 必填的贡献 id |
| `stage` | 排序阶段，默认 0 |
| `routes` | 嵌套 `ConfigRoute[]` |

展开为扁平 RouteRecord IR，随 `ctx.react.routes` 撤回。

### `layoutPlugin` / `loadingPlugin` / `globalStylePlugin`

| 插件 | 选项 | 契约 |
| --- | --- | --- |
| `layoutPlugin` | `id`、`files` | 一个全局布局，必须渲染 `<Outlet />` |
| `loadingPlugin` | `id`、`files` | 一个首次加载回退组件 |
| `globalStylePlugin` | `id`、`files` | 每个贡献取一个全局样式文件 |

多个实际候选会以 `LAYOUT_CONFLICT` / `LOADING_CONFLICT` 失败。

## 数据与应用能力

| 插件 | 主要选项 | 贡献 |
| --- | --- | --- |
| `modelPlugin` | `id`、`dir`、`files`、`extraModels` | 模型发现与模型描述 |
| `initialStatePlugin` | `id` | `getInitialState` key + Provider |
| `requestPlugin` | `id` | `request` key + 客户端 Provider |
| `localePlugin` | `id`、`directory` | locale Provider、消息目录、类型 |
| `accessPlugin` | `id`、`files` | `access` key、守卫、403 |
| `menuPlugin` | `id`、`collapse` | 菜单/面包屑/选中/折叠 Provider |
| `headPlugin` | `id`、`titleTemplate`、`baseTitle`、`auto` | 路由 head 同步、Helmet |
| `routePrefetchPlugin` | `id`、`mode` | 路由模块注册表与预取 |
| `analyticsPlugin` | `id`、`measurementId`、`eventName`、`dispatch` | pageview 事件 |
| `generatorPlugin` | `id`、`templates` | `generate` 命令 |
| `styleTypesPlugin` | `id` | `.cormi/styles.d.ts` |
| `toolPlugin` | `lint`、`format` | `lint` / `format` 命令包装 |

`menuPlugin` 的 `collapse` 支持 `storageKey` 与 `defaultCollapsed`。`generatorPlugin` 最多 16 个自定义模板。`analyticsPlugin` 的 `measurementId` 必须匹配 `G-...`。

## React–Vite 桥接

`@cormijs/plugin-react-vite` 是 React 与 Vite 的唯一桥接。

### `reactVitePlugin`

- 安装 `@vitejs/plugin-react`
- 设置 React dedupe 与预打包
- 阻止 Node 专用模块进入浏览器
- 提供客户端边界

### `htmlPlugin`

选项：`title`、`lang`、`favicon`、`metas`、`links`、`headScripts`、`scripts`。

对 `index.html` 做确定性变换；不接管作者标签。

### `aliasPlugin`

选项：`aliases`、`builtins`。

- 别名值必须是项目内相对路径。
- `builtins: true` 提供 `@` → `src`。
- 不修改 tsconfig。

### `definePlugin`

选项：`values`。

按 JSON 字面量替换；拒绝保留根标识符与嵌套 key。

### `outputPlugin`

选项：`copy`、`hash`。

构建结束后复制项目文件；`hash: false` 使用稳定资源名。

### `staticExportPlugin`

选项：`id`、`titleTemplate`、`notFound`。

为字面路由写 HTML 外壳；不是预渲染。

### `apiRoutePlugin`

选项：`id`、`directory`、`prefix`。

把 `src/api/**` 映射为 Fetch 路由；构建时编译到 `.cormi/api`。

### `mpaPlugin`

选项：`id`、`directory`、`mountElementId`、`layout`、`template`。

每个顶层页面目录生成独立 HTML 与 React 根。

### `proxyPlugin`

选项：`id`、`proxy`。

开发与预览的 Vite 代理；不进入构建产物。

### `ssrPlugin`

| 选项 | 说明 |
| --- | --- |
| `id`、`mountId` | 插件 id 与挂载元素 |
| `prerender` | 构建后预渲染字面路由 |
| `prerenderPaths` | 额外路径或异步路径生产者 |
| `prerenderIgnoreErrors` | 跳过失败页面 |
| `prerenderIncremental` | 内容未变时保留旧 HTML |
| `prerenderConcurrency` | 1–16，默认 1 |
| `robots` | 写入 robots.txt，支持 `{{sitemap}}` |
| `sitemap` | 绝对站点 origin |
| `sitemapChunkSize` | 分片大小，1–50000 |
| `sitemapLastmod` | 默认 lastmod |
| `sitemapGzip` | 生成 `.gz` 副本 |
| `streaming` | 使用 React 流式渲染 |

需要 `app.ssr: true`。

### `servePlugin`

选项：`id`、`mountId`、`host`、`port`、`outDir`、`base`、`streaming`。

读取已有构建产物；不执行 API 路由、Mock 或代理。

## 开发服务

### `mockPlugin` + `devApiVitePlugin`

`mockPlugin` 选项：`id`、`dir`、`files`、`prefix`、`intervalMs`。

- 默认目录 `mock`、prefix `/api`、间隔 200ms。
- 仅在开发期提供；生产预览不执行 Mock。
- 值是对象或返回对象的函数。

`devApiVitePlugin` 安装 Vite 中间件；没有它，Mock 规则不会被服务。

### `typescriptPlugin`

选项：`generatedProject`。

- 组合 `typescriptServicePlugin` 与 `typecheckCommandPlugin`。
- 支持普通 noEmit 项目和 solution / project references。
- 生成根必须有唯一所有者，否则明确要求 `generatedProject`。

## 内核包

| 包 | 契约 |
| --- | --- |
| `@cormijs/core` | `ProjectRuntime`、`DiagnosticService`、命令协议、`CormiError` |
| `@cormijs/builder` | `BuildPlan`、`ServerHandle`、`DevelopmentState` |
| `@cormijs/routes` | `RouteRecord`、`ConfigRoute`、约定扫描、校验 |
| `@cormijs/plugin-web` | `ctx.web`、`ctx.application`、`OrderedHooks`、受管发布 |
| `@cormijs/plugin-vite` | `ctx.vite` 构建 provider |

core 不包含 React 或 Vite 特判；这些知识在各自插件中。

## 替换与撤回

替换一个能力时，先确认消费者只依赖公共契约：

```ts
// 消费者：只声明 inject
const consumer: Plugin.Object = {
  name: 'example:consumer',
  inject: ['react'],
  apply(ctx) {
    ctx.effect(() => ctx.react.routes.tap({ /* ... */ }))
  },
}
```

测试中关闭或替换提供者，验证：

- 消费者不会回退到假实现。
- 卸载后贡献消失。
- 资源释放只发生一次。
- 新提供者的作用域独立。

“文件在 plugin 目录”不算可替换；必须验证独立消费和替换。

## 限制

- Vite 是唯一真实构建后端；可替换测试 provider 不表示其他构建器原生兼容。
- 未挂载的插件不会提供对应命令或生成贡献。
- 插件卸载不会回滚已经写入 `dist` 的文件。
- 配置和 Node 插件变更会重启 worker，不是进程内热替换。

下一步：[UI 与状态插件](/plugins/ui)。
