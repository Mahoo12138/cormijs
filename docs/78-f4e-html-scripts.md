# cormi F4e：配置式 headScripts 与 scripts

日期：2026-10-20。本切片补齐 U20 剩余部分：`htmlPlugin` 在既有 title/lang/favicon/meta/link 之外接受 `headScripts` 与 `scripts`，按 Umi 的位置约定写入 index.html 字符串。每路由 head（helmet 类能力，U21）与 CSP/nonce 仍不属于本切片。

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
      title: 'cormi HTML head',
      links: [{ rel: 'canonical', href: '/html/' }],
      headScripts: [{ src: '/html/mark.js', defer: true }, 'window.__cormiHead = "inline-head"'],
      scripts: [{ content: 'window.__cormiBody = "inline-body"', type: 'text/javascript' }],
    },
  }],
});
```

条目可以是字符串或对象：字符串以 `//`、`http(s)://`、`/`、`./`、`../` 开头视为 `src`，否则视为内联内容（与 Umi 的 `normalizeScript` 判定一致）。示例：`pnpm cormi dev --root examples/html`。

## 2. 契约与语义

公开入口：`htmlPlugin`、`applyHtmlHead`、`normalizeScript` 与 `HtmlScript`/`NormalizedHtmlOptions` 类型。

- 提供者：`cormi:html` 原生 Cordis 插件，`inject: ['vite']`，通过 `ctx.vite.add` 注册 Vite 的 `transformIndexHtml`；核心与路由层不感知 HTML 注入；
- 组合与替换：不启用插件即完全不影响 index.html；启用时只改写字符串，不接管模板所有权；
- 退出：`ctx.effect` 绑定的注销函数在插件停用/卸载时移除该 Vite 扩展；
- 位置：head 内顺序保持 favicon → metas → links → headScripts（Umi 在 `packages/server/src/server.ts:142-147` 把 headScripts 放在 head 末尾），`scripts` 插在 `</body>` 之前；
- 转义：属性值经过 `& " < >` 转义；`async`/`defer` 为布尔标志；内联内容不做 HTML 转义（它是代码），但 `</script` 与 `<script` 起始的 `<` 被替换为 `\x3c`，防止标签逃逸；
- 校验：封闭属性集合 `src|content|async|defer|type|charset|crossorigin`；`src` 与 `content` 必须二选一；两组各 ≤32 条，`src` ≤2048，内联内容 ≤16384；违规以 `HTML_INVALID` 失败；
- 传入的选项对象不会被就地修改（配置层的对象是冻结的，归一化结果另行返回）。

## 3. 与 Umi 4 的差异

基线：`references/umi/packages/preset-umi/src/features/configPlugins/schema.ts:6-18`（scripts 模式）、`packages/server/src/scripts.ts:15-37`（normalizeScript）、`packages/server/src/server.ts:63-77`（渲染）、`packages/renderer-react/src/html.tsx:137-148,215-226`。

| 方面 | Umi 4 | cormi F4e |
| --- | --- | --- |
| 启用方式 | config.headScripts/scripts 内置 | 显式 htmlPlugin 选项 |
| 属性集合 | schema 允许任意额外键 | 封闭白名单 |
| 属性值 | `JSON.stringify`，不做 HTML 转义 | HTML 转义 |
| 内联内容 | 原样插值，`</script>` 可逃逸 | 逃逸序列被消解 |
| 函数式贡献 | `api.addHTMLHeadScripts` | 未提供（无插件贡献面） |
| 每路由 head | 通过 helmet/元数据 | 未交付（U21） |

明确不照搬 Umi 的裸插值行为，也不声称 Umi 插件二进制兼容。

## 4. 限制

- 只在文档级注入，不做运行时去重：同一 `src` 若 index.html 已存在会重复加载；
- 不处理 CSP、`nonce`、`integrity`，也不改写已存在的脚本标签；
- `crossorigin`/`type` 等值只校验长度与非法字符，不校验语义；
- 仅 Vite 后端；非 Vite 构建后端需各自的 bridge；
- 每路由 head/SEO 元数据（U21）与 styles 配置仍待后续。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。首轮 `pnpm check` 暴露真实缺陷：`validate` 就地写入运行时传入的冻结选项对象（`Cannot assign to read only property 'headScripts'`），改为返回归一化副本并新增冻结对象回归用例后整套重跑。

| 检查 | 结果 |
| --- | --- |
| `tests/html.test.ts`（顺序、转义、逃逸消解、封闭属性集合、冻结选项） | 4/4（F4d 为 1 项，新增 3 项） |
| `tests/browser/html.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 482/482，0 失败/取消/跳过（F4d 为 479；约 105 秒） |
| `pnpm test:browser` | 36/36，0 失败/取消/跳过（约 378 秒） |
| `pnpm test:package` | 213 阶段通过（沿用既有 html 消费阶段并加强断言，未新增阶段） |
| `examples/html` prepare + typecheck | 退出 0 |

浏览器与独立包消费验收同时断言：`headScripts` 的外部 `src`（带 `defer`）与内联条目、`scripts` 的内联条目都在 dev 与 preview 实际执行（`window` 标记可读）、外部 head 脚本位于 `#root` 之前、`title` 唯一、无控制台错误与开发覆盖层。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4e-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U20/U21：路由级 head 与 helmet 类能力；
- F4 后续：样式与资源约定（U22/U23）、微生成器（U27）、lint/test 工程命令（U28）；
- F3 剩余：菜单折叠 helper 与 UI adapter、`src/access.ts` 约定；
- F5/F6 按路线继续（client loader、预取、SSR、生态集成）。
