# Head 与 SEO

cormi 把头部拆成三个层次：

| 层次 | 作用 | 生效时机 |
| --- | --- | --- |
| `htmlPlugin` | 修改 `index.html` 的 title、lang、meta、link、脚本 | 开发、构建、预览 |
| `headPlugin` | 按路由 `meta.head` 同步标题与元数据 | 客户端导航 |
| `<Helmet>` | 页面组件内声明头部 | 组件渲染 |

`htmlPlugin` 来自 `@cormijs/plugin-react-vite`，`headPlugin` 和 `<Helmet>` 来自 `@cormijs/plugin-react` / `@cormijs/runtime`。

## 静态 HTML

```ts
import { htmlPlugin } from '@cormijs/plugin-react-vite'

plugins: [{
  id: 'html',
  plugin: htmlPlugin,
  options: {
    title: 'cormi app',
    lang: 'zh-CN',
    favicon: '/favicon.svg',
    metas: [{ name: 'description', content: '应用描述' }],
    links: [{ rel: 'canonical', href: '/' }],
    headScripts: [
      { src: '/mark.js', defer: true },
      'window.__mark = "inline-head"',
    ],
    scripts: [{ content: 'window.__tail = "inline-body"' }],
  },
}]
```

- `index.html` 仍由应用维护，插件只做确定性的 head/body 替换与注入。
- `headScripts` 落在 `</head>` 末尾，`scripts` 落在 `</body>` 之前。
- 脚本属性只接受 `src | content | async | defer | type | charset | crossorigin`。
- 内联内容中的 `</script` 会被消解。
- 开发、构建、preview 使用同一套变换。

当前不提供每路由 HTML、CSP/nonce 或非 Vite 后端的等价实现。

## 路由级 head

```ts
import { headPlugin } from '@cormijs/plugin-react'

plugins: [{
  id: 'head',
  plugin: headPlugin,
  options: {
    id: 'app:head',
    titleTemplate: ' · cormi',
    baseTitle: 'cormi app',
  },
}]
```

```ts
{
  path: 'guide',
  component: './src/Guide.tsx',
  meta: {
    head: {
      title: '指南',
      metas: [
        { name: 'description', content: '指南页' },
        { property: 'og:title', content: '指南' },
      ],
      links: [{ rel: 'canonical', href: '/guide' }],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'cormi 指南',
      },
    },
  },
}
```

合并规则：

- 从根匹配向最深路由合并。
- 标题取最深路由；最终写入 `title + titleTemplate`。
- `metas` 按 `name` / `property` 由深覆盖浅。
- `links` 按 `rel + href` 去重。
- `jsonLd` 由最深声明整体替换。
- 同级路由互不影响。

受管节点带 `data-cormi-head`，每次导航先移除自己上一次写入的节点，不会累积，也不会删除作者写在 `index.html` 里的标签。应用卸载时恢复 `baseTitle` 或挂载时的标题。

形状校验：

- `metas` 最多 32 条，每条必须恰好有一个 `name` 或 `property`。
- `links` 最多 32 条，必须有 `rel` 和 `href`。
- 非法输入以 `HEAD_INVALID` 失败。

## Helmet

```tsx
import { Helmet } from '@cormijs/runtime'

export default function Home() {
  return (
    <>
      <Helmet
        title="Home"
        metas={[{ name: 'description', content: '首页' }]}
        jsonLd={{ '@type': 'WebPage', name: 'Home' }}
      />
      <main>...</main>
    </>
  )
}
```

`Helmet` 在路由 `meta.head` 之后按挂载顺序合并：

- 标题和 JSON-LD 后者胜。
- meta 按 `name` / `property` 替换。
- link 按 `rel + href` 替换。
- 卸载或导航时移除条目。

只接受对象 props，不支持 children 标签语法。SSR 时服务端会在渲染期间收集 `Helmet`，并写入初始 shell。

## JSON-LD

```ts
meta: {
  head: {
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Home' },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [] },
    ],
  },
}
```

- 对象或最多 32 个对象，序列化后不超过 64 KiB。
- `<` 会被转义为 `\u003c`，避免提前闭合脚本。
- 静态导出会把同一数据写入静态页面；SSR 会写入服务端 shell。

## 让爬虫看到初始 HTML

客户端 `headPlugin` **不改变构建产物的初始头部**。需要爬虫和社交抓取看到每页标题时，选择：

### 静态导出外壳

```ts
import { staticExportPlugin } from '@cormijs/plugin-react-vite'

plugins: [{
  id: 'export',
  plugin: staticExportPlugin,
  options: { id: 'app:export', titleTemplate: ' · cormi', notFound: true },
}]
```

为每个字面路径路由输出带 `meta.head` 的 HTML 外壳。页面内容仍由浏览器挂载，不是预渲染。动态段、catch-all 和 redirect 路由不会生成页面文件。`notFound: true` 会用 catch-all 路由的 head 生成 `404.html`。

### 预渲染

```ts
plugins: [{
  id: 'ssr',
  plugin: ssrPlugin,
  options: {
    prerender: true,
    prerenderPaths: ['/users/1'],
    sitemap: 'https://example.com',
    sitemapChunkSize: 1000,
    sitemapLastmod: '2026-10-28',
    sitemapGzip: true,
    robots: 'User-agent: *\nAllow: /\nSitemap: {{sitemap}}\n',
  },
}]
```

预渲染用同一 SSR bundle 渲染字面路由，执行 clientLoader/serverLoader，写入首屏标记、hydration 数据和 head。详见[构建与部署](/guide/build#预渲染)。

路由可以覆盖 sitemap 元数据：

```ts
meta: {
  lastmod: '2026-10-20',
  alternates: {
    'en-US': '/en/guide',
    'zh-CN': '/guide',
  },
}
```

`alternates` 会输出 hreflang / x-default 链接；`sitemapGzip` 生成 `.gz` 副本，但 robots 仍指向未压缩入口。

## 限制

- 路由 head 是客户端同步；需要初始 HTML 时使用静态导出或预渲染。
- 不支持 `http-equiv`、任意 meta 属性或 React 节点作为 meta content。
- `Helmet` 不支持 children 标签语法。
- 预渲染不覆盖动态段和 catch-all；动态路径需要 `prerenderPaths` 枚举，或由函数返回。
- 不自动生成 Open Graph 图片或 JSON-LD 结构化数据内容。

下一步：[Mock、API 与代理](/guide/mock-api)。
