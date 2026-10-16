# Cormi P0 首批实现与实验记录

历史阶段记录：以下 41 项测试及未实现清单描述 P0 当时状态，不代表当前进度。产品名已统一为 cormi，分发标识保留 cormijs；最新能力见 [P1a 记录](07-p1a-results.md)。原始 P0 验证 JSON 保持不变。

记录日期：2026-10-16。状态：**41 项测试通过，首个可运行开发链路成立；完整 P0 与 P1 未完成。** 本文只汇报本次实际执行结果。原始命令状态与日志摘要见 [机器记录](../artifacts/p0-validation.json)。

## 1. 本轮修改了什么

将设计从 Draft 0.1 修订为 Draft 0.2：core 不再拥有 Vite adapter 或固定 Web 编译策略；builder 定义后端无关契约；Web consumer 与 Vite provider 都是真正的 Cordis 插件；React 领域、React-Vite 桥接、默认 preset 是后续独立边界。修订依据与非目标见 [ADR](04-plugin-first-adr.md)。

创建了四个实际实现包，而不是一组空壳。`@cormijs/core` 提供 ProjectRuntime、受限就绪屏障、卸载和清理诊断；`@cormijs/builder` 定义 BuildPlan、Builder、ServerHandle；`@cormijs/plugin-web` 提供显式入口会话编排及 OrderedHooks；`@cormijs/plugin-vite` 提供 builder 与原生 vite 扩展服务。Vite 是唯一真实后端，但不在 core 或 Web consumer 的依赖中。

P0 示例位于 `examples/p0`，是 HTML + TypeScript，不是 React 应用。它通过公开 workspace 包执行 build → preview → HTTP 验证 → close → host.dispose。输出目录使用唯一名称，保留产物，不覆盖用户文件。

## 2. 实际环境和依赖

| 项目 | 本轮基线 |
| --- | --- |
| 系统 | macOS 26.6.2 / arm64 |
| Node | 22.14.0，来自现有 nvm 安装 |
| pnpm | 10.6.3，沿用现有安装 |
| Cordis | npm 4.0.0-rc.11，gitHead 0b96d9fd517b998e44e2209560c9e5f0671ce933 |
| Vite | 7.3.2 |
| TypeScript | 5.9.3 |
| tsx | 4.23.15 |
| @types/node | 22.13.10 |

所有直接依赖固定版本，间接依赖记录在 pnpm-lock.yaml。依赖只安装在 Cormi workspace；使用 `--ignore-scripts`，没有运行两个参考 monorepo 的安装/构建脚本。PATH 和代理仅用于本次子进程，没有改系统或全局配置。

## 3. 实际遇到的问题，而不是预设成功

### npm 与参考源码不是同一提交

本地参考 Cordis HEAD 为 5dac6953d2d993d345d1de9fb0a5926f6d78a7e7，npm RC.11 的 gitHead 却是 0b96d9fd517b998e44e2209560c9e5f0671ce933。版本号相同不能证明内容相同。宿主活动判断同时检查 Fiber uid 和状态，避免只依据可能滞后的 state 判断已卸载实例。

### 声明文件的 NodeNext 兼容性

首次编译失败：Cordis npm 声明文件使用缺少扩展名的相对导入，NodeNext 消费者看不到 Context/Fiber/Plugin 等导出。本轮生成 `patches/cordis@4.0.0-rc.11.patch`，仅修复 8 份 `.d.ts` 的相对模块引用，并通过 pnpm patchedDependencies/锁文件应用。没有修改上游运行时 JavaScript。

补丁后框架与测试均可编译，独立消费者也通过 NodeNext 检查。**该 workspace 补丁不会自动传播给未来发布包的用户。** 当前包保持 private，正式发布前应等上游修复或确定可分发的适配方案，见 [补丁说明](../patches/README.md)。

### 卸载期的服务访问有两种语义

第一轮 26 项测试有一项失败：清理逻辑用 `ctx.get('resource')` 查询处于卸载期的 provider。该即时查询默认只返回 ACTIVE provider，不等价于沿已注入绑定访问属性。改用声明了 inject 的 `ctx.resource` 后，测试断言“即时查询为空，但注入属性仍可读取，消费者结束后 provider 才关闭”通过。没有删除清理顺序断言或放宽为任意成功。

### 具体版本决定关闭接口

本轮锁定的 Vite 7.3.2 中，DevServer 与 PreviewServer 都有 `close(): Promise<void>`。适配器直接调用该版本的公开关闭接口，不继续携带凭旧印象添加的 httpServer 分支。`configureServer` 返回回调是后置安装阶段，测试证明其在 server 启动时执行一次，不在关闭时当作 disposer 再执行。

