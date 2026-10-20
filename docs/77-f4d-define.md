# cormi F4d：编译期常量与内置别名

日期：2026-10-20。本切片交付 U19 的剩余便利入口：React–Vite 桥的 `definePlugin` 把 JSON 字面量注入客户端代码，并在开发阶段补齐 Vite 不处理的替换；`aliasPlugin` 增加可选内置别名 `@`→`src`。define 的类型生成、`@@` 别名、环境分层自动映射、样式约定与微生成器尚未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { aliasPlugin, definePlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'alias', plugin: aliasPlugin, options: { builtins: true } },
    { id: 'define', plugin: definePlugin, options: { values: {
      APP_NAME: 'cormi define',
      APP_FLAGS: { beta: true, retries: 2 },
      'process.env.APP_MODE': 'example',
    } } },
  ],
});
```

```ts
// src/defines.d.ts —— TypeScript 不由框架生成
declare const APP_NAME: string;
declare const APP_FLAGS: { beta: boolean; retries: number };
```

```tsx
// src/pages/index.tsx
import { builtinLabel } from '@/labels';                       // 内置别名
export default function Home() {
  return <p>{[APP_NAME, JSON.stringify(APP_FLAGS), process.env.APP_MODE].join(' | ')}</p>;
}
```

`pnpm cormi dev --root examples/define`（默认 `/define/`）。

## 2. 契约与语义

公开入口（`@cormijs/plugin-react-vite`）：`definePlugin`、`resolveDefines`、`applyDefines`、`mergeDefines`，与既有 `aliasPlugin`、`resolveAliases`、`aliasEntries`。

- 提供者：`cormi:define` / `cormi:alias` 两个原生 Cordis 插件，`inject` 分别为 `['vite']` 与 `['vite', 'projectRoot']`；核心不感知 define/alias；
- 组合与替换：消费者在 `plugins` 中显式声明实例（`{ id, plugin, options }`），可按 `id` 覆盖或用 `options.id` 注册第二个实例；不启用即无影响；
- 退出：`ctx.effect` 绑定 `ctx.vite.add` 返回的注销函数，插件卸载/停用后 Vite 扩展 id 消失，解析与替换恢复默认（`tests/define.test.ts`、`tests/alias.test.ts` 断言卸载）。

替换与解析规则：

- 值为 JSON 字面量：字符串自动带引号，对象/数组按 JSON 文本替换，数字与布尔保持字面量，`null` 合法；`undefined`、函数、Symbol、BigInt 与循环引用以 `DEFINE_INVALID` 失败；
- 1–64 条，键 ≤256 字符且必须是点分标识符路径；拒绝 `process`、`process.env`、`process.env.NODE_ENV`、`import.meta*` 以及以 `this`/`super`/`globalThis`/`window`/`document`/`require`/`module`/`exports` 起始的键；禁止一个键是另一个键的点前缀（esbuild 与替换顺序都会歧义）；
- 构建与预览沿用 Vite 原生 `define`（`config()` 钩子合并，已有值在前、配置值覆盖同名）；开发阶段由同一插件的 `transform`（`enforce: 'pre'`）完成：仅对 `js/mjs/cjs/jsx/ts/tsx` 模块、且源码包含某个键时调用 esbuild `transform`（`jsx: 'preserve'`、`target: esnext`、`charset: utf8`、附 sourcemap），未命中的模块原样返回；
- 未配置 define 的模块与未命中的字符串字面量不受影响，`APP_NAMEX` 这类边界不会被替换；
- `aliasPlugin` 的 `builtins: true` 追加 `@`→`<root>/src`，位于显式别名之后：Vite 取首个匹配项，因此应用显式声明的 `@` 覆盖内置值，而 `@scope/pkg` 形式的作用域包不被 `@` 截获。

## 3. 与 Umi 4 的差异

参考 Umi 的 `define` 与内置别名（`packages/preset-umi/src/features/configPlugins/configPlugins.ts` 的 `modifyConfig` 注入 `@`/`@@`；`packages/bundler-vite/src/config/transformer/define.ts` 对每个值执行 `JSON.stringify`）：

| 方面 | Umi 4 | cormi F4d |
| --- | --- | --- |
| 启用方式 | `config.define` 内置 | 显式 `definePlugin` |
| 值语义 | `JSON.stringify` | 同为 JSON 字面量 |
| dev 替换 | webpack/Mako 的 DefinePlugin | Vite 7 客户端 dev 不应用 define，由本插件补齐 |
| 类型 | 框架生成 `typings.d.ts` | 应用自行 `declare` |
| `@`/`@@` | 框架默认注入 | `@` 需 `builtins: true`；不提供 `@@` |

不承诺 Umi 插件二进制兼容，也不承诺 `.umirc` 的 define/env 组合语义。

## 4. 限制

- define 是编译期文本替换，不是运行时变量：条件拼接、动态键名不生效；
- 未定义的 `process.env.X` 在浏览器仍会抛 `ReferenceError`，框架不注入 `process` 垫片；
- 开发阶段命中的模块会被 esbuild 重新打印：注释与原始格式不保留，源码映射经 Vite 链式合并；构建阶段由 Vite 处理；
- 不与 `.env`/`envPrefix` 联动（公开变量请用 Vite 自带的 `import.meta.env`）；
- 仅 Vite 后端；不生成 define 的 TypeScript 声明；不提供 `@@`；
- 单值上限 4096 字符，条目上限 64。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行；执行前最后一次改动（define 插件的会话级 dev 判定）之后，整套验证在冻结源码上重跑。

| 检查 | 结果 |
| --- | --- |
| `tests/define.test.ts` + `tests/alias.test.ts`（值序列化、拒绝规则、dev 替换边界、builtins、挂载/卸载） | 7/7 |
| `tests/browser/define.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 479/479，0 失败/取消/跳过（F4c 为 474，新增 5 项；约 105 秒） |
| `pnpm test:browser` | 36/36，0 失败/取消/跳过（F4c 为 35，新增 define 用例；约 377 秒） |
| `pnpm test:package` | 213 阶段通过（F4c 为 205，新增 8 个 define 阶段） |
| `examples/define` prepare + typecheck | 退出 0 |

浏览器与独立包消费验收同时断言：dev 与 preview 下 `APP_NAME`/`APP_FLAGS`/`process.env.APP_MODE` 渲染出同一文本、内置 `@/labels` 可解析、作用域包 `@cormijs/runtime` 未被 `@` 截获、无控制台错误与开发覆盖层。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4d-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U19 剩余：环境分层与 define/env 的一体化入口；
- F4 后续：样式与资源约定（U22/U23）、微生成器（U27）、`headScripts`/`scripts`（U20 剩余）；
- F3 剩余：菜单折叠 helper 与 UI adapter、`src/access.ts` 约定；
- F5/F6 按路线继续（client loader、预取、SSR、生态集成）。
