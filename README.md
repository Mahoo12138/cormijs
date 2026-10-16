# cormi

以 Cordis 为插件宿主、以 Umi 的应用开发体验为参考的 TypeScript 应用框架。默认 React + Vite 由 preset 组合提供，core 不绑定 React 或 Vite。

**当前阶段：P1b 路由生成与 React 应用链路。** 已完成配置启动、插件命令、worker、项目锁、路由 IR、单入口受管生成、React runtime、React–Vite 桥接和默认 preset。本机验证为 **93 项 Node 回归 + 4 项真实浏览器测试通过**，不是完整 MVP 或跨平台发布保证。最新结果见 [P1b 记录](docs/09-p1b-results.md)。

名称约定：框架、CLI、配置和运行时均为 **cormi**；`cormijs` 仅用于发布包名及 `@cormijs/*` 命名空间。源码 import 使用真实包名；现有项目目录仍为 `/Users/mahoo/Projects/cormijs`。

## 本地运行

本机使用 Node 22.14.0、pnpm 10.6.3、macOS arm64；`.nvmrc` 固定当前实验 Node，不修改全局环境。

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm cormi dev --root examples/basic
```

React 示例默认监听 `127.0.0.1:8001`。首页包含可点击计数器，导航演示静态页面、嵌套布局、动态参数和 catch-all。组件修改由 Fast Refresh 处理；页面新增/删除会重算路由、提交入口、失效后端缓存并整页刷新。Ctrl+C 关闭 worker 和自己的资源后释放锁。

```sh
# 只准备路由和生成入口，然后退出
pnpm cormi prepare --root examples/basic

# 停止 dev 后，构建并预览应用
pnpm cormi build --root examples/basic
pnpm cormi preview --root examples/basic
```

**同项目只允许一个 CLI 会话。build 仍要求输出目录不存在，不清空或覆盖已有 dist。** 重复构建前保管旧产物或改用另一个 `app.outDir`；生产 staging/发布替换是下一切片。preview 只服务已有产物，不重新扫描或生成。`examples/p0` 保留原 HTML + TypeScript 示例，端口 8000；`pnpm demo` 仍是一轮构建/HTTP 预览检查/关闭，不是常驻服务。

## 验证

```sh
pnpm check
pnpm typecheck:example
pnpm test:browser
```

check 包含框架与测试的类型检查、构建和 Node 测试；typecheck:example 检查示例业务源码。browser 测试用 playwright-core 启动独立的无头浏览器，不接入个人浏览器 profile。Mac 默认使用现有 Microsoft Edge，其他环境通过 `CORMI_BROWSER_EXECUTABLE` 指定 Chromium 系可执行文件；未找到时明确失败，不下载浏览器或静默跳过。应用级 `cormi inspect/typecheck` 尚未实现。

## 模块

```text
packages/
├── core/                    # Cordis 宿主、就绪屏障、基础诊断和命令协议
├── builder/                 # 后端无关构建/会话/开发失效契约
├── routes/                  # 路由 IR、约定扫描与冲突验证
├── plugin-web/              # Web consumer、应用命令、OrderedHooks、生成队列
├── plugin-vite/             # builder 与 vite 服务的 Cordis provider
├── plugin-react/            # application 编译服务与 react 贡献入口；无 Vite
├── runtime/                 # 仅浏览器 React/Router 生命周期
├── plugin-react-vite/       # React 原生 Vite 集成和客户端边界
├── preset-react-vite/       # 可审阅、可替换的默认组合
└── cormi/                   # 包名 cormijs；CLI/config/preset/锁/worker
```

core 的物理独立消费者测试验证没有 Vite 仍可运行；React compiler 也可在没有 builder 的宿主中准备入口。Vite 仍是唯一真实后端，可替换测试 provider 不代表其他构建器的原生插件自动兼容。生成型开发应用需要后端提供 `ServerHandle.invalidate`；不支持时明确报错。

## 文档与记录

[架构 Draft 0.4](docs/02-architecture.md)描述完整目标，[MVP 计划](docs/03-mvp-plan.md)记录进度，[插件优先 ADR](docs/04-plugin-first-adr.md)记录边界原则。[命名和启动协议](docs/06-naming-and-launcher.md)描述 CLI，[路由与 React 协议](docs/08-routes-and-react.md)描述当前 P1b API。历史 [P0](docs/05-p0-results.md)、[P1a](docs/07-p1a-results.md) 保留原阶段事实；最新 [P1b 结果](docs/09-p1b-results.md) 对应 [机器验证](artifacts/p1b-validation.json)，不改写历史验证 JSON。

## 固定依赖与参考

| 对象 | 本机验证基线 |
| --- | --- |
| Cordis npm | 4.0.0-rc.11，gitHead 0b96d9fd517b998e44e2209560c9e5f0671ce933 |
| Vite / React Vite plugin | 7.3.2 / 5.1.4 |
| React / React DOM / React Router | 19.3.1 / 19.3.1 / 7.18.2 |
| TypeScript / tsx / esbuild | 5.9.3 / 4.23.15 / 0.28.2 |
| playwright-core / 实测 Edge | 1.58.2 / 155.0.4283.45 |

直接依赖固定版本，间接依赖使用 pnpm-lock.yaml；以上不表示最新版本。Cordis npm 声明文件仍使用仅声明的 pnpm patch，不修改运行时 JavaScript；该补丁未来消费者分发问题尚未解决，包保持 private，见 [补丁说明](patches/README.md)。

`cordis/` 与 `umi/` 是独立 depth-1 参考 checkout，不进入 workspace 或本仓库提交。固定 HEAD 见 [源码研究](docs/01-source-study.md)。本地 Git 已初始化为 main，P1a 初始提交为 `a4e3384`；没有配置远端、推送或发布。

## 明确限制与下一步

单入口 rename 不等于多文件事务或业务源码回滚。结构冲突保留最后生成入口，刚修改/删除的业务模块仍可能报错。首次路由错误会使启动失败；后续结构冲突诊断目前主要输出到终端。相对模块引用当前按项目根解析，完整的插件模块 URL 解析和错误恢复体验后续完善。

正常 CLI 退出移除自己的 run 缓存与锁；强杀父进程可能留下 stale 锁，不按 PID/时间猜测自动抢锁。恢复前核实相关会话及 worker 均已结束。低层编译 API 不自动取得 CLI 锁，调用者应确保单写入者。

下一切片优先完成生产 staging 与发布替换、生成类型/诊断和应用 inspect/typecheck，再补跨平台及发布消费者验收。SSR/RSC、Linux/Windows、移动端浏览器矩阵和长期内存趋势均未验证，不以本机测试替代这些门槛。
