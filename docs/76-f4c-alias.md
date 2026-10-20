# cormi F4c：配置式路径别名

日期：2026-10-20。本切片交付 U19 的别名部分：React–Vite 桥的 `aliasPlugin` 接受项目内相对路径映射，合并进 Vite 解析器；TypeScript 侧仍由应用在 tsconfig `paths` 显式对齐。define/环境注入、Tailwind/UnoCSS 等样式集成与微生成器尚未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { aliasPlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'alias', plugin: aliasPlugin, options: { aliases: { '@': 'src', '@shared': 'src/shared' } } }],
});
```

```jsonc
// tsconfig.json 与之对齐，供 typecheck 使用
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"], "@shared/*": ["./src/shared/*"] }
  }
}
```

```tsx
import { sharedMessage } from '@shared/message';
```

## 2. 语义

- 键必须是非空、无路径分隔转义的名称（≤128 字符）；值必须是项目内相对路径（≤1024 字符），解析为绝对路径后不得逃逸项目；
- 1–64 个别名；空映射、绝对路径、`../` 逃逸和非字符串值以 `ALIAS_INVALID` 失败；
- 插件通过 `ctx.vite.add` 注册 `enforce: 'pre'` 的原生 Vite 插件，把别名追加到既有 `resolve.alias`（不覆盖任何现有条目）；
- 别名在 dev 与 build 中同样生效；preview 服务已构建产物；
- 插件卸载时移除解析器；
- TypeScript paths 不由本插件生成或修改——避免替 tsconfig 做隐式决定。

## 3. 与 Umi 4 的差异

参考 Umi 的 `alias` 配置与 Vite 集成：

| 方面 | Umi | cormi F4c |
| --- | --- | --- |
| 启用方式 | config.alias 内置 | 显式 aliasPlugin |
| `@`/`@@` | 框架内置别名 | 不内置，由应用声明 |
| 值类型 | 任意 Vite alias | 项目内相对路径 |
| TypeScript paths | 框架生成/联动 | 应用 tsconfig 显式对齐 |
| define | config.define | 尚未交付 |

不承诺 Umi `@`/`@@` 内置别名或 define 的二进制兼容。

## 4. 限制

- 只接受项目内相对替换值；不能指向 node_modules 包或项目外目录；
- 不提供 `@`/`@@` 框架内置别名；
- 不生成 TypeScript paths；应用需自行维护 tsconfig；
- 不支持正则别名或 Vite 函数式 alias；
- define、样式集成、微生成器见路线后续切片。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/alias.test.ts`（解析、逃逸拒绝、挂载/卸载） | 2/2 |
| `tests/browser/alias.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 474/474，0 失败/取消/跳过（F4b 为 472，新增 2 项；约 112 秒） |
| `pnpm test:browser` | 35/35，0 失败/取消/跳过（F4b 为 34，新增 alias 用例；约 367 秒） |
| `pnpm test:package` | 205 阶段满足预期（F4b 为 197，新增 8 个 alias 阶段） |
| `examples/alias` prepare + typecheck | 退出 0 |

浏览器验收覆盖 `@shared/message` 在开发与生产预览中的解析、typecheck 通过 tsconfig paths 对齐。独立打包消费覆盖 `aliasPlugin`/`resolveAliases` 公开类型、开发、构建与静态预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4c-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- F4d：define/环境注入便利入口、样式与资源约定、微生成器；
- U19 后续：与 mock/config 的一体化配置入口；
- F5/F6 按路线继续（加载策略、SSR、生态集成）。
