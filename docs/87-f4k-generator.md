# cormi F4k：微生成器与命令位置参数

日期：2026-10-20。本切片交付 U27 的页面/组件/模型生成器，并把“命令 + 位置参数”打通为通用入参协议（CLI → supervisor → worker → `CommandRequest.positionals`）。交互式提问、mock/API 生成器与模板插件贡献面未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { generatorPlugin } from '@cormijs/plugin-react';

plugins: [{ id: 'generator', plugin: generatorPlugin, options: { id: 'app:generator' } }]
```

```sh
cormi generate page about-us          # src/pages/about-us.tsx
cormi generate component profile-card # src/components/ProfileCard/index.tsx
cormi generate model counter          # src/models/counter.ts
cormi generate page about-us -- --force
cormi generate page preview -- --dry-run
```

额外 flag 必须写在 `--` 之后：CLI 的全局选项保持严格模式，`--root`/`--json` 等仍由 CLI 解析，其余 token 原样作为位置参数交给命令。

## 2. 契约与语义

- 入参协议：`cormi <command> [args...]`；命令名后至多 32 个位置参数，每个 ≤512 字符、不含 NUL/换行；`CommandRequest.positionals` 只承载这些字符串，旗舰选项（`--root`、`--mode`、`--json` 等）保持原有语义与严格校验；
- 提供者：`cormi:generator`（`inject: ['commands', 'projectRoot']`）注册 `generate` 命令；命令只写项目内文件，不启动 worker 之外的任何服务；
- 语法：`generate <page|component|model> <name> [--force] [--dry-run]`；名称必须字母开头、仅字母/数字/短横线（≤64）；未知 kind、未知 flag、重复 flag 均以 `GENERATE_INVALID` 失败；
- 模板：页面默认导出 `PascalNamePage`；组件生成 `src/components/<Pascal>/index.tsx` 并带 Props 接口；模型生成 `src/models/<kebab>.ts` 的 Hook 模型（`usePascal`），与 `modelPlugin` 的命名空间约定一致；
- 写入：目标必须留在项目内；已存在文件默认失败（`GENERATE_EXISTS`），`--force` 覆盖，`--dry-run` 只返回计划不落盘；成功时命令结果为 `{ kind, name, dryRun, files }`；
- 退出：卸载插件后 `generate` 命令从注册表移除；CLI 参数协议本身由 core/worker 提供，不属于生成器插件。

## 3. 与 Umi 4 的差异

Umi 的生成器由 `packages/core/src/service/generator.ts` 提供服务，预设通过 `packages/preset-umi/src/commands/generators/*` 注册具体类型（component、mock、cypress 等），通常带交互式提问与模板目录。cormi 目前是内置三类模板 + 非交互参数：没有提问、没有用户模板目录，也没有 `umi g` 的别名与 mock/API 生成器。

| 方面 | Umi 4 | cormi F4k |
| --- | --- | --- |
| 命令入口 | `umi generate`/`umi g` + 插件注册 | `cormi generate` + 内置平台 |
| 参数 | 交互式提问 + CLI 参数 | 仅位置参数与 `--force`/`--dry-run` |
| 类型 | component/mock/cypress 等 | page/component/model |
| 模板来源 | 插件模板目录 | 插件内置字符串模板 |
| 覆盖策略 | 交互确认/`--force` | 默认失败，`--force` 覆盖 |

## 4. 限制

- 命令位置参数是新增的通用协议：插件读取 `request.positionals`；不提供任意 `--flag` 透传（必须放在 `--` 之后），避免削弱 CLI 对未知全局选项的拒绝；
- 生成器不做 AST 修改：不会把新页面注册进路由、不更新 `routes` 配置，也不会格式化生成结果；
- 模板固定为函数组件与 Hook 模型，不支持自定义模板目录、路径前缀或测试文件；
- 只支持三类 kind；mock、API 与 `precommit`/`cypress` 类生成器未交付；
- 写入不是事务：多文件模板一旦引入，需要在后续切片补充失败回滚。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。首轮包消费验证暴露一个测试自身的问题：`types.mts` 的 `@ts-expect-error` 落在运行时才抛错的调用上（类型层面并不报错），修正为对非数组入参的类型断言后，**仅重跑受影响的独立包消费阶段**（check/browser 未受影响，未重跑）。

| 检查 | 结果 |
| --- | --- |
| `tests/generate.test.ts`（计划生成、模板内容、生成命令经真实 CLI 的创建/存在/强制/试运行/非法参数） | 2/2 |
| `launcher` 回归（cli-carrier、commands、tool-command、launcher、launcher-control） | 28/28 |
| `pnpm check` | 505/505，0 失败/取消/跳过（F4j 为 503，新增 2 项；约 117 秒） |
| `pnpm test:browser` | 45/45，0 失败/取消/跳过（未新增浏览器用例；约 498 秒） |
| `pnpm test:package` | 278 阶段通过（F4j 为 269，新增 9 个 generator 阶段） |
| 示例 | 无新增示例工程（命令类能力由 CLI 集成用例与独立包消费覆盖） |

独立包消费验收断言：安装后的 `node_modules/.bin/cormi generate page generated --json` 退出 0 并生成 `src/pages/generated.tsx`；随后 `typecheck` 通过（模板可编译）；重复生成以 `GENERATE_EXISTS` 失败；`--json -- --force` 覆盖成功；公开类型覆盖 `planGeneration`/`GeneratePlan`/`PlannedFile` 与非法入参的类型拒绝。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4k-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U27 剩余：mock/API 生成器、模板贡献面与交互式提问；
- U28：lint/format/test 等可选工程命令；U29：API 生成与类型工作流；
- U32/U33/U34/U35：SSR、静态导出、MPA、生产 API 路由。
