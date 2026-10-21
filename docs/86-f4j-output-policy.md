# cormi F4j：构建输出与静态资源策略

日期：2026-10-20。本切片交付 U25 的两项可落地能力：可选 `outputPlugin` 在构建结束后把项目内的文件/目录复制进输出目录，并可用 `hash: false` 生成稳定（无内容哈希）的资源文件名。`publicPath`/CDN 前缀仍由 `app.base` 表达，`externals` 与 `runtimePublicPath` 未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { outputPlugin } from '@cormijs/plugin-react-vite';

plugins: [{ id: 'output', plugin: outputPlugin, options: {
  hash: false,
  copy: [{ from: 'static', to: 'extras' }, { from: 'static/robots.txt' }],
} }]
```

构建后：`dist/extras/**`、`dist/robots.txt` 出现；`hash:false` 时入口为 `dist/assets/index.js`（无内容哈希）。示例：`pnpm cormi build --root examples/output`，随后 `pnpm cormi preview --root examples/output`。

## 2. 契约与语义

- 提供者：`cormi:output`（React–Vite 桥，`inject: ['vite', 'projectRoot']`），只注册 `apply: 'build'` 的 Vite 插件；开发与 `prepare` 不执行复制；
- 复制：`copy` 1–32 项，`from` 必须是项目内相对路径且不得指向 `node_modules`、`.cormi*`、`.env*`，解析后必须仍在项目内且不是符号链接；`to` 缺省为 `from` 的 basename，必须留在输出目录内；构建后按目录/文件复制，已存在时覆盖（输出目录本身由构建独占创建）；
- 稳定文件名：`hash: false` 时设置 `assets/[name].js`、`assets/[name].js`、`assets/[name][extname]`；若配置里已有自定义 `entryFileNames`/`chunkFileNames`/`assetFileNames` 则明确失败，避免静默覆盖；
- 校验：`hash` 非布尔、`copy` 空/超限/逃逸/含未知字段、`from` 不存在、符号链接均以 `OUTPUT_INVALID` 在插件激活或构建阶段失败；
- 预览：复制发生在 `closeBundle`，因此 `preview` 直接提供复制后的文件（测试用 HTTP 请求验证 200 与内容）；
- 退出：插件停用后不再注册构建钩子，输出回到 Vite 默认行为（哈希名、无额外复制）。

## 3. 与 Umi 4 的差异

Umi 的 `hash` 由 Vite 后端转换器处理：`hash !== true` 时把输出名改为 `[name].js` / `[name].[ext]`（`packages/bundler-vite/src/config/transformer/rollup.ts:96-103`），不使用 `assets/` 前缀；`copy` 则挂在 webpack 后端（CopyPlugin，`packages/bundler-webpack/src/config/copyPlugin.ts:16-24`），Umi 的 Vite 后端并不提供同样的复制能力。cormi 把两者都放进显式的可选插件，并保留 `assets/` 目录与 Vite 的资源组织方式。

| 方面 | Umi 4 | cormi F4j |
| --- | --- | --- |
| hash 关闭 | 输出到根目录 `[name].js` | 保留 `assets/[name].js` |
| copy | webpack CopyPlugin | 构建后 `fs.cp`（Vite 桥） |
| 启用方式 | 配置项 | 显式 outputPlugin |
| externals | 支持 | 未交付 |
| CDN/publicPath | 配置 | 由 `app.base` 表达，无运行时切换 |

## 4. 限制

- 只做“构建后复制”，不参与文件生成、压缩或指纹重写；被复制文件里的引用不会被改写；
- 开发服务器不提供 `copy` 的文件（与构建产物可能不一致），需要开发期也可见的资源请放在 `public/`；
- `hash:false` 会关闭内容哈希，构建部署必须依赖其他缓存失效手段（例如版本化目录或 CDN 刷新）；
- 不支持 `externals`、`runtimePublicPath`、按 chunk 粒度的命名策略或 copy 的 glob 模式；
- 与自定义 rollup 输出命名冲突时直接失败，不做自动合并。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。本切片一次通过定向与浏览器用例；构建断言直接读取 `dist/`，预览断言通过 HTTP 请求读取被复制的文件。

| 检查 | 结果 |
| --- | --- |
| `tests/output.test.ts`（copy 校验与默认目标、稳定命名、插件注册/撤回、非法选项） | 2/2 |
| `tests/browser/output.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 503/503，0 失败/取消/跳过（F5d 为 501，新增 2 项；约 119 秒） |
| `pnpm test:browser` | 45/45，0 失败/取消/跳过（F5d 为 44，新增 1 项；约 487 秒） |
| `pnpm test:package` | 269 阶段通过（F5d 为 261，新增 8 个 output 阶段） |
| `examples/output` prepare + typecheck | 退出 0 |

独立包消费与浏览器验收断言：`dist/assets/index.js` 存在且无 `index-<hash>.js`；`dist/marker.txt`（默认目标）与 `dist/extras/marker.txt`、`dist/extras/nested/data.json` 内容与源一致；preview 对被复制文件返回 200 且内容正确；开发服务器页面正常、无控制台错误；类型检查覆盖 `OutputPluginOptions`/`resolveOutputCopy` 与非法 `hash` 的拒绝。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4j-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U25 剩余：externals、runtimePublicPath、CDN/按 chunk 命名策略；
- U32/U33/U34/U35：SSR、静态导出（`exportStatic`）、MPA、生产 API 路由；
- F4 剩余：U27 微生成器（需 CLI 多参数协议）、U28 工程命令；U23：Tailwind/UnoCSS 等样式生态。
