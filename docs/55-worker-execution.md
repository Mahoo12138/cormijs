# cormi：原生 worker 执行策略与可复用 CLI 入口

P15 实现协议。基于 P14 的父进程引导插件，继续拆出 worker 内普通命令和失败诊断的执行策略。本协议不把策略替换等同于安全沙箱、任意任务回滚或整个框架所有机制已可替换。最终结果见 [P15 记录](56-p15-results.md)。

## 1. 三个层次，不是三套生命周期

父进程的 `bootstrap` 在应用配置之前运行，决定启动计划、环境快照和重载唤醒。worker 的 `worker` 组合在合法配置求值之后、应用插件初始化之前运行，提供命令执行策略及其依赖。应用的 `plugins/presets` 仍贡献路由、runtime、构建、业务命令等能力。三者均使用原生 Cordis Context、Fiber、inject、effect；不新建插件状态机。

P14 的 bootstrap 必须在配置之外选择，以避免坏配置循环依赖；P15 的 worker 组合则可以由已经合法的 `cormi.config.ts` 返回。这里不提供在语法错误/顶层求值失败时伪造插件图的能力。两个字段的作用域不同，不把父进程中的函数通过 IPC 序列化到子进程。

## 2. 公开入口与组合

`cormijs/worker` 是插件作者入口，不是启动 worker 子进程的可执行文件。提供 `WorkerExecution`、`WorkerExecutionContext`、`WorkerApplication`、`WorkerReadiness`、`WorkerReport`，以及 `createWorkerProfile()`、`defaultWorkerProfile`、`commandExecutionPlugin` 和 `diagnosticExecutionPlugin`。

顶层配置新增可选 `worker: Plugin<WorkerProfileOptions>`，`WorkerProfileOptions.command` 为实际请求的命令。省略字段保留原命令体验：默认组合选择普通执行器；请求 diagnose 时选择诊断执行器。该选择只在可替换的默认组合中，不再是 worker.ts 的保留分支，也不再禁止用户向普通命令注册表登记同名 diagnose。

`createWorkerProfile({ execution?, commands?, diagnostics? })` 通过 ctx.plugin 装配子插件。commands 与 diagnostics 可以分别替换或显式 false。默认命令注册表在诊断服务可用后安装，以免漏登记命令来源；这是原生依赖关系，不依赖巧合的异步完成顺序。明确关闭所需依赖后，相关执行器仍会正常报缺失服务，而不是自动补回默认提供者。

机制消费者 `cormi:execution-consumer` 注入 `workerExecution`，使用已提交绑定调用服务；基础组合为 `cormi:worker-profile`。这两个宿主ID保留。缺失/重复提供者在应用激活之前失败，撤回必需提供者结束当前执行，不静默切换默认实现。配置来源中的应用ID与原生嵌套图分别保留，新增内部节点不是应用功能项。

## 3. 执行、就绪与失败诊断

执行器接收 command、既有 CommandRequest、application 和 report。`application.initialize()` 只进行一次应用装配和就绪尝试，重复调用返回同一 Promise，结果明确为 `{ok:true}` 或 `{ok:false,error}`。它不在 apply 内执行耗时任务，不创建第二次初始化状态机；底层是否已激活仍以 Cordis 为依据。

默认普通执行器先等待应用就绪，失败抛回原错误，再通过自己注入的 commands 执行请求。默认诊断执行器同样尝试初始化，但可以在 PENDING/FAILED 状态读取实际宿主和已登记的公开元数据；它不执行目标业务命令、中间件、路由计算或配置派生。失败报告仍先发 diagnosis 再非零退出，成功报告仍在完整清理成功后交付。

自定义执行器可以有意不初始化应用，例如只执行独立工具；机制不会擅自改变其产品语义。相应成功结果不保证整份业务应用已启动，不能把自定义 executor 返回 true 当作框架健康认证。已经请求但未 await 的初始化仍被宿主跟踪，结束前必须等待；推荐作者总是显式 await 并处理结果。

## 4. 替换例子

复用同一诊断插件处理自定义 `audit` 命令，不复制 worker：

```ts
import { defineConfig } from 'cormijs';
import { createWorkerProfile, diagnosticExecutionPlugin } from 'cormijs/worker';

export default defineConfig({
  worker: createWorkerProfile({ execution: diagnosticExecutionPlugin }),
  plugins: [],
});
```

执行 `pnpm exec cormi audit --json`。这个配置将所有请求都交给所选诊断策略；需要按不同命令选择时，自己提供一个原生父插件，根据其 command 装配所需执行器。普通应用保留默认组合即可，不要求人人新增 worker 字段。

只需要普通命令、不需要诊断服务时：

