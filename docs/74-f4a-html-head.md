# cormi F4a：配置式 HTML head

日期：2026-10-20。本切片交付 U20 的第一部分：React–Vite 桥的 `htmlPlugin` 在开发与构建时不接管 index.html，而是替换/注入 title、lang、favicon、meta 与 link。任意脚本注入、headScripts、helmet/每路由 head 和非 Vite 后端尚未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { htmlPlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [{
    id: 'html', plugin: htmlPlugin,
    options: {
      title: 'Configured title',
      lang: 'zh-CN',
      favicon: '/favicon.svg',
      metas: [
        { name: 'description', content: 'Cormi HTML head' },
        { property: 'og:title', content: 'Configured title' },
      ],
      links: [{ rel: 'canonical', href: '/' }],
    },
  }],
});
```

`index.html` 仍归应用所有，必须包含 `</head>`；插件只做确定性的 head 变换。

## 2. 语义

| 选项 | 行为 |
| --- | --- |
| `title` | 替换已有 `<title>`；没有时插入 head |
| `lang` | 替换 `<html lang>`；没有 lang 时添加 |
| `favicon` | 追加 `<link rel="icon">` |
| `metas` | 每条必须有 `content` 和 `name`/`property`/`httpEquiv` 之一；最多 32 条 |
| `links` | `rel` 与 `href` 必填，可选 `type`/`sizes`/`crossorigin`；最多 32 条 |

- 所有属性与标题文本进行 HTML 转义；拒绝换行、NUL 与过长值；
- 重复 title 不会产生多个 `<title>`；
- 开发服务器与构建都通过 Vite `transformIndexHtml` 应用；preview 直接服务已构建 HTML；
- 插件是可选 Vite 桥，不进入 core/runtime，也不改变 index.html 的所有权；
- 配置变更走 Node 配置重启；HTML 源码更新由 Vite 处理。

## 3. 与 Umi 4 的差异

参考 Umi `title`、`metas`、`links`、`favicon`、`headScripts` 等 HTML 配置：

| 方面 | Umi | cormi F4a |
| --- | --- | --- |
| title/lang/meta/link/favicon | 支持 | 支持 |
| 任意 headScripts/scripts | 支持 | F4e 交付受审查子集（封闭属性集合） |
| 插件位置 | preset/config 内置 | 可选 htmlPlugin |
| 每个路由 head/helmet | 由插件/文档扩展 | 未交付 |
| 后端 | 多构建后端 | 仅 React–Vite 桥 |

本切片不承诺 Umi HTML 配置的二进制兼容。

## 4. 限制

- 仅支持 Vite 后端；其他 builder 需要各自 adapter；
- `headScripts`/`scripts` 由 [F4e](78-f4e-html-scripts.md) 交付；仍不支持任意 raw head HTML；
- 不支持每路由 title/meta 或 helmet；
- favicon/link 不自动去重，重复注入由应用配置负责；
- `index.html` 缺少 `</head>` 时明确失败；
- 不做 CSP、完整性哈希或外部资源校验。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/html.test.ts`（替换、转义、非法选项） | 1/1 |
| `tests/browser/html.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 470/470，0 失败/取消/跳过（F3e 为 469，新增 1 项；约 106 秒） |
| `pnpm test:browser` | 33/33，0 失败/取消/跳过（F3e 为 32，新增 html 用例；约 346 秒） |
| `pnpm test:package` | 189 阶段满足预期（F3e 为 181，新增 8 个 html 阶段） |
| `examples/html` prepare + typecheck | 退出 0 |

浏览器验收覆盖：title 替换、lang、description/og meta、canonical link、favicon、单一 title，开发与生产 preview 一致。独立打包消费覆盖 `htmlPlugin`/`applyHtmlHead` 类型、开发、构建与静态预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4a-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- F4b：Mock 目录约定与开发期自动重载，已由 [F4b](75-f4b-mock.md) 交付；
- F4c 别名与 F4d define 已交付，见 [F4c](76-f4c-alias.md)、[F4d](77-f4d-define.md)；样式/资源与微生成器待后续；
- U20 剩余 headScripts/scripts 已由 [F4e](78-f4e-html-scripts.md) 交付；后续为每路由 head（U21）与多后端 adapter；
