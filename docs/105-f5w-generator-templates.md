# cormi F5w：自定义生成模板

日期：2026-10-21。本切片补齐 U27 的模板贡献面：应用可以在 `generatorPlugin` 的 `templates` 中声明自定义生成类型，使用与内置生成器相同的命令、覆盖与试运行语义；不能覆盖内置类型，也不能把文件写到项目源码之外。

## 1. 使用方式

```ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { generatorPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [{
    id: 'generator',
    plugin: generatorPlugin,
    options: {
      templates: {
        note: { path: 'src/notes/{{kebab}}.md', content: '# {{pascal}} ({{name}})\n' },
      },
    },
  }],
});
```

```sh
cormi generate note Hello-World
# src/notes/hello-world.md → "# HelloWorld (Hello-World)"
```

## 2. 契约与语义

- 入口：仍为 `generatorPlugin` 与 `cormi generate <kind> <name> [--force] [--dry-run]`；
- 模板：`{ path: string, content: string }`，占位符 `{{name}}`、`{{kebab}}`、`{{pascal}}` 在路径与内容中替换；
- 数量/命名：最多 16 个自定义类型；类型名以字母开头、仅字母/数字/连字符，且不能与 `page/component/model/api/mock` 同名；
- 路径：项目相对、正斜杠、不得绝对/`..`/`.`/空段，不得进入 `node_modules`/`.git`/`.cormi`，不得以 `.env*` 或 `cormi.config.ts` 结尾；替换后再次校验；
- 内容：非空字符串、≤64 KiB、不含 NUL；不执行模板函数或外部命令；
- 写入：沿用 `applyGeneration` 的项目内包含性校验、默认拒绝覆盖、`--force` 覆盖与 `--dry-run` 只预览；
- 校验时机：插件激活时校验模板表，命令执行时校验替换后的路径；
- 退出：卸载 `generatorPlugin` 后自定义类型随命令消失；生成文件归应用所有。

## 3. 与 Umi 4 的差异

Umi 的生成器/插件体系可贡献带交互与逻辑的模板；cormi 目前只接受静态字符串模板，不执行函数。

| 方面 | Umi 4 | cormi F5w |
| --- | --- | --- |
| 模板来源 | 插件 API | generatorPlugin 选项 |
| 交互提问 | 支持 | 未提供 |
| 动态逻辑 | 可编程 | 静态占位符 |
| 内置覆盖 | 视实现 | 禁止 |
| 路径保护 | 视实现 | 项目源码白名单式校验 |

## 4. 限制

- 模板是静态字符串，不能读取配置、环境变量或调用函数；
- 只有 `name/kebab/pascal` 三个占位符；
- 每个类型生成一个文件，不生成目录树；
- 不允许覆盖内置类型或写入受保护路径（含 `.env*`、`cormi.config.ts`）；
- 覆盖/试运行行为与内置类型一致，但不会自动 typecheck 生成内容。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/generate.test.ts`（占位符、内置同名/非法名、路径与内容校验、CLI 写入） | 2/2 |
| `pnpm check` | 541/541，0 失败/取消/跳过（F5v 为 541，本切片无新增测试函数） |
| `pnpm test:browser` | 51/51，0 失败/取消/跳过（无浏览器变更） |
| `pnpm test:package` | 320 阶段通过（完整套件；generator consumer 的公共类型新增自定义模板断言） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5w-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U27 后续：交互式提问、目录树模板与模板函数；
- U32：SSR；U16 Antd/dayjs 联动；U17 UI adapter；
- U25 的 runtimePublicPath 受 Vite chunk 导入限制未交付；F6 多 builder 与微前端。