```ts
import { defineConfig } from 'cormijs';
import { createWorkerProfile, commandExecutionPlugin } from 'cormijs/worker';

export default defineConfig({
  worker: createWorkerProfile({
    execution: commandExecutionPlugin,
    diagnostics: false,
  }),
  plugins: [], // 在这里添加明确注入 commands 的应用命令插件。
});
```

## 5. 观察消息与成功交付不是同一件事

自定义观察消息使用 `report({type:'execution-report',name:'example:check',data:{...}})`。消息复制并冻结，类型外壳只能是约定的报告类型，不能构造 ready/result/stopped 或添加 version 覆盖私有 IPC。每次最多64条、序列化合计2MiB；超限明确失败，已接受观察不回滚，也不能因此发送成功结果。默认诊断沿用既有 Diagnosis 类型和数据构造规则，第三方必须遵循其完整结构，不能仅凭 format 字符串伪造报告。

报告不是服务端实时日志流。执行方法返回、取消或提供者退出后不再接受迟到报告；普通后台监测应有自己的独立需求和受管资源设计。report 的 JSON 限制不自动识别秘密，标签和数据必须由插件作者明确选择为可公开内容。可信插件自己的 console、任意 process.send 和外部副作用不属于这个 API 的保护范围。

执行结果继续为一次性 result 或 server handle。已接受 server 的 URL、状态和 close 方法会被捕获，提供者后来修改原对象不会改变关闭目标。关闭句柄幂等；即使 URL 等元数据非法，只要已获得可关闭句柄，也会先保存并在失败退出时释放它。取消后才返回的迟到句柄同样需要真正关闭，不能只丢弃 Promise。

## 6. 退出与重载

worker 先停止准入并取消，等待已进入的执行/初始化、关闭会话，再销毁原生宿主；清理失败不发送成功 result。IPC 继续等待实际发送回调结束，不承诺接收方持久确认或断线重放。启动期限仍包含一次性执行；不合作任务交给既有 worker 期限处理，准确父进程只终止自己拥有的 child。

必需执行提供者撤回时发出 EXECUTION_WITHDRAWN，取消其请求、关闭服务并保持非零结果。不会自动换另一个 executor 重放同一命令。配置和 worker 源文件变化仍走完整 worker 代际重启，坏源码保留已有服务，修复用最新输入，不承诺进程内插件源码 HMR 或组件状态无损。

退出函数在取消回调之前保存唯一关闭 Promise，因此同步 AbortSignal 回调再次请求停止不会形成第二次关闭、重复终态消息或竞争计时器。状态机只属于一次进程调用/会话所有权，不取代 Cordis 的插件生命周期。

## 7. 自定义载体不再复制 CLI

`cormijs/cli` 的 `runCormiCli(argv, {bootstrap?,signal?,stdout?,stderr?})` 复用标准参数、输出和控制信号绑定。导入入口不执行命令或注册监听器；调用结束只移除自己的监听器，不设置载体的 process.exitCode，不关闭载体已有 IPC。正式可执行文件自行拥有退出码和 IPC 断连。

```js
// launch.mjs：项目已安装 cormi，companyBootstrap 是自己的原生组合。
import { runCormiCli } from 'cormijs/cli';
import companyBootstrap from './company-bootstrap.mjs';

process.exitCode = await runCormiCli(process.argv.slice(2), {
  bootstrap: companyBootstrap,
});
```

现在 `node launch.mjs dev --mode staging`、`node launch.mjs build --mode staging` 或 `node launch.mjs --help` 使用同一参数协议；无需每个载体重写 parseArgs、SIGINT/SIGTERM 和 JSON 日志。此入口仍是 Node 进程级控制器，建议同一进程只运行一条 CLI 生命周期；更复杂的并发宿主用已有低层 runCormi 自行明确控制，不声称信号完全实例隔离。没有新增隐式配置文件、CLI --bootstrap 或全局持久注册表。

## 8. 生态依据与未扩张的范围

本轮读取固定 DeepSeek Harness `packages/boot/README.md`、`packages/boot/cmdline/README.md` 和 `cmdline/src/index.ts` 的应用自有参数/退出请求、就绪后再退出、原生 effect 清理设计；固定提交仍为 687f282e8625c6b8d11ff58211a90524be2e4317。借鉴职责与验收方式，不复制其 vendored Cordis、commander 层或 app-boot 实现。现有 cormi npm Cordis RC.11 与其运行时不是同一个版本。

core、React/Vite provider、浏览器 runtime 和 Admin 业务不为本轮增加分支；配置转译器和环境公开规则仍保留既有边界。此轮不做在线诊断、插件市场、Node 任意源码细粒度热替换、远端密钥库、Windows 或公开发布。bootstrap 在父进程、worker profile 在子进程均是可信代码；插件化不是恶意代码沙箱。
