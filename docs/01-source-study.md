# Cormi 源码研究与设计依据

首次记录日期：2026-10-16。本文的源码事实基于 Mac 本地 `Projects/cormijs/cordis` 与 `Projects/cormijs/umi` 的静态检查。**首次研究未安装上游依赖、执行上游测试或构建；读到测试用例不等于测试已经运行通过。** 本轮另外建立了独立 Cormi 实验，结果见 [P0 记录](05-p0-results.md)，不改写为上游测试已通过。文中区分源码事实、推论和设计决定。

## 1. 可复现的研究基线

| 项目 | Cordis | Umi |
| --- | --- | --- |
| 上游 | `https://github.com/cordiverse/cordis` | `https://github.com/umijs/umi` |
| 分支 | `main` | `master` |
| HEAD | `5dac6953d2d993d345d1de9fb0a5926f6d78a7e7` | `788e39630dc52a9306c89f8af08705e5db0e199f` |
| 提交时间 | `2026-10-15T20:32:55+08:00` | `2026-10-13T14:49:42+08:00` |
| 提交标题 | `fix(core): settle disposed fibers to DISPOSED (#133)` | `release: 4.7.24` |
| 核心包 | `cordis@4.0.0-rc.11` | `@umijs/core@4.7.24` |
| Git 跟踪文件数 | 145 | 3662 |
| 克隆范围 | 默认分支浅克隆，depth 1 | 默认分支浅克隆，depth 1 |

文件数只是本次工作树记录，不用来推导性能、维护难度或代码质量。包版本来自各仓库的 `package.json`，没有把它当作 npm 发布状态验证结果。

克隆时 Git 直连 GitHub 超时，随后读取到 Mac 系统已启用 `127.0.0.1:7890` 代理，使用单次 `git -c http.proxy=... clone` 完成。没有改全局 Git 配置或系统代理。

## 2. Cordis 实际提供的能力

### 2.1 Context、Service 与 Fiber 是三个不同层次

`Context` 构造时建立根 Fiber，以及 reflect、registry、events、logger 等服务；`extend()`、`isolate()` 提供上下文派生与服务可见域。`Service` 的构造函数通过 `ctx.reflect.provide()` 注册服务。插件实例的执行、状态切换与资源清理由 Fiber 负责。[C1][C2][C3]

**设计含义：** Cormi 不需要再造一套 DI 容器或插件生命周期。应直接依赖 Cordis，另加项目配置、路由建模、编译调度和构建适配这些领域能力。上下文隔离也不是安全沙箱，不能拿来运行不可信插件。

### 2.2 插件注册返回可等待的 Fiber，但等待不等于全部依赖就绪

`registry.plugin()` 返回带 `then()` 的 Fiber 包装对象，内部转交 `fiber.await()`。后者等待当前 `inertia`，遇到 `_error` 抛出，然后返回 Fiber。`_refresh()` 在找不到注入服务时把目标设为 inactive，因此一个没有运行中任务、仍处于 `PENDING` 的 Fiber 也可能从 `await()` 返回。[C3][C4]

**关键推论：** 不能把 `await ctx.plugin(plugin)` 或 `await Promise.all(fibers)` 直接当成整个框架的“已就绪”屏障。Cormi 必须在封闭插件注册集合后检查必需插件状态、缺失服务和失败原因，并设置明确超时。`inject` 不会替项目安装缺失的 npm 包，也不自动替你设计无环的业务执行图。

另一个需要实验覆盖的场景是：父插件提供服务，同时等待一个依赖该服务的子插件完成加载。服务提供者是否已进入可用状态，可能与父 `apply` 完成互相等待。不要在没有验证的情况下用嵌套 `await` 编排所有服务。

### 2.3 当前事件 API 的名称不能按旧印象解释

| API | 本次源码语义 | Cormi 使用边界 |
| --- | --- | --- |
| `emit` | 同步逐个调用，不等待异步监听器 | 同步通知；不用来等待编译步骤 |
| `parallel` | `Promise.allSettled`，最终用 `AggregateError` 聚合失败 | 相互独立、必须等待结束的任务 |
| `serial` | 逐个 await，返回值满足 bail 条件时提前停止 | 有意设计的短路链，不作为默认“执行全部” |
| `bail` | 同步短路 | 同步查找/拦截 |
| `waterfall` | 最后一个参数是 inner callback，以 `next()` 组合中间件 | 围绕某操作的包装，不是 value reducer |

以上来自 `events.ts:95–140`。`isBailed()` 把非 `null / false / undefined` 的值视为短路值，包含 `0` 和空字符串。Umi 的 `modify*` 则通过 Tapable `AsyncSeriesWaterfallHook` 传递 memo；这两种 waterfall 不同。[C5][U1]

