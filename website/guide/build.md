# 构建与部署

## 命令

```sh
pnpm cormi dev     --root my-app
pnpm cormi build   --root my-app
pnpm cormi preview --root my-app
```

- `dev`：生成、启动开发服务、Fast Refresh、配置变更重启 worker。
- `build`：生成、转译、构建，验证成功后替换受管产物。
- `preview`：只服务已有构建，不重新扫描或生成源码。
- `prepare`：只生成受管文件后退出，适合检查生成结果。
- `typecheck`：生成并检查业务源码与生成代码，不输出业务 JS。

`build` 成功不等于类型正确；CI 应分别运行 `typecheck` 与 `build`。

## 构建契约

构建先写 staging，验证成功后替换受管产物：

- `dist/.cormi-build.json` 记录本机输出归属。
- 没有该文件的旧目录不会被自动清空。
- 用户新增或修改过的文件会导致替换被拒绝。
- 失败保留上一份成功结果。
- 切换由两个目录 rename 完成，不是无间隙原子交换。

发布时只复制纯站点文件。不要把 `.cormi-build.json`、`.cormi-local/`、`.env*`、源码或 `node_modules` 放进静态目录。

## 输出策略

```ts
import { outputPlugin } from '@cormijs/plugin-react-vite'

plugins: [{
  id: 'output',
  plugin: outputPlugin,
  options: {
    hash: false,
    copy: [
      { from: 'static', to: 'extras' },
      { from: 'static/robots.txt' },
    ],
  },
}]
```

- `copy` 在构建结束后执行；`from` 必须是项目内路径，不能是 `node_modules`、`.cormi*`、`.env*` 或符号链接。
- 目标缺省为源路径的文件名。
- `hash: false` 生成稳定名称，如 `assets/index.js`；与自定义命名策略同时存在会失败。
- 开发服务器不执行复制；开发期静态文件请放 `public/`。
- preview 会提供复制后的文件。

## 单页应用部署

默认模式是浏览器挂载的 SPA。构建产物包含 `index.html`、JS/CSS 和 `public/` 资源。

部署要点：

- `app.base` 必须与部署前缀一致，例如 `/workbench/`。
- 页面导航回退到 `index.html`；缺失的 JS/CSS/图片必须返回真正的 404，不能全部回退成 HTML。
- API 路径单独转发给后端，不要套用 SPA fallback。
- 静态服务器需要正确的 MIME 类型。
- `.cormi/`、`.env` 和源码不属于发布内容。

以 `/workbench/` 为例的 NGINX 结构：

```nginx
location = /workbench { return 308 /workbench/; }
location /workbench/api/ { return 404; } # 替换为真实后端
location ~* ^/workbench/.*\.(?:js|mjs|css|svg|png|jpe?g|webp|ico|woff2?)$ {
    try_files $uri =404;
}
location /workbench/ {
    try_files $uri $uri/ /workbench/index.html;
}
```

这不是部署认证，只是静态路径规则。TLS、缓存、鉴权、日志和回滚仍需单独配置。

## 静态导出

静态导出为每个字面路径路由写一份带 `meta.head` 的 HTML 外壳：

```ts
import { staticExportPlugin } from '@cormijs/plugin-react-vite'

plugins: [{
  id: 'export',
  plugin: staticExportPlugin,
  options: {
    id: 'app:export',
    titleTemplate: ' · cormi',
    notFound: true,
  },
}]
```

```sh
pnpm cormi build --root examples/static-export
pnpm cormi preview --root examples/static-export
```

结果：

```text
dist/index.html
dist/guide/index.html
dist/404.html
```

- 每个文件带有该路由（含祖先）的 `meta.head`。
- 页面内容仍由浏览器挂载，**不是预渲染**。
- 动态段、catch-all 和 redirect 路由不会生成页面文件。
- `notFound: true` 用 catch-all 路由的 head 生成 `404.html`。
- 不要与 `ssrPlugin.prerender` 同时启用；两者都会写 HTML 外壳。

静态导出适合让爬虫和社交抓取拿到每页标题，同时保持纯静态托管。

## 预渲染与 sitemap

```ts
import { ssrPlugin } from '@cormijs/plugin-react-vite'

plugins: [{
  id: 'ssr',
  plugin: ssrPlugin,
  options: {
    id: 'app:ssr',
    prerender: true,
    prerenderPaths: ['/users/1', { path: '/users/2', lastmod: '2026-10-20' }],
    prerenderConcurrency: 2,
    prerenderIncremental: true,
    prerenderIgnoreErrors: false,
    sitemap: 'https://example.com',
    sitemapChunkSize: 1000,
    sitemapLastmod: '2026-10-28',
    sitemapGzip: true,
    robots: 'User-agent: *\nAllow: /\nSitemap: {{sitemap}}\n',
  },
}]
```

```ts
export default defineConfig({
  presets: [reactVite],
  plugins: [{ id: 'ssr', plugin: ssrPlugin, options: { id: 'app:ssr' } }],
  app: { ssr: true },
})
```

预渲染用同一 SSR bundle 渲染字面路由，执行 clientLoader/serverLoader，写入首屏标记、hydration 数据和 head。

