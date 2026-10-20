# cormi F4f：全局样式约定

日期：2026-10-20。本切片交付 U22 的第一步：可选 `globalStylePlugin` 发现 `src/global.{css,scss,sass,less}` 约定文件，并由生成入口以副作用导入的方式加载；页面组件继续自行导入自己的样式或 CSS Module。Less/Sass 等预处理器由 Vite 原生处理（应用自行安装 `less`/`sass`），cormi 不内置预处理器依赖，也不提供 Tailwind/UnoCSS 集成。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { globalStylePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'styles', plugin: globalStylePlugin, options: { id: 'app:styles' } }],
});
```

```css
/* src/global.css */
:root { --cormi-band: rgb(37, 99, 128); }
[data-global-band] { background: var(--cormi-band); }
```

默认候选是 `src/global.css`、`src/global.scss`、`src/global.sass`、`src/global.less`，每个贡献取第一个存在的文件；可用 `options.files` 覆盖。示例：`pnpm cormi dev --root examples/global-style`。

## 2. 契约与语义

- 提供者：`cormi:global-style` 原生 Cordis 插件，`inject: ['react']`，通过新增的 `ctx.react.styles` OrderedHooks 贡献 `StyleContribution`；解析与生成属于 Node 侧，样式文件由浏览器构建管线加载；
- 生成：`generateApplication` 在 `.cormi/app.tsx` 顶部按 styles hook 顺序插入 `import "../src/global.css";`，路径由 `.cormi` 目录相对计算并检查不得逃逸项目根、不得指向 `node_modules`、`.cormi*`、`.env`；
- 校验：每个贡献 ≤16 个候选、≤8 个贡献；候选必须是项目相对路径且扩展名为 `css|scss|sass|less`，否则 `STYLE_INVALID`；同一文件被两个贡献命中为 `STYLE_CONFLICT`；符号链接目录条目被拒绝；
- 开发循环：候选文件（含尚不存在的候选）进入 `repairSignature` 观测集，新建或删除 `src/global.css` 会触发重生成并在 dev 中生效（浏览器用例覆盖）；
- 顺序：多贡献的相对顺序就是 `ctx.react.styles` 的 hook 顺序（stage → ownerOrder → hook id），并与 `.cormi/inspect.jsonc` 的 `summary.styles` 一致；需要特定层叠时用 `stage` 表达，不依赖挂载时机；
- 退出：插件停用后贡献撤回，生成入口不再包含样式导入，`summary.styles` 为空；
- TypeScript：副作用样式导入（`import './x.css'`）不需要额外声明；使用默认导出的 CSS Module（`import styles from './x.module.css'`）仍需应用提供通配声明，create 模板已带 `*.module.css`、`*.svg`、`*.png` 声明。

## 3. 与 Umi 4 的差异

Umi 在 `packages/preset-umi/src/features/appData/appData.ts:198` 用 `expandCSSPaths(join(absSrcPath, 'global'))` 收集 `src/global.{css,less,scss,sass}`，再由 `features/tmpFiles/tmpFiles.ts:288-292` 把 `api.appData.globalCSS[0]`（只取第一个）写进生成的浏览器入口。cormi 的做法相近，但差异明确：约定必须显式启用、允许多个贡献按 hook 顺序堆叠、不生成额外运行时 barrel，也不接管样式编译配置。

| 方面 | Umi 4 | cormi F4f |
| --- | --- | --- |
| 启用方式 | 约定自动生效 | 显式 globalStylePlugin |
| 候选 | global.{css,less,scss,sass} | 同集合，可配置 |
| 多全局文件 | 只取第一个命中的 globalCSS | 多贡献按 styles hook 顺序堆叠 |
| 预处理器 | 框架内置 less/sass 处理 | 由应用安装、Vite 原生处理 |
| CSS Module 类型 | 框架生成声明 | 应用自带声明 |

## 4. 限制

- 不做 PostCSS/Tailwind/UnoCSS、SVGR 或主题令牌的官方集成（U22 剩余、U23）；
- 不实现运行时样式表、按路由动态样式或 CSS in JS；
- 不去重、不改写样式内容，也不校验 `scss`/`less` 语法（缺少预处理器依赖时由 Vite 报错）；
- 仅覆盖入口级全局样式；组件级样式仍由应用自行导入；
- `src/global.css` 之外的目录约定（如 `src/styles/global.css`）需通过 `options.files` 显式声明。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。首轮验证暴露两处真实问题并修复后整套重跑：生成入口的相对路径判定把合法的 `../src/global.css` 误判为逃逸（改为按项目根与私有目录判定），以及 fixture 断言的类型缺失。

| 检查 | 结果 |
| --- | --- |
| `tests/global-style.test.ts`（贡献校验、发现与冲突、符号链接拒绝、生成与撤回、hook 顺序） | 3/3 |
| `tests/browser/global-style.test.ts`（dev/typecheck/build/preview，以及 dev 期新建样式文件触发生成） | 2/2 |
| `pnpm check` | 485/485，0 失败/取消/跳过（F4e 为 482，新增 3 项；约 104 秒） |
| `pnpm test:browser` | 38/38，0 失败/取消/跳过（F4e 为 36，新增 2 项；约 398 秒） |
| `pnpm test:package` | 221 阶段通过（F4e 为 213，新增 8 个 global-style 阶段） |
| `examples/global-style` prepare + typecheck | 退出 0 |

浏览器与独立包消费验收断言：全局样式在 dev 与静态 preview 都已生效（计算后的背景色与圆角）、文档存在样式表产物、无控制台错误与开发覆盖层；dev 用例进一步验证“先无 `src/global.css`、运行中新建”后入口重新生成并应用样式。独立包消费覆盖 `globalStylePlugin`/`styleContributions`/`resolveGlobalStyles` 的公开类型与非字符串选项拒绝。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4f-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U22 剩余：CSS Modules 与静态资源的公开约定、可选预处理器集成说明；
- U23：Tailwind/UnoCSS/styled-components adapter；U24：图标方案；
- F4 后续：微生成器（U27）、工程命令（U28）；
- F5/F6 按路线继续（client loader、预取、SSR、生态集成）。