**设计决定：** 框架编译扩展点单独定义 `series / reduce / collect / notify`，明确返回类型、顺序和错误策略。它管理编译回调，不接管 Cordis 的插件生死，也不做 Umi API 的逐名兼容。

### 2.4 生命周期可清理，不代表任意副作用可回滚

`ctx.effect()` 收集 disposer；事件注册也绑定到调用者 Fiber。`reflect.provide()` 在撤回服务时通知依赖方，并等待相关消费者清理。`fiber._unload()` 等待消费者后，使用 `Promise.all` 执行本 Fiber 收集的清理任务；清理错误会被记录到日志。[C3][C5][C6]

因此不能宣称所有资源按全局 LIFO 清理，也不能宣称数据库写入、外部网络请求或生成文件自动事务回滚。同一个 effect 内存在反序清理逻辑，但这与所有独立 effect 的全局顺序是两件事。

**设计决定：** 存在顺序约束的资源由同一个 owner 显式编排清理；构建取消、watcher 关闭和端口释放都需要自己的等待与诊断。Cormi 编译产物使用受控写入策略，而不是依赖 Cordis 恢复磁盘历史。

### 2.5 配置校验已使用 Standard Schema，且这里不支持异步校验

`Plugin.Base.Config` 的类型是 `StandardSchemaV1`；`fiber.resolveConfig()` 调用 `Config['~standard'].validate()`，检测到 Promise 时抛出 `Async config validation is not supported`。[C3][C4]

**设计决定：** 插件 options 采用同步 schema 校验；需要网络或文件异步检查的内容进入独立 check 阶段。不要假定 core 内有 `ctx.schema()` 这样的应用配置 API。`cordis.yml`、模块装载和配置树来自上层 CLI/loader/include 组合，不是使用 Context 时必须采用的配置协议。

### 2.6 源码 HMR 是单独的能力，而且有 Node 内部接口依赖

本次 `packages/hmr/src/index.ts` 注入 `loader` 和 `timer`，管理文件 watcher、模块依赖和插件替换；缺少 loader internals 时明确关闭源码 HMR。`packages/loader/src/internal.ts` 尝试通过 `--expose-internals` 或 `node-addon-require-builtin` 取得 Node ESM 内部 loader，并适配不同接口形态。[C7][C8]

**设计决定：** MVP 不要求这些内部接口，不引入该 HMR 插件作为核心依赖。浏览器组件更新交给 Vite；Node 配置和插件源码变更先重启 Cormi worker。日后要做细粒度热替换，再独立评估模块缓存、传递依赖和停机清理。

### 2.7 已有嵌套插件，不必把每个内部模块暴露给用户

`plugin.spec.ts:86–121` 有嵌套插件注册和父级卸载后移除子插件监听器的用例；`service-dispose.spec.ts` 覆盖服务提供者与消费者的清理顺序。[C9][C10]

**设计决定：** 用户只配置 `react`、`mock` 等少量功能/preset。React preset 内部可以挂载路由和 runtime 集成等子插件，不把十几个内部组件平铺到用户配置中。这里仅记录上游测试意图，本次未运行这些测试。

## 3. Umi 值得借鉴的不是 API 表面，而是工作流

### 3.1 Service 有明确的启动阶段

Umi 的 `service.ts` 依次完成环境和用户配置读取、preset 初始化、plugin 初始化、schema/default 收集、配置解析、应用数据收集、检查、启动钩子以及命令执行。`pluginAPI.register()` 明确限制 hook 在注册阶段之后继续登记。[U1][U2]

**设计含义：** 即使 Cordis 支持动态插件，也不能让生产构建读到一份不断变化的插件注册表。Cormi 应在执行编译前建立封闭的注册快照，在下一轮重新生成结果，而不是边 build 边修改全局配置。

### 3.2 扩展点具有明确的执行语义和排序

`applyPlugins()` 将 add、modify、event 映射到不同 hook 调用方式，并通过 `stage`、`before` 影响顺序。`Hook` 保存插件来源。`PluginAPI` 提供 describe、command、generator 和扩展方法注册，并检查重复命令/方法。[U1][U2][U3]

**设计含义：** Cormi 也需要来源追踪、冲突报告和确定性排序，但没有必要复制全部方法。服务依赖顺序与编译回调顺序必须分开表达。

### 3.3 临时文件是 Node 插件与浏览器运行时之间的桥梁

`tmpFiles.ts` 生成 tsconfig、入口、路由和 runtime plugin 清单；运行时插件通过 `addRuntimePlugin` 收集，再生成 `core/plugin.ts`。React renderer 在浏览器中读取路由和 plugin manager，触发路由回调并组合 providers。[U4][U5]