- `prerenderPaths` 枚举动态路径；可以传函数（支持异步），每个条目可写 `lastmod`、`alternates`，或 `prerender: false` 跳过。
- `prerenderConcurrency` 为 1–16，默认 1。
- `prerenderIncremental` 在内容未变化时保留旧 HTML。
- `prerenderIgnoreErrors` 只跳过渲染失败的页面，并在日志中列出 skipped 路由；默认失败构建。
- loader 返回 `Response` 或状态 ≥ 400 的页面会跳过。
- `sitemap` 需要绝对站点 origin；生成时带 `app.base`。
- `sitemapChunkSize` 分片并生成 `sitemap-index.xml`。
- `meta.lastmod` 可按页覆盖默认 lastmod，`meta.alternates` 输出 hreflang/x-default。
- `sitemapGzip` 输出 `.gz` 副本，robots 仍指向未压缩入口。
- `robots` 中的 `{{sitemap}}` 会替换为绝对 sitemap URL。

## SSR

```ts
import { defineConfig } from 'cormijs'
import reactVite from '@cormijs/preset-react-vite'
import { ssrPlugin } from '@cormijs/plugin-react-vite'

export default defineConfig({
  presets: [reactVite],
  plugins: [{
    id: 'ssr',
    plugin: ssrPlugin,
    options: {
      id: 'application:ssr',
      mountId: 'root',
      streaming: false,
    },
  }],
  app: {
    ssr: true,
    server: { port: 0 }, // 0 选择空闲端口，不固定 5173
  },
})
```

行为：

- `dev` 与 `preview` 的 HTML 导航由 static handler 服务端渲染，并注入 hydration 数据；客户端 `hydrateRoot` 接管。
- 服务端同时输出路由 `meta.head` 与 `<Helmet>` 的 title/meta/link/JSON-LD。
- `build` 额外产出 `dist/.cormi/ssr/ssr.mjs`。
- hydration 前只预解析当前匹配链，其他页面仍按需加载。
- `app.base` 前缀由服务端剥离，并与客户端 basename 对齐。

### serverLoader

```ts
{
  path: 'member/:id',
  component: './src/Member.tsx',
  serverLoader: 'serverLoader',
}
```

```tsx
export async function serverLoader({ params }: { params: Record<string, string | undefined> }) {
  return { id: params.id }
}
```

```tsx
import { useServerLoaderData } from '@cormijs/runtime'

const data = useServerLoaderData<{ id: string }>()
```

serverLoader 只在服务端执行，结果写入 hydration；客户端导航通过 `<base>.cormi/server-loader` 取数。它不能访问浏览器 API。

### 流式渲染

`streaming: true` 时 dev/preview/serve 使用 React 流式渲染，Suspense 边界继续流入，hydration 脚本放在挂载根之外。

SSR 仍处于首个切片：不承诺按请求 locale、复杂缓存或所有第三方库的服务端兼容。

## MPA

```ts
import { mpaPlugin } from '@cormijs/plugin-react-vite'

plugins: [{ id: 'mpa', plugin: mpaPlugin }]
```

目录结构：

```text
src/pages/
├─ index.tsx          # 保留给 SPA
├─ home/
│  ├─ index.tsx       # → /home.html
│  └─ config.json     # 可选页面配置
└─ about/
   └─ index.tsx       # → /about.html
```

```json
// src/pages/home/config.json
{
  "title": "Home page",
  "mountElementId": "app",
  "layout": "src/HomeLayout.tsx"
}
```

- `src/pages` 顶层目录即页面；`index` 保留给 SPA。
- 每个页面是独立 React 根。
- layout 只包裹 children，不注入 SPA Provider。
- `template` 可指定项目内 HTML 模板，需要 `{{mountElementId}}` 与 `{{entry}}` 占位符。
- 插件选项 `directory`、`mountElementId`、`layout`、`template` 提供默认值，页面 `config.json` 优先。
- dev/build/preview 均可用；新增/删除页面需要重启开发服务。

## 独立生产服务

```ts
import { servePlugin } from '@cormijs/plugin-react-vite'

plugins: [{
  id: 'serve',
  plugin: servePlugin,
  options: { id: 'application:serve', port: 4173, base: '/' },
}]
```

```sh
pnpm cormi build --root my-app
pnpm cormi serve --root my-app
```

`serve` 读取 `dist/index.html` 与 `dist/.cormi/ssr/ssr.mjs`：

- HTML 导航执行 SSR/hydration。
- 其他请求按 `dist` 白名单提供静态文件。
- 支持 `host`、`port`、`outDir`、`base`、`mountId`、`streaming`。
- 不执行 API 路由、Mock 或代理；没有压缩、流式响应或 TLS。

## 限制

- 单入口 rename 不是多文件事务；业务源码不会回滚。
- 构建成功不证明类型正确；typecheck 必须单独执行。
- 静态导出是外壳，不是预渲染；需要内容时用 `prerender`。
- SSR 不覆盖所有第三方库、按请求 locale 或长期缓存。
- `cormi serve` 不是生产网关；鉴权、TLS、压缩和日志需要外部实现。

下一步：[生成器](/guide/generators)。
