# cormi

以 Cordis 为插件宿主、以 Umi 的应用开发体验为参考的 TypeScript 应用框架。默认产品方向是 React + Vite，但 core 不绑定它们。

**当前阶段：P1a 配置启动与命令生命周期，70 项自动测试通过。** 已新增 TS 配置装载、preset 组合、插件命令、独立 worker、项目写锁和开发态配置重载。示例仍为 HTML + TypeScript；路由生成、React preset 和原子产物发布尚未实现。最新结果见 [P1a 记录](docs/07-p1a-results.md)。

名称约定：框架、CLI、配置和运行时均为 **cormi**，`cormijs` 仅用于发布包名及 `@cormijs/*` 命名空间。实际 import 保持发布名称；现有项目路径 `/Users/mahoo/Projects/cormijs` 暂不搬迁。

## 本地运行

本次验证环境为 Node 22.14.0、pnpm 10.6.3、macOS arm64。`.nvmrc` 固定当前实验 Node；不会自动修改全局 Node 或包管理器。

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm check
pnpm cormi dev --root examples/p0
```

`pnpm check` 包含框架与测试的 TypeScript 检查、构建和 node:test 测试。`pnpm demo` 是一次性 P0 示例：构建 `examples/p0`，启动本地预览，验证 HTTP 200，关闭资源并退出；它不是常驻开发命令。产物保留在输出中打印的 `examples/p0/dist-<uuid>`，不覆盖已有目录。`pnpm cormi dev --root examples/p0` 现在是实际开发入口，使用 `cormi.config.ts` 并默认监听 `127.0.0.1:8000`；Ctrl+C 关闭 worker 并释放锁。配置及静态依赖变更会重启 worker，`--no-watch` 可关闭配置重载，`--json` 输出结构化事件。

停止 dev 后可运行 `pnpm cormi build --root examples/p0`，随后 `pnpm cormi preview --root examples/p0`。当前 build 仍要求 `examples/p0/dist` 不存在；不会清空或覆盖已有产物，重复构建请先保管旧结果或设置其他 `app.outDir`。`cormi inspect/typecheck` 应用命令尚未实现，不要与 workspace 的 `pnpm typecheck` 混淆。

## 当前实现

```text
cormijs/
├── packages/
│   ├── core/                  # Cordis 宿主、就绪屏障与清理诊断
│   ├── builder/               # BuildPlan / Builder / ServerHandle 契约
│   ├── plugin-web/            # Cordis consumer；应用会话与 OrderedHooks
│   ├── plugin-vite/           # Cordis provider；ctx.builder + ctx.vite
│   └── cormi/                 # 发布包名 cormijs；CLI/config/锁/worker
├── examples/p0/               # HTML + TypeScript 显式入口，不是 React 示例
├── tests/                     # 70 个测试，包含独立消费者、真实跨进程及 TCP/文件测试
├── patches/                   # Cordis 声明文件补丁与说明
├── artifacts/p0-validation.json
├── docs/
├── cordis/                    # 上游参考源码，不进入 workspace
└── umi/                       # 上游参考源码，不进入 workspace
```

Web consumer 通过 `inject: ['builder']` 使用服务，Vite provider 内部才 import Vite。测试中同一 Web consumer 可以改用测试 builder。真实第二后端尚未实现；这证明替换边界，不意味着各后端原生插件可以通用。

`core` 的独立消费者测试会物理复制编译结果及必要运行依赖到临时目录，证明 Vite 无法解析时仍可启动、注入、销毁及通过 NodeNext 类型检查。这不是 npm 发布包验收，当前包均标为 private。

## 文档

[源码研究](docs/01-source-study.md)保留固定提交事实；[架构设计 Draft 0.3](docs/02-architecture.md)描述完整目标；[MVP 计划](docs/03-mvp-plan.md)逐项定义验收；[插件优先 ADR](docs/04-plugin-first-adr.md)记录边界修正；[P0 实验记录](docs/05-p0-results.md)只记录已执行结果及限制。最新 [命名和启动协议](docs/06-naming-and-launcher.md) 与 [P1a 结果](docs/07-p1a-results.md) 记录本轮能力；机器验证使用 `artifacts/p1a-validation.json`，不覆盖历史 P0 记录。

## 版本与参考仓库

| 对象 | 精确基线 |
| --- | --- |
| 实际安装 Cordis | npm `4.0.0-rc.11`，gitHead `0b96d9fd517b998e44e2209560c9e5f0671ce933` |
| Cordis 本地参考 | `main` / `5dac6953d2d993d345d1de9fb0a5926f6d78a7e7` |
| Umi 本地参考 | `master` / `788e39630dc52a9306c89f8af08705e5db0e199f`，包版本 4.7.24 |
| Vite | 7.3.2 |
| TypeScript / tsx | 5.9.3 / 4.23.15 |

两个参考仓库都是 depth 1 浅克隆，未安装其依赖或修改源码。npm Cordis 与参考源码虽版本号相同，提交不同，不能混作同一验证基线。所选依赖并非宣称当前最新版本。

Cordis RC.11 npm 声明缺少 NodeNext 所需的相对路径扩展名。项目通过锁文件中的 `patchedDependencies` 使用**仅声明文件补丁**，不改上游 JavaScript。正式发布前必须解决该补丁的消费者分发问题，见 [补丁说明](patches/README.md)。

## 下一阶段

配置装载、插件命令、写入锁和 worker 生命周期已接通。下一步接入路由 IR、受管生成/提交、生产 staging 和 React / React-Vite 桥接，形成真正的 React SPA 纵切。

每个 CLI 会话在配置求值前持有 `.cormi.lock`，包括 preview 和自定义命令；同项目第二个会话报 PROJECT_BUSY。正常退出清理自己的 `.cormi/run-*` 和锁；强制杀死父进程后可能留下锁，不凭旧 PID、超时或日期自动抢锁。恢复前必须人工核实相关会话与 worker 均已停止。不要把本次 HTTP smoke test 当作浏览器渲染、Fast Refresh 或完整 P1 已通过。当前未发布 npm、未推送远端，也未初始化顶层 Git 仓库。