## 4. 验证结果

`pnpm check` 退出码 0，其中框架和测试类型检查通过，node:test 共 **41 项，41 通过，0 失败，0 取消，0 跳过**。`pnpm demo` 退出码 0，预览请求返回 HTTP 200，随后资源关闭，进程自然退出。结果对应的日志 hash 和执行时间保存在机器记录中。

| 测试文件 | 数量 | 覆盖范围 |
| --- | ---: | --- |
| core.test.ts | 13 | 缺失服务、异步 provider、嵌套插件、初始化失败、重复 ID、加载中卸载、超时、清理顺序/异常、项目隔离、真实 watcher 和 TCP 端口 |
| hooks.test.ts | 8 | 确定性顺序、重复 ID、缺失顺序目标、顺序环、异步快照、旧注销句柄、返回值校验和 cause |
| isolation.test.ts | 1 | 无 Vite 的独立物理消费者：运行与 NodeNext 类型检查 |
| providers.test.ts | 5 | 不改 consumer 更换 fake provider、consumer 独立卸载、重复 provider、缺失专属后端、迟到会话 |
| vite-build.test.ts | 7 | 真实 build/preview、子路径深链接、已有目录保护、越界/符号链接、构建失败、取消和私有环境值隔离 |
| vite-dev.test.ts | 7 | 实际 HTML/TS 响应、20 次完整启停、端口冲突、后置 hook、启动失败清理、启动中卸载、原生扩展快照 |

20 次启停是一个测试内部的 20 轮宿主/provider/server 完整循环，每轮验证端口可重新绑定以及专属临时 cache 目录已清理。它不是长期内存/RSS 稳定性证明。真实 watcher 测试验证卸载后写文件不再增加回调计数。

独立消费者测试不只是读 package.json：它将 core 编译结果及 Cordis/cosmokit/Standard Schema 的真实文件复制到 workspace 之外的临时目录，不保留返回 workspace 的符号链接。子进程先确认无法解析 Vite，再完成服务注入与清理，并执行 NodeNext 类型消费。测试后删除自己创建的临时目录。这是隔离消费实验，**不是 npm tarball 发布验收**。

Vite dev 与 build 测试分在 node:test 独立进程中，避免复用同一个可变 NODE_ENV。示例只执行 build/preview，不在该进程内混用开发会话。这不代表生产 CLI worker 已实现。

## 5. 当前实现的明确限制

P0 builder 只接受项目根下的 `index.html`；输出目录必须是项目根的专用直接子目录，且构建时必须不存在。已有目录、符号链接目标和越界路径拒绝写入。构建失败可能留下自己创建的不完整目录；本轮不递归清理它，更不把它当作已发布产物。P1 需要受管 staging 与发布步骤。

AbortSignal 是协作式取消。原生构建不响应取消时仍等其收尾，拒收迟到结果，而不是谎称构建立即停止。宿主的清理超时会报告 CLEANUP_INCOMPLETE；它不会强杀任意进程。测试中的不合作任务由测试 gate 最终释放，不能据此声称任意第三方死循环均可安全恢复。

OrderedHooks 已实现 series/reduce/collect 的排序与快照；尚未完整接入路由/生成流水线。当前快照保护登记项，不提供业务对象深度冻结或任意函数的确定性证明。未来的 notify、完整周期诊断、不可变输入与产物提交队列仍需实现。

尚未实现 React、React Router、约定式路由、浏览器 runtime、React-Vite 桥接、默认 preset、cormi.config.ts 装载、cormi CLI、自动重启 worker、跨进程 PROJECT_BUSY 写锁、生成 revision/commit 协议。未执行浏览器交互/Fast Refresh 测试、Linux CI、Windows 测试或长时间内存趋势测试。不要把 HTTP 200 表述为 React 已正确渲染。

参考 cordis/umi 保持独立 checkout，没有推送、发布 npm、部署服务或初始化顶层 Git 仓库。测试仅临时监听 loopback，示例验证后退出，没有留下演示服务器供后续访问。

## 6. 下一步实现入口

先把本轮可运行的服务边界用于配置启动与命令生命周期：明确配置依赖、项目写锁与 worker 退出；补齐 P0 的父子依赖等待环和跨平台验证。随后实现路由 IR 与受管生成，再添加 React/React-Vite 桥接和 preset-react-vite，形成真正的 P1 React SPA 纵切。

不要为继续推进而把所有 P0/P1 复选框一次勾上；保留已经通过的测试作为回归门槛。所有包目前为实验性 private 包，接口仍可随实际需求调整。
