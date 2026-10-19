# cormi：插件依赖与贡献诊断协议

日期：2026-10-19。本协议描述 P7 的实现，不把诊断视为第二套插件生命周期。真实运行与分发结果另行记录。服务归属以当前 Cordis 实例为依据，Admin 仍只作为框架测试负载。

## 1. 三个不同问题，三个明确入口

`cormi config --for dev|build` 解释当前应用配置及派生结果；`cormi inspect` 读取上一次成功生成的路由/运行时快照；新增的 `cormi diagnose --for dev|build` 在新 worker 求值配置并初始化插件后，观察服务、依赖和贡献身份。它不执行目标命令、不执行配置派生或路由 reducer、不 prepare、不 build、不创建框架开发服务器。

```sh
pnpm cormi diagnose --root examples/features --for dev
pnpm cormi diagnose --root examples/features --for build --mode staging --json
```

默认目标是 dev，`--for` 同时决定配置工厂接收的 command、默认 mode 及 worker 的 NODE_ENV。JSON 模式保持既有逐行事件协议：成功时 result.data 为 `Diagnosis`；插件就绪或元数据失败时先输出 diagnosis.data，再非零退出。`Diagnosis` 类型从 `cormijs` 导出。正常文本显示插件来源、父子层级、服务提供者和依赖解析状态。

**这是 fresh-worker-before-command，不是运行中 dev 的在线状态。** 同项目仍使用独占锁，不能在另一个 CLI 正持锁时绕过它。配置和插件初始化仍会执行可信用户代码，不能称为无副作用的静态扫描。配置语法或顶层结构未成功解析时没有真实宿主，不编造一份插件图。目标命令的业务验证、缺失页面、端口占用和后续构建失败不由 healthy 字段保证。

## 2. Cordis 是唯一生命周期事实来源

`ProjectRuntime.graph()` 是同步、冻结的观察 API。小型 RC.11 适配器读取 Cordis 的 registry fibers、parent、inject、provisions、committed，以及 reflect.store 与 Context.isolate。它不写这些对象，不调用服务方法/getter/check，不读取服务 value、插件 options 或异常堆栈，不依赖包依赖推断服务关系。

图中的 `fiber:<uid>` 和 `service:<uid>` 是当前宿主中的身份，不是跨启动的持久ID；已退出但仍被清理绑定引用的 Fiber 使用本次快照的 retired 标识。配置中的稳定 pluginId 与 preset/user 来源另外连接；禁用项列在 configured 中，没有伪造的激活节点。节点预算2048、服务4096、依赖边8192，超额明确失败，不截出一个冒充完整的图。

重要区分是**注册表中存在、提供者活跃、消费者持有绑定**并不等价：

| resolution | 本次快照事实 |
| --- | --- |
| bound | 消费者已提交的绑定与当前可见实现相同，提供者活跃 |
| retained-binding | 消费者仍持有旧绑定，但实现不再可见或提供者不再活跃 |
| missing | 本作用域没有当前可见实现，也没有已提交绑定 |
| provider-not-active | 有当前可见实现，但提供者尚未/已经不活跃且消费者无提交绑定 |
| visible-unbound | 提供者活跃且可见，但此消费者尚未提交绑定；不擅自推断精确原因 |

同名服务可以在不同隔离域由不同插件提供；按隔离符号定位，不能按字符串name把它们合并。服务自己的check可能拒绝依赖，但为了诊断再次调用check会产生额外行为，因此这里只报告visible-unbound，不伪造通过或再次执行业务校验。

本次实测 npm RC.11 在 provider 整体卸载时会先等待依赖方清理，store 项仍可能存在，此时 provider.uid 已为空，消费者 committed 仍可使用；显式撤回 ctx.provide 则可以先从 store 删除。诊断分别报告这两种事实，不能仅看 registered=true 就认为可以接受新消费者。历史参考 checkout 与 npm RC.11不是同一提交，必须对实际安装行为验证。

## 3. 贡献诊断是可选的原生服务

