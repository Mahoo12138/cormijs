# 生成器

`generatorPlugin` 提供非交互式文件生成命令。它只写文件，不修改路由配置，也不格式化结果。

## 启用

```ts
import { generatorPlugin } from '@cormijs/plugin-react'

plugins: [{
  id: 'generator',
  plugin: generatorPlugin,
  options: { id: 'app:generator' },
}]
```

## 内置类型

```sh
cormi generate page about-us
cormi generate component profile-card
cormi generate model counter
cormi generate api health
cormi generate mock health
```

| 类型 | 输出 |
| --- | --- |
| `page` | `src/pages/<kebab>.tsx` |
| `component` | `src/components/<Pascal>/index.tsx` |
| `model` | `src/models/<kebab>.ts`，Hook 模型 |
| `api` | `src/api/<kebab>.ts`，Fetch 处理器骨架 |
| `mock` | `mock/<kebab>.ts`，`GET /api/<kebab>` 示例 |

名称规则：

- 必须以字母开头。
- 只能包含字母、数字和短横线。
- 最长 64 字符。
- 大小写会用于 `kebab` 与 `Pascal` 派生。

页面和模型不会自动注册到路由或 model 插件；新增的 `src/api` / `mock` 文件由对应插件在下一轮扫描中发现。API 路由的新增文件需要重启开发服务。

## 覆盖与试运行

```sh
cormi generate page about-us -- --force
cormi generate page preview -- --dry-run
```

- 默认遇到已有文件以 `GENERATE_EXISTS` 失败，不覆盖。
- `--force` 覆盖。
- `--dry-run` 只返回计划，不落盘。
- 额外 flag 写在 `--` 之后；CLI 自己的 `--root`、`--mode`、`--json` 仍由 CLI 解析。

## 自定义模板

```ts
plugins: [{
  id: 'generator',
  plugin: generatorPlugin,
  options: {
    id: 'app:generator',
    templates: {
      note: {
        path: 'src/notes/{{kebab}}.md',
        content: '# {{pascal}} ({{name}})\n',
      },
    },
  },
}]
```

```sh
cormi generate note Hello-World
# → src/notes/hello-world.md
```

占位符：

| 占位符 | 示例 |
| --- | --- |
| `{{name}}` | `Hello-World` |
| `{{kebab}}` | `hello-world` |
| `{{pascal}}` | `HelloWorld` |

约束：

- 最多 16 个自定义类型。
- 类型名不能与内置类型重名。
- 路径必须留在项目内，不能包含 `node_modules`、`.git`、`.cormi`、`.env*` 或 `cormi.config.ts`。
- 路径最长 256 字符，内容最长 64 KiB。
- 生成目录会自动创建，但写入不是事务；自定义模板当前只能生成一个文件。

## 与其他命令的边界

```sh
pnpm cormi inspect --json
pnpm cormi typecheck
```

生成器不是脚手架：它不会安装依赖、修改 `tsconfig`、更新 `cormi.config.ts` 或运行格式化。生成后仍应执行 `typecheck` 和实际构建。

## 限制

- 只有非交互式位置参数，没有提问式流程。
- 没有 AST 修改、路由注册或测试文件生成。
- 自定义模板只支持单文件，不支持目录模板。
- 写入不是多文件事务；一旦失败，已写入的文件需要手动处理。

下一步：[微前端](/guide/microfrontend)。
