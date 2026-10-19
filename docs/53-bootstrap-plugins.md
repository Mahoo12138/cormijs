# cormi：原生 Cordis 引导插件与启动策略

P14 实现协议。它拆分的是启动前的默认策略，不将整个框架、任意 Node HMR 或诊断执行都称为已经完全插件化。实际测试、提交与证据见 [P14 结果](54-p14-results.md)。

## 1. 为什么不能把引导插件放进应用配置

应用配置需要先得到 command、mode 和环境快照；配置自己可能含语法错误。若只能在 `cormi.config.ts` 中选择环境读取器或监视器，就会形成“先成功读取配置，才能知道如何读取/修复配置”的循环。

因此 `runCormi()` 增加可选 `bootstrap: Plugin<void>`。调用方在应用配置之外显式提供原生 Cordis 组合。未提供时，现有 CLI 使用默认组合，旧应用不需要增加新配置文件。高级集成可以从自己的普通 Node ESM 入口调用同一个 `runCormi`，没有复制第二套 supervisor 算法。当前没有自动搜索 `cormi.bootstrap.ts` 或新增 CLI `--bootstrap`；应用的 presets/plugins 仍只在 worker 中装配。

parent 和 worker 各有自己的 Cordis 宿主，但都复用原有 Context/Fiber/ProjectRuntime，并非两套不同的生命周期。引导插件在调用进程运行，应用插件及配置求值仍在隔离 worker。`createBootstrap()` 只是用 `ctx.plugin()` 挂载原生子插件；替换一个提供者时不会先装默认同名服务再静默覆盖。

## 2. 三个服务和一个机制消费者

公开入口 `cormijs/bootstrap` 提供类型、默认插件和组合函数。`cormijs/launcher` 保留 `runCormi` 及其参数类型。

| 服务 | 契约 | 默认原生提供者 |
| --- | --- | --- |
| launchPolicy | resolve(request) 返回 configurationCommand、mode、nodeEnv、watch | defaultLaunchPolicyPlugin |
| launchEnvironment | files(root, plan) 返回候选文件；load(request) 返回不可变环境快照 | dotenvEnvironmentPlugin |
| launchReload | wait(request) 返回本次唤醒 Promise | pollingReloadPlugin |

`cormi:launch-consumer` 声明上述三个 inject，通过实际绑定调用服务，退出等待已进入的异步读取/唤醒任务。需要的服务缺失、重复提供者、接口形状不正确、配置计划非法时，在启动应用 worker 前失败。提供者被撤回时，消费者的原生 effect 发起关闭；当前执行结束，不偷偷切回默认插件或自动重放命令。

父插件负责组合，不在其 apply 中等待依赖父服务的子插件就绪。与上游一样，服务依赖回答资源可用性；输入代际、子进程状态和文件提交由各自机制负责，不额外创建一个插件状态机。

## 3. 可替换部分与必须保留的约束

策略决定默认命令环境、业务 mode 和是否继续监视。显式传入的 mode/watch/configurationCommand 不能被返回值悄悄改写；`nodeEnv` 目前只接受 development/production。实际执行的 handler 仍由调用方 command 决定，不因为 configurationCommand 改变就执行另一个命令。默认配置/diagnose 的 `--for` 语义与此前保持一致。

环境提供者选择最多16个项目内绝对候选文件，包括尚不存在的文件，集合固定于本次启动。值快照经过结构、预算、键名和公开来源标签验证并冻结，然后交给编译器和私有 IPC。内置 `readEnvironmentFiles(root, mode, files)` 读取明确选择的项目根直属文件，保留已有 UTF-8、普通文件、单文件64KiB、硬链接/符号链接拒绝等规则；不隐式追加 `.env`。默认 provider 仍选择原来的四层 `.env`。

自定义解析器可用同一公开入口的 `fingerprintFiles(files)` 在读取之前记录候选文件指纹，再返回自己的值、文件存在性和公开来源标签；机制层验证该指纹仍然有效。它只观察文件，不替提供者解析内容、选择路径或执行写入。这样 JSON 等提供者不必深导入内部文件或复制指纹算法；独立无 Web 消费者使用 company.json 实际验证此路径。提供者仍需自己的有界读取和格式校验，普通文件系统不是跨文件事务，框架也无法证明任意可信代码确实把返回值从那些文件推导出来。

继承环境优先、`CORMI_PUBLIC_` 公开前缀、worker 私有快照和客户端公开快照的分界没有改成任意回调。这些仍是当前数据协议。提供者自己的异常、console、主动复制密钥或副作用不属于快照结构检查的保密保证。来源标签必须是可公开元数据，不放秘密。

reload 的职责是**唤醒源，而不是另一个进程控制器**。默认是有取消信号的轮询等待；验证用的原生插件替换为真实 `fs.watch` 加有界兜底定时器。唤醒只提示可能有变化，supervisor 每次仍读取已知文件指纹，重查配置清理/就绪边界，合并连续事件并拒绝过期候选。提供者不能通过伪造事件绕过这些准入检查。

`wait()` 要及时响应 AbortSignal，并在返回前收尾自己本次创建的资源；长时间没有文件变化也必须在有界心跳内返回，以便检查实际 worker 状态。这里不承诺任意文件系统事件全部一一交付，而是最终输入被协调处理。普通页面 Fast Refresh、React 路由生成和 Node worker 重启依旧是三个不同粒度。