**设计决定：** Node 端插件仅贡献可生成的描述信息，浏览器通过静态 import 装配 runtime。不要把 Context、Node 服务实例或服务端密钥序列化给浏览器，也不要让浏览器 bundle 因为公共入口 re-export 意外带入 Cordis/Vite/fs。

### 3.4 路由规则必须以当前实现为准

本次 `routesConvention.ts` 扫描路由文件、构造父子关系，并在 `createRoutePath()` 中处理 `$`、点分隔和 index；`utils.ts` 定义扩展名和过滤规则。[U6]

这说明不能拿旧版 Umi 文档中的几个文件命名示例，就宣称已掌握当前完整路由规则。Cormi 可以采用自己更小的一套规则，但应明确这是新协议，而不是声称完全兼容 Umi。

### 3.5 不应直接搬走整个 bundler 适配包

Umi `features/bundler/bundler.ts` 已有 webpack、vite、mako、utoopack 分支；`@umijs/bundler-vite` 将 Umi options 和中间件传入自己的配置转换与 server 层。[U7]

**设计决定（Draft 0.2 修订）：** 构建能力由 Cordis 服务契约 `ctx.builder` 提供；独立的官方 `plugin-vite` 实现该契约，内部直接调用 Vite 官方 JS API，并通过 `ctx.vite` 暴露后端专属扩展口。core 不 import Vite，也不泄漏其类型。默认 `preset-react-vite` 选择 Vite，但用户可另行组合 provider；不为复用少量代码而携带 Umi 整套配置类型、require hook 和兼容层。首版只实现一个真实后端，不等于推迟建立替换边界。

### 3.6 配置不能继续按“只有 Joi”描述

本次 Umi `config.ts:205–238` 同时识别 Joi 和 Zod schema；`diffConfigs()` 按配置项的 onChange 策略分类变更。[U8]

**设计含义：** 借鉴“配置项有变更策略”，不复刻历史兼容负担。首版 Cormi 所有 Node 配置变化采取完整 worker 重启，后续有测量证据后再允许部分配置增量生效。

## 4. 对此前研究结论的修正

此前研究可保留“Cordis 是插件内核、需要额外应用框架层”的总方向，但以下说法不能作为实现依据：将第三方应用的配置惯例当作 Cordis core API；把 `inject` 等同于完整构建 DAG；把可清理副作用等同于任意事务回滚；把 Cordis 源码 HMR 等同于 React Fast Refresh；使用 Umi 3 的页面规则或 SSR 文档概括本次 Umi 4 源码；未实测就断言框架更轻、更快或给出确定工期。

没有源码支持的组织背景、商业归属和社区发展描述不纳入设计。后续只按本次固定提交及 P0 运行结果推进。

## 5. 源码索引

以下本地路径均相对于本文。GitHub 链接固定到本次提交，避免默认分支更新导致解释漂移。

