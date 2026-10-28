# 命令行

## 形式

```sh
cormi <command> [args...] [--root path] [--mode name] [--no-watch] [--json]
```

命令由配置中的插件提供，不是 CLI 硬编码的固定列表。没有参数或传 `--help` 时打印用法。

| 全局选项 | 说明 |
| --- | --- |
| `--root <path>` | 项目根目录，默认当前目录 |
| `--mode <name>` | 环境文件 mode，例如 `staging` |
| `--no-watch` | 关闭文件观察 |
| `--json` | 以 JSON 行输出事件和结果 |
| `--help` | 打印用法 |

位置参数最多 32 个。CLI 对未知全局选项保持严格拒绝；生成器的额外 flag 必须写在 `--` 之后。

## 命令

| 命令 | 提供者 | 作用 |
| --- | --- | --- |
| `dev` | Web / React preset | 生成、开发服务、组件更新、配置重载 |
| `build` | Web / React preset | 生成、转译、构建并替换受管产物 |
| `preview` | Web / React preset | 服务已有构建，不重新扫描源码 |
| `prepare` | React preset | 只生成受管文件后退出 |
| `typecheck` | TypeScript 插件 | 生成并检查应用类型，不输出业务 JS |
| `inspect` | React preset | 读取上一次成功生成快照 |
| `config` | React preset | 报告配置字段来源 |
| `diagnose` | 默认 worker profile | 在独立 worker 中检查插件与服务 |
| `generate` | `generatorPlugin` | 生成页面、组件、模型、API 或 Mock |
| `lint` | `toolPlugin` | 包装项目自己安装的 linter |
| `format` | `toolPlugin` | 包装项目自己安装的 formatter |
| `serve` | `servePlugin` | 服务已构建产物，执行 SSR/hydration |

`dev`、`build`、`preview` 的实际能力取决于挂载的插件。只挂载 core 和 React compiler 时，不一定有 Web 命令。

### 常用示例

```sh
pnpm cormi dev --root examples/basic
pnpm cormi build --root my-app --mode staging
pnpm cormi preview --root my-app
pnpm cormi typecheck --root my-app --startup-timeout 30000
pnpm cormi inspect --root my-app --json
pnpm cormi config --root my-app --for build --mode staging --json
pnpm cormi diagnose --root my-app --for dev --json
```

### `config`

```sh
cormi config --for dev|build [--mode <name>] [--json]
```

报告 preset/user/derive 的字段赋值来源。它需要配置求值、插件初始化和项目写锁，但不会执行目标 build，也不会改写生成快照。

`pnpm config` 是 pnpm 内建命令，所以创建器模板使用 `config:app` 脚本；也可以直接 `pnpm exec cormi config`。

### `diagnose`

```sh
cormi diagnose --for dev|build [--json]
```

在独立 worker 中检查原生插件、服务和贡献。它不是正在运行的 dev 进程的在线监视器，也不代表目标命令已经成功执行。

### `generate`

```sh
cormi generate page about-us
cormi generate component profile-card -- --force
cormi generate note Hello-World -- --dry-run
```

内置类型与自定义模板见[生成器](/guide/generators)。

### `lint` / `format`

```sh
cormi lint -- --max-warnings 0
cormi format -- --check src
```

二进制从 `node_modules/.bin` 解析，使用 `spawn` 而不是 shell。stdout/stderr 转发到 CLI 的 stderr；非零退出以 `TOOL_FAILED` 失败，未安装为 `TOOL_MISSING`。

### `serve`

```sh
cormi build --root my-app
cormi serve --root my-app
```

只读取已有 `dist`，不执行 API 路由、Mock 或代理。详见[构建与部署](/guide/build#独立生产服务)。

## 会话与锁

同一项目同时只允许一个 CLI 会话。不同项目可以并行，但端口不能冲突。

- 正常退出会移除本次 run 缓存和锁。
- 强杀父进程可能留下 stale 锁。
- cormi 不会按 PID 或时间猜测自动抢锁。
- 恢复前应确认相关会话与 worker 都已结束。

低层编译 API 不自动取得 CLI 锁；直接调用时必须保证单写入者。

## 关闭与信号

普通控制台使用 `Ctrl+C`，CLI 会先关闭自己的 worker 和资源，再释放锁。

父进程需要程序化正常关闭时，fork CLI 后发送：

```json
{ "version": 1, "type": "cormi:shutdown" }
```

不要把 Windows 的 `child.kill('SIGTERM')` 当作优雅关闭。Windows 原生验收目前挂起。

## JSON 输出

`--json` 按行输出事件对象。失败时输出：

```json
{ "type": "error", "code": "...", "message": "..." }
```

具体字段以当前命令事件为准。日志与诊断不保证稳定 ABI，不应作为机器协议长期依赖。

## 退出码

- 成功为 0。
- 配置、插件、构建、类型检查或命令失败为非零。
- `pnpm test:windows --probe` 在非 Windows 环境返回 `WINDOWS_NATIVE_REQUIRED` 和退出码 2；这只是验收工具行为。

## 限制

- 没有交互式提示。
- 没有 watch 模式的进程内配置热替换；配置变化会重启 worker。
- 没有生产进程管理器；`serve` 是轻量静态/SSR 服务，不是网关。
- CLI 只保证本机验证过的平台行为；Windows 原生支持尚未完成。

下一步：[Runtime API](/reference/runtime)。
