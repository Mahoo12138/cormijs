# cormi F5i：可选工程命令（lint/format 包装器）

日期：2026-10-20。本切片交付 U28 的最小可用形态：`toolPlugin` 注册 `cormi lint` 与 `cormi format`，在项目根目录执行**项目自己安装**的二进制（默认 `eslint`/`prettier`），参数按位置参数透传，输出转发到 stderr，退出码与错误码明确。不内置 eslint/prettier、不注入配置、不提供 `--fix` 语义之外的定制。

## 1. 使用方式

```ts
// cormi.config.ts
import { toolPlugin } from '@cormijs/plugin-react';

plugins: [{
  id: 'tools', plugin: toolPlugin,
  options: { lint: { bin: 'eslint' }, format: { bin: 'prettier', args: ['--write'] } },
}]
```

```sh
cormi lint                       # eslint .
cormi lint -- --max-warnings 0   # eslint . --max-warnings 0
cormi format -- --check src      # prettier --write . --check src
```

二进制从 `<root>/node_modules/.bin/<bin>` 解析；参数必须写在 `--` 之后（沿用 F4k 的位置参数协议）。

## 2. 契约与语义

- 提供者：`cormi:tools`（`inject: ['commands', 'projectRoot']`），注册 `lint`/`format` 两个命令；
- 选项：`lint`/`format` 各接受 `{ bin?, args? }`；`bin` 必须是小写字母开头、仅含字母/数字/短横线的裸名称（≤64），`args` 至多 32 个普通参数字符串；未知键、路径、`..`、控制字符以 `TOOL_INVALID` 在插件激活阶段失败；
- 执行：不使用 shell，`spawn(binPath, [...defaults, ...positionals], { cwd: root })`；stdout/stderr 都转发到 worker 的 stderr（CLI 协议通道保持干净）；`process.env` 原样继承；
- 失败语义：二进制不存在或不是文件 → `TOOL_MISSING`；启动失败/被信号终止/非零退出 → `TOOL_FAILED`（附带 bin 与 code，CLI 退出 1）；取消信号会终止子进程 → `TOOL_CANCELLED`；
- 成功：命令结果为 `{ tool, bin, exitCode }`，`--json` 下可见；
- 退出：卸载插件后 `lint`/`format` 从命令注册表移除。

## 3. 与 Umi 4 的差异

Umi 的 `lint` 命令（`packages/preset-umi/src/commands/lint.ts`）封装 eslint 与 stylelint、支持 `--eslint-only`/`--stylelint-only`/`--utlint` 与默认 glob（`{src,test}/**/*.{js,jsx,ts,tsx,less}`），并带 `--fix` 语义；cormi 只做“运行项目已安装二进制”的通用包装：不绑定工具、不内置默认 glob（默认 args 可配置）、没有 stylelint/utoo-lint、没有配置生成与 `format` 的 Umi 对应物（Umi 4.7 的 `commands/` 中没有 `format`）。

| 方面 | Umi 4 | cormi F5i |
| --- | --- | --- |
| 命令 | `lint`（`--eslint-only` 等） | `lint`/`format` |
| 工具来源 | 内置 eslint/stylelint/utoo-lint | 项目自己的 `.bin` |
| 默认目标 | 固定 glob | 可配置 args（默认 `eslint .` / `prettier --write .`） |
| 输出 | 直接输出 | 转发到 stderr，结果含 exitCode |

## 4. 限制

- 不安装依赖：未安装 eslint/prettier 时命令会以 `TOOL_MISSING` 失败；
- 不做文件发现、缓存或格式化配置生成；默认目标与 flag 由 `args` 决定；
- 只支持两个命令与固定命名；没有 stylelint、`--eslint-only` 之类的模式切换，也不解析工具自身的配置；
- 子进程输出无颜色控制与速率限制；大量输出会进入 stderr 日志；
- 长任务的取消依赖 SIGTERM，工具自身若不响应需要用户手动结束。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。磁盘仅剩约 2 GiB，完整包消费套件不可行；沿用 F5h 引入的 `CORMI_PACKAGE_ONLY` 过滤（逗号分隔的消费者名，未设置时行为不变），用 `CORMI_PACKAGE_ONLY=tools` 跑通 tools consumer。tools 块最初被误嵌在 analytics 守卫内，导致一次子集运行跳过了它；修正嵌套后**仅重跑了受影响的包消费子集**（`check`/`browser` 未受该脚本改动影响，未重跑）。

| 检查 | 结果 |
| --- | --- |
| `tests/tools.test.ts`（默认参数、调用方参数、非零退出、缺失二进制） | 2/2 |
| `pnpm check` | 513/513，0 失败/取消/跳过（F5h 为 511，新增 2 项；约 118 秒） |
| `pnpm test:browser` | 48/48，0 失败/取消/跳过（未新增浏览器用例；约 517 秒） |
| `pnpm test:package`（子集 `CORMI_PACKAGE_ONLY=tools`） | 83 阶段通过（核心阶段 + tools consumer：install/typecheck/public-types/lint/lint-fail/format） |

子集消费验收断言：安装后的 CLI 执行 `cormi lint --json` 退出 0 且结果含 `"tool":"lint"`；`cormi lint -- --fail` 以退出码 1 失败并输出 `TOOL_FAILED`（子进程退出 3）；`cormi format --json -- --check` 把 `--write --check` 依序传给项目二进制；公开类型覆盖 `ToolPluginOptions`/`ToolSpec`/`runTool` 与非法 `bin` 的类型拒绝。完整套件（其它 consumer）仍待在 ≥5 GiB 空闲时重跑。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5i-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U28 剩余：文件发现、与 `lint-staged`/`precommit` 的集成；
- F5j 已交付约定式 clientLoader 识别，见 [F5j 约定式 loader](92-f5j-conventional-loader.md)；U32/U34/U35：SSR、MPA、生产 API 路由；U25 externals/runtimePublicPath；
- U13 约定式 loader 识别、U16 ICU 与 locale key 类型、U17 UI adapter。
