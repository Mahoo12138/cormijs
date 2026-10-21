# cormi F5t：路由 JSON-LD

日期：2026-10-21。本切片补齐 U21 的结构化数据：`meta.head.jsonLd` 可声明 schema.org 对象或对象数组，`headPlugin` 在导航后把它同步为受管的 `<script type="application/ld+json">`，`staticExportPlugin` 把同一数据写入每个静态 HTML 外壳。它是路由元数据，不是任意脚本注入。

## 1. 使用方式

```ts
const routes = [{
  id: 'article', path: '/article/:id', component: './src/Article.tsx',
  meta: {
    head: {
      title: 'Article',
      jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: 'cormi' },
    },
  },
}];
```

```html
<!-- 导航到该路由后 -->
<script type="application/ld+json" data-cormi-head>
  {"@context":"https://schema.org","@type":"Article","headline":"cormi"}
</script>
```

数组用于一个页面声明多个实体，最多 32 项。

## 2. 契约与语义

- 形状：对象或对象数组（1–32 项）；必须是 JSON 数据，函数、Symbol、BigInt、`undefined`、非有限数字与循环引用均被拒绝；序列化后 ≤64 KiB；
- 合并：沿匹配链由深到浅，**最深的已声明 jsonLd 整体替换**祖先块；不与祖先对象合并，与 title/metas/links 的合并规则独立；
- 运行时：`headPlugin` 在每次导航后移除旧的受管节点并写入新块；路由没有 jsonLd 时该节点消失；卸载时恢复；
- 转义：序列化时把 `<` 写成 `\u003c`，因此数据中的 `</script>` 不会提前闭合标签；不执行脚本、不解析 HTML；
- 静态导出：`staticExportPlugin` 读取同一 `meta.head.jsonLd`，在页面 `</head>` 前写入脚本；无效数据按既有 head 行为忽略（运行时配置则抛 `HEAD_INVALID`）；
- 纯函数：`normalizeHead`/`collectHead` 暴露 jsonLd 类型；`serializeJsonLd` 导出用于测试或服务端复用；
- 退出：JSON-LD 节点带 `data-cormi-head`，随 head 插件卸载或路由切换移除。

## 3. 与 Umi 4 的差异

Umi 通常由页面通过 `<Helmet>` 或第三方 SEO 组件注入 JSON-LD；cormi 把它作为路由 `meta.head` 的声明式字段，运行时、静态导出共用同一份数据。

| 方面 | Umi 4 | cormi F5t |
| --- | --- | --- |
| 声明位置 | 页面组件/Helmet | 路由 meta.head |
| 合并 | 组件自行处理 | 最深路由整体替换 |
| 静态导出 | 依赖渲染 | 外壳直接写入 |
| 任意脚本 | Helmet 可写 | 仅 JSON-LD 数据 |
| SSR 收集 | 支持 | 待 U32 |

## 4. 限制

- 每个路由只有一个 JSON-LD 块（数组可含多个实体），不做字段级合并；
- 不支持 `<Helmet>` 组件、JSON-LD 模板或自动 schema 生成；
- 静态导出对非法数据静默忽略，运行时配置则失败；两者行为差异与既有 head 字段一致；
- 只处理 `<head>` 中的结构化数据，不生成 Open Graph 之外的 SEO 内容；
- SSR 头部收集尚未实现。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/route-head.test.ts`（JSON 校验、深层替换、`</script>` 转义） | 4/4 |
| `tests/static-export.test.ts`（外壳写入与转义） | 3/3 |
| `tests/browser/route-head.test.ts`、`tests/browser/static-export.test.ts`（导航/深链接/静态页面脚本） | 通过 |
| `pnpm check` | 539/539，0 失败/取消/跳过（F5s 为 538，新增 1 项） |
| `pnpm test:browser` | 51/51，0 失败/取消/跳过（无新增文件） |
| `pnpm test:package` | 320 阶段通过（完整套件；static-export consumer 的页面现在包含 JSON-LD） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5t-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U21 后续：`<Helmet>` 式组件与 SSR 头部收集；
- U32：SSR；U25 的 runtimePublicPath 受 Vite chunk 导入限制未交付；
- U16 Antd/dayjs 联动；U17 UI adapter；F6 多 builder 与微前端。
