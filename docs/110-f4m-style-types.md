# cormi F4m：CSS Modules 与静态资源类型声明

日期：2026-10-21。本切片补齐 U22 的 TypeScript 侧样式/资源导入：显式启用 `styleTypesPlugin` 后生成 `.cormi/styles.d.ts`，声明 `*.module.css/scss/sass/less`、纯 CSS 副作用导入与常见图片/字体资源。由于通配声明会与应用自带声明冲突，本能力**默认关闭**。

## 1. 使用方式

```ts
// cormi.config.ts
import { styleTypesPlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'style-types', plugin: styleTypesPlugin }],
});
```

```tsx
import classes from './card.module.css';
// classes 为 Readonly<Record<string, string>>
```

启用后生成 `.cormi/styles.d.ts`（无需 import，tsconfig 已包含 `.cormi/**/*`），并加入应用 typecheck 的生成输入白名单。

## 2. 契约与语义

- 插件：`cormi:style-types`，`inject: ['react']`；通过 `ctx.react.styleTypes` hook 声明启用；
- 声明：CSS Modules 默认导出 `Readonly<Record<string, string>>`；`.css/.scss/.sass/.less` 为副作用模块；`.svg/.png/.jpg/.jpeg/.gif/.webp/.avif/.ico/.woff/.woff2` 默认导出字符串 URL；
- 默认关闭：未挂载插件时 `.cormi/styles.d.ts` 只有生成头，不会与 `src/assets.d.ts` 等应用自有通配声明冲突；
- 生成：每次编译重写，`AtomicEntry` 原子发布；卸载插件后声明清空；
- 类型范围：类名是字符串索引，不解析具体选择器；不改变 Vite 的资源处理；
- 退出：无运行时资源；插件卸载即停止贡献。

## 3. 与 Umi 4 的差异

Umi 通常由内置类型或模板生成 CSS Modules/资源声明；cormi 将其作为可选插件，避免与应用自定义声明争夺通配模块。

| 方面 | Umi 4 | cormi F4m |
| --- | --- | --- |
| 启用 | 默认/模板 | 显式 styleTypesPlugin |
| 类名 | 视生成 | 字符串索引 |
| 资源导入 | 内建 | 常见类型声明 |
| 用户自有声明 | 可能合并 | 未启用时不生成 |

## 4. 限制

- 类名不精确到每个文件，拼写错误不会被类型检查发现；
- 不支持 `?url`/`?raw`/`?inline` 等查询变体；
- 不生成 Less/Sass 变量或 CSS 自定义属性类型；
- 不解析 PostCSS/Tailwind 产物；
- 启用后与应用自带同类通配声明同时存在仍会冲突，需二选一。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/style-types.test.ts`（声明内容、默认关闭、启用后生成与 typecheck 输入） | 2/2 |
| `pnpm check` | 548/548，0 失败/取消/跳过（F5z 系列为 544，新增 4 项：适配器 2 + 样式类型 2） |
| `pnpm test:browser` | 52/52，0 失败/取消/跳过（无浏览器变更） |
| `pnpm test:package` | 328 阶段通过（完整套件；生成文件白名单包含 `.cormi/styles.d.ts`） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4m-style-types-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U22 后续：精确类名类型、Tailwind/UnoCSS/SVGR 与 PostCSS 集成；
- U32：serverLoader、流式渲染；U17 官方 UI 集成、F6 多 builder/微前端。