项目独占锁、准确 ChildProcess、IPC、强制终止仅作用于本轮 child、输入校验和一次性结果不重放仍由机制层持有。所有文件事件都不能导致已执行的一次性命令自动再次执行。

## 4. 一个完整的自定义环境入口

在已经安装 cormi 的应用根保存 `launch.mjs`，并创建普通文本 `company.vars`，例如 `CORMI_PUBLIC_TITLE=Internal staging`。这只是应用自己的载体入口，不创建常驻管理服务。

```js
import { join } from 'node:path';
import { runCormi } from 'cormijs/launcher';
import { createBootstrap, readEnvironmentFiles } from 'cormijs/bootstrap';

const companyEnvironment = {
  name: 'example:company-environment',
  apply(ctx) {
    ctx.provide('launchEnvironment', {
      files(root) {
        return [join(root, 'company.vars')];
      },
      async load({ root, plan, files, signal }) {
        signal.throwIfAborted();
        const result = await readEnvironmentFiles(root, plan.mode, files);
        signal.throwIfAborted();
        return result;
      },
    });
  },
};

const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  process.exitCode = await runCormi({
    root: process.cwd(),
    command: process.argv[2] ?? 'dev',
    mode: 'staging',
    startupTimeoutMs: 30000,
    bootstrap: createBootstrap({ environment: companyEnvironment }),
    signal: controller.signal,
    onEvent: event => console.log(JSON.stringify(event)),
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
```

执行 `node launch.mjs dev`、`node launch.mjs build` 或 `node launch.mjs preview`。修改 company.vars 会触发当前默认重载源；既有 `.env` 不在该自定义选择里，不会因为它损坏而阻止此入口启动。应用页面还是从 `import.meta.env.CORMI_PUBLIC_TITLE` 读取公开值，无须认识自定义文件名。使用标准 `pnpm dev` 则仍走默认四层 dotenv；两种入口需要明确区分。

上例会输出错误对象供本地开发，不能将任意第三方异常直接公开到网络。不要把私密值写进载体源码或 public；候选环境文件会通过 serverOnlyFiles 进入既有后端拒绝规则，载体本身则是可信应用代码，不被这一协议当作自动秘密文件扫描。

## 5. 异步失败不是“退出等待即可”

异步环境读取会跨越真实文件修改。若加载器返回旧快照，而磁盘已经更新，编译器拒绝该代并允许监视模式重新读取最新输入，不能把新的指纹登记成“这代错误已经处理完”从而吞掉唯一修改。坏语法仍采用同内容错误去重，不混成无限自动重试。

读取达到准备期限时，必须终止新的准入并取消/等待当前读取；不能报超时后又启动下一次读取，累积未完成任务。`runCormi` 跟踪整个准备任务，退出时由原生消费者清理等待它真正结束。reload 自身失败同样停止 worker 并保留失败语义，不能同时发出 stopped code 0。

引导代码就在父进程，**不是沙箱**。CPU 死循环会阻塞同一事件循环，期限不等于强制抢占。不合作的任务无法确认结束、或者引导清理失败时，返回 `BOOTSTRAP_CLEANUP_INCOMPLETE` 并保留锁，防止另一实例接管尚有未知写入的目录；迟到任务后来结束也不自动删锁。必须先核实该载体及其资源，不提供按时间/PID猜测的恢复删除。

正常取消期间已经等待的初始化可以收尾；但插件在原生上下文已退出后再登记子插件属于非法操作，不能为了“取消应该成功”吞掉这个错误。测试同时保留正常等待清理和非法迟到登记失败两种契约。

## 6. 仍未拆出的部分

worker 内 `diagnose` 的失败宿主观察分支仍保留，诊断数据服务的启动次序还不是本轮可替换执行器。配置转译仍是现有 esbuild 机制，默认文件选择已解耦但不承诺替换所有配置语法/loader。当前组合只在启动时选择，不做引导源码进程内 HMR、在线 provider 热切换恢复、远端密钥库或通用 RPC。

下一个聚焦点是 worker 命令/失败诊断执行的原生扩展，以及载体配置入口的使用体验；必须保留现有结果发送、初始化失败、清理失败及一次性命令语义。不能把P14描述为把剩余所有 bootstrap 固定策略一次性清空。

## 7. 设计来源与验证入口

继续参考固定 [DeepSeek Harness architecture](../references/deepseek-harness/docs/architecture.md) 的 profile/bundle 和 [Hmr Service](../references/deepseek-harness/packages/boot/hmr/src/index.ts) 的注入、序列化和可等待注销；固定 SHA 仍为 `687f282e8625c6b8d11ff58211a90524be2e4317`。本轮没有复制其 vendored Cordis、运行时修补或千行模块 HMR。cormi 使用的仍是 npm RC.11 和声明补丁，详见 [既有参考清单](../artifacts/deepseek-harness-reference.json)。

Node 验证在 tests/bootstrap*.test.ts；真实独立包/客户端消费在 scripts/test-package.ts。后者使用安装后的公共入口检查原生组合、严格类型、自定义文件的Node/HTML/客户端一致性、私有文件拒绝、生产构建与构建后环境变化的旧产物预览。P13有限可靠性样本与原框架浏览器测试作为回归，不以源码目录可运行替代真实打包消费。