- [C1] [context.ts](../cordis/packages/core/src/context.ts)，重点 36–76 行；[固定提交](https://github.com/cordiverse/cordis/blob/5dac6953d2d993d345d1de9fb0a5926f6d78a7e7/packages/core/src/context.ts#L36-L76)。
- [C2] [service.ts](../cordis/packages/core/src/service.ts)，20–36 行；[固定提交](https://github.com/cordiverse/cordis/blob/5dac6953d2d993d345d1de9fb0a5926f6d78a7e7/packages/core/src/service.ts#L20-L36)。
- [C3] [fiber.ts](../cordis/packages/core/src/fiber.ts)，34–45、273–337、383–487 行；[固定提交](https://github.com/cordiverse/cordis/blob/5dac6953d2d993d345d1de9fb0a5926f6d78a7e7/packages/core/src/fiber.ts)。
- [C4] [registry.ts](../cordis/packages/core/src/registry.ts)，63–99、118–122、193–212 行；[固定提交](https://github.com/cordiverse/cordis/blob/5dac6953d2d993d345d1de9fb0a5926f6d78a7e7/packages/core/src/registry.ts)。
- [C5] [events.ts](../cordis/packages/core/src/events.ts)，95–148 行；[固定提交](https://github.com/cordiverse/cordis/blob/5dac6953d2d993d345d1de9fb0a5926f6d78a7e7/packages/core/src/events.ts#L95-L148)。
- [C6] [reflect.ts](../cordis/packages/core/src/reflect.ts)，181–258 行；[固定提交](https://github.com/cordiverse/cordis/blob/5dac6953d2d993d345d1de9fb0a5926f6d78a7e7/packages/core/src/reflect.ts#L181-L258)。
- [C7] [hmr/index.ts](../cordis/packages/hmr/src/index.ts)，80–198 行；[固定提交](https://github.com/cordiverse/cordis/blob/5dac6953d2d993d345d1de9fb0a5926f6d78a7e7/packages/hmr/src/index.ts#L80-L198)。
- [C8] [loader/internal.ts](../cordis/packages/loader/src/internal.ts)，96–134 行；[固定提交](https://github.com/cordiverse/cordis/blob/5dac6953d2d993d345d1de9fb0a5926f6d78a7e7/packages/loader/src/internal.ts#L96-L134)。
- [C9] [plugin.spec.ts](../cordis/packages/core/tests/plugin.spec.ts)，86–121 行。
- [C10] [service-dispose.spec.ts](../cordis/packages/core/tests/service-dispose.spec.ts)，48–120 行。
- [U1] [service.ts](../umi/packages/core/src/service/service.ts)，130–244、318–411 行；[固定提交](https://github.com/umijs/umi/blob/788e39630dc52a9306c89f8af08705e5db0e199f/packages/core/src/service/service.ts)。
- [U2] [pluginAPI.ts](../umi/packages/core/src/service/pluginAPI.ts)，72–162 行；[固定提交](https://github.com/umijs/umi/blob/788e39630dc52a9306c89f8af08705e5db0e199f/packages/core/src/service/pluginAPI.ts#L72-L162)。
- [U3] [hook.ts](../umi/packages/core/src/service/hook.ts)，1–29 行。
- [U4] [tmpFiles.ts](../umi/packages/preset-umi/src/features/tmpFiles/tmpFiles.ts)，27–123、310–509 行；[固定提交](https://github.com/umijs/umi/blob/788e39630dc52a9306c89f8af08705e5db0e199f/packages/preset-umi/src/features/tmpFiles/tmpFiles.ts#L310-L509)。
- [U5] [browser.tsx](../umi/packages/renderer-react/src/browser.tsx)，28–78、170–210 行。
- [U6] [routesConvention.ts](../umi/packages/core/src/route/routesConvention.ts)，8–109 行；另见 [route/utils.ts](../umi/packages/core/src/route/utils.ts)。
- [U7] [bundler.ts](../umi/packages/preset-umi/src/features/bundler/bundler.ts) 与 [bundler-vite/dev.ts](../umi/packages/bundler-vite/src/dev.ts)。
- [U8] [config.ts](../umi/packages/core/src/config/config.ts)，165–266 行。

两仓库均保留原始 LICENSE：[Cordis](../cordis/LICENSE)、[Umi](../umi/LICENSE)。以后实际复制或改编源码时记录来源并保留相关版权与许可声明，不把研究阅读当作已经完成代码迁移。
## 6. 官方补充资料

检索日期：2026-10-16。官方站点可能滚动更新；这里只用来确认集成接口，不据此声称已经锁定某个最新包版本。

- [Vite JavaScript API](https://vite.dev/guide/api-javascript.html)：`createServer`、`build`、关闭开发服务器，以及同进程 dev/build 的环境变量注意事项。
- [Vite Plugin API](https://vite.dev/guide/api-plugin.html)：插件顺序、HTML 处理、HMR 与虚拟模块；`configureServer` 返回函数是后置安装回调，不是资源 disposer。
- [Vite Getting Started](https://vite.dev/guide/)：Node 版本门槛与 HTML 入口机制。
- [Vite Env and Mode](https://vite.dev/guide/env-and-mode.html)：客户端环境变量暴露边界。
- [React Router Data Mode](https://reactrouter.com/start/data/installation)：通过 `createBrowserRouter` 与 `RouterProvider` 组合应用，而不是再叠加一个完整框架模式。
- [React createRoot](https://react.dev/reference/react-dom/client/createRoot)：客户端 root 的创建和清理约定。

## 7. 插件优先修订与发布基线

以下是新增的设计参考，不改写前文固定源码检查结果。Koishi 的[服务与依赖](https://koishi.chat/zh-CN/guide/plugin/service)区分服务定义与具体插件实现；此前讨论引用的 [DeepSeek Harness 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)把能力分为 definition/provider/consumer，并由 profile/bundle 组合默认产品。Cormi 借鉴这种依赖方向：Web 编排消费 builder，Vite 插件提供 builder，preset 决定默认实现。不复制其具体版本 API，也不要求每个纯函数成为插件。

2026-10-16 实现前核对 npm registry：`cordis@4.0.0-rc.11` 的 `gitHead` 是 `0b96d9fd517b998e44e2209560c9e5f0671ce933`，并非本地参考 HEAD `5dac6953d2d993d345d1de9fb0a5926f6d78a7e7`。包内版本相同不代表代码相同。P0 先针对精确锁定的 npm 发布包实验；本地 HEAD 的 disposed-state 修复不能假设已经发布。适配和实验结果需单独记录，不静默修改上游或把实验通过外推到另一提交。