`DiagnosticService` 从 `@cormijs/core` 导出，使用 Cordis Service 和调用者 effect。CLI 在应用插件之前安装该服务；直接使用低层 ProjectRuntime 的程序可以选择是否安装。它不是通用事件总线、RPC 或另一套插件注册表，只收集已明确登记的同步公开元数据读取器。

```ts
import type { Plugin } from '@cormijs/core';

export const feature: Plugin.Object<void> = {
  name: 'example:feature',
  apply(ctx) {
    ctx.get('diagnostics')?.add('example:feature', () => [
      { kind: 'extension', id: 'example:feature', ownerUid: ctx.fiber.uid },
    ]);
  },
};
```

add 的登记随调用者作用域撤回，手动注销立即阻止后续读取，返回幂等 Promise 等待原生 effect 清理。读取器在本次采集期间被注销时不能再执行；注册集合变化使整批状态成为 stale，不能混合不同版本。默认最多128个读取器、每个512条记录、总2048条。只接受 kind/id/ownerUid/declaredOwner 这些身份字段，拒绝额外字段、访问器、稀疏数组和异步读取器；失败仅显示 failed，不输出原异常。原生 Promise 误返回会处理其拒绝，避免未处理拒绝污染进程，但不会把异步任务当成成功采集。

当前官方接入：命令注册表报告命令名；React 报告 route/runtime hook 的ID及其声明owner；配置服务报告 derive hook 身份；开发API报告贡献、公开路径/方法及登记时捕获的真实调用者UID。**声明owner不等于已验证的Fiber身份**，因此分别使用 declaredOwner 和 ownerUid；CLI不通过名字相似猜关联，也不执行route reducer来制造“最终路由来源”。

已在调用者初始化时发现diagnostics服务才会登记可选读取器；不安装服务的低层宿主不会因此缺失必需依赖。后安装一个服务不会反向补出过去未登记的领域摘要。第三方未接入的领域贡献不在报告内，不能把没有section等同于没有贡献。读取器本身是可信代码，身份标签不能放密钥，结构过滤不是不可信插件沙箱。

## 4. 命令与失败边界

诊断必须能在应用插件 PENDING/FAILED 时运行，所以 diagnose 是启动器保留的观察分支，不通过需要完整就绪才能执行的业务命令middleware。cormi:diagnostics 与 cormi:commands 为启动基础设施的保留实例ID，普通Web命令仍由插件提供，未向启动器搬入Vite/React策略。

成功报告使用原有 result 协议，在 worker 清理成功后交付；清理失败不能发送成功 result。健康度同时检查原生状态、就绪结果、领域读取器状态以及采集前后图的一致性。失败报告保持非零退出，不因“打印了JSON”就认为启动成功。诊断总输出限制2MiB；公开标签去控制字符并限长，但用户自己的console/日志、配置执行副作用仍不属于该过滤器保障。

## 5. 参考依据与不照搬的部分

本轮继续读取固定 [WebUI ServiceProvider](../references/koishi-webui/plugins/config/src/shared/services.ts)，借鉴按真实服务和作用域提供数据的方式；该文件基于Cordis3，不能复制其ctx.scope/_internal访问到Cordis4。[Cordis反射](../cordis/packages/core/src/reflect.ts) 和 [Fiber](../cordis/packages/core/src/fiber.ts)用于理解关系，最终通过安装包公开声明及真实进程探针验证。

读取 registry.counter 会推进Cordis计数器，不是无副作用的版本查询。本轮回归明确检查图快照不会消耗下一个UID。诊断不调用服务的check，也不从错误字符串猜服务归属。NodeNext声明引用从已导出Fiber的provisions类型推导实现类型，不深导入未公开的Impl类型，不修改上游声明补丁或运行时。

本轮不提供在线诊断端点、插件市场、诊断UI、历史事件回放、完整服务调用追踪、包依赖分析或任意线程/进程的附加调试。需要这些能力时以实际使用问题另行设计，不让Admin模板再次变成产品主线。
