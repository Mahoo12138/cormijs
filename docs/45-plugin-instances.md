# cormi：配对插件的多实例与命名空间

日期：2026-10-19。P10 在现有 plugin-react 作者模板上增加显式实例身份、路由与开发 API 路径、实例配置选择及回归。Node 仍由原生 Cordis 挂载同一个插件对象，浏览器继续使用已有生成式 React runtime；不新增插件加载器、租户系统、管理界面或服务容器。实际运行结果另见 [P10 结果](46-p10-results.md)。

## 1. 三种身份不能混为一谈

外层配置 `id` 标识 preset/配置中的一项，用于配置冲突与 diagnose 关联。插件 options 的 `instance` 标识该插件的一份领域实例，用于它贡献的 route/runtime/API 命名。同一实例本次激活的 Cordis Fiber UID 则是运行期身份，销毁重建后会变化，不应用作持久路由名。

因此，复制一条配置并只修改外层 id 并不足以避免插件内部 ID 冲突。新模板的两个实例应同时提供不同外层 id 和不同 options.instance：

```ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';
import feature from '@example/hello';

export default defineConfig(({ command }) => ({
  presets: [preset],
  plugins: [
    { id: 'api', plugin: devApiVitePlugin,
      options: { prefix: '/workspace/api' }, enabled: command === 'dev' },
    { id: 'alpha', plugin: feature,
      options: { instance: 'alpha', development: command === 'dev', label: 'Alpha', apiBase: '/workspace/api' } },
    { id: 'beta', plugin: feature,
      options: { instance: 'beta', development: command === 'dev', label: 'Beta', apiBase: '/workspace/api' } },
  ],
  app: { base: '/workspace/' },
}));
```

以上通过同一个已安装的默认导出挂载两次，不创建两个假包或包装对象来绕开原生实例机制。页面为 `/workspace/plugin/alpha`、`/workspace/plugin/beta`；开发接口为 `/workspace/api/alpha/hello`、`/workspace/api/beta/hello`。API provider 仍由应用明确选择并共享并发预算，不给每个实例偷偷安装一个 Vite 后端。

## 2. 默认值、校验与兼容边界

| 选项 | 默认值与约束 |
| --- | --- |
| instance | 省略时为 default；1–48 个小写 ASCII 字母/数字/下划线/连字符，首字符为字母或数字 |
| routePath | default 为 plugin，其他实例为 plugin/实例名；可覆盖为简单相对路径，多段允许，不含前导/末尾斜杠、参数或通配符 |
| apiPath | default 为 /hello，其他实例为 /实例名/hello；可覆盖，始终相对于 provider.prefix，不是任意目标 URL |
| apiBase | 客户端明确的 API 前缀，仍应与所选传输 provider.prefix 一致 |
| label / development | 沿用既有公开 label 与显式开发环境开关 |

路径选项有128字符上限，拒绝非字符串、路径穿越、双斜杠与查询串，不做静默正规化。Config 处理的是可信配置的字段值，不以此保证不执行用户自己的访问器或隔离恶意代码。这里不是通用 URL 解析器，不把大小写不同的路由当作必然不冲突；最后仍由路由 IR 和 API 注册表检查实际冲突。

省略新增选项时，页面 `/plugin` 与接口 `/hello` 的旧单实例使用方式保持。生成的内部 route/runtime ID 现在包含 `:default:`，不是承诺旧生成 ID 一成不变。旧作者项目不会因升级创建器自动改写源码，应按本协议手动适配或创建新工作区。公开 `/api` 源码入口的 ApiOptions 现在包含明确 id/path；它仍是生成项目的一部分，不是自动升级第三方包的兼容层。

## 3. 小型公共命名工具，而不是另一套生命周期

`@cormijs/plugin-react` 导出 `createFeatureNamespace(pluginId, instance)`。它返回冻结的 `{ id, key(local) }`，例如 `createFeatureNamespace('plugin:example.hello', 'alpha').key('runtime')` 得到 `plugin:example.hello:alpha:runtime`。只接受公开身份，不截断、哈希、大小写转换或使用 Fiber UID。插件 ID 最长106字符，实例与插件拼接后的 namespace 最长120，最终 key 最长128；局部名不允许冒号，超出组合预算直接报 FEATURE_NAMESPACE_INVALID。cormi 与 cormi: 前缀保留。

这个工具不登记服务、不声明目录、不重写 URL、不创建 Context、不隐式绑定 effect。相同输入得到同一身份，因此重复实例仍由已有 hook 注册拒绝，而不是产生随机后缀来掩盖配置错误。路径也不是由 ID 推测：作者可以明确 routePath/apiPath，最终仍须满足各领域约束。

命名空间不等于 Cordis 服务隔离域。同名 provider 需要使用原生 `Context.isolate` 的显式设计，不能因两个贡献 ID 不同就同时覆盖同一可见域的服务。命名也不是权限或多租户安全隔离，插件仍执行可信 Node 代码。

## 4. 两个 Provider 为什么不会互相覆盖

同一插件的多个 runtime 条目会引用相同的浏览器模块。如果每个 Provider 只向同一个 React Context 写一份 Options，最内层实例就可能覆盖所有页面的配置。本模板改为在每次应用挂载的 React 树内组合 `ReadonlyMap<runtimeId, PublicOptions>`，不使用模块级可变全局注册表。

每个实例的路由在自己的公开 meta 命名键中写入 runtimeId。页面使用已有 `useRouteMatches()` 从最近匹配中取得这个显式身份，再查当前 Provider Map；不根据 pathname 猜实例，也不依赖插件加载顺序。Provider 仍在 Router 外，读取路由的 hook 只在 Router 内的页面执行。缺少对应 Provider 会明确失败，不回退到任意另一个实例。

路由导航可能复用同一个页面模块的组件。外层 Page 因此给实际持有 state 的组件设置 runtimeId 作为 key：Alpha 的 Count:2 不会变成 Beta 的 Count:2，Alpha 的请求结果也不能出现在 Beta。切换实例会重建局部状态，并执行旧请求的取消清理；这不是按实例缓存页面状态。普通同实例组件编辑仍按 Fast Refresh 边界处理，未改变框架 runtime 的生命周期。

该 Map 使用类型只读接口和新值组合防止模板自身串写，不是不可变 Map 的安全沙箱。CSS Modules 减少类名冲突，但全局 CSS、浏览器存储以及作者自己写的全局变量不在实例隔离保证内。

## 5. 冲突、撤回与两种更新方式

同实例身份重复会导致 hook ID 冲突并使相关原生插件初始化失败；不同身份但相同 API method/path 由 DevApiService 拒绝；不同身份但相同实际页面路径由路由编译拒绝。不会静默替换先加载的实例。诊断基于真实 Fiber 图与贡献所有者，实例之间的依赖与父子关系可查看。

低层宿主调用 `unmount('alpha')` 或销毁对应原生 Fiber 时，alpha 子插件和其贡献随 Cordis 退出。测试要求 beta UID 不变、没有重新 apply，beta API 继续响应；alpha 的已接受请求会被取消，并等待真实 handler 收尾。旧 alpha 的 disposer 不能删除后来的同名替代实例。

通过 `cormi.config.ts` 改变 enabled 则仍是已有 supervisor 的整个 worker 重启策略。重启后 beta 功能继续存在，但不承诺 beta 浏览器或 Node 内存状态原样保存。配置重启、原生实例退出、编译结构刷新是不同粒度，不把它们统称为“无感热卸载”。

多个领域登记不是一个跨领域事务：例如 API 冲突之前路由子插件可能已登记，但失败宿主不能被当作就绪应用执行；移除失败实例后回收其贡献。路由构建冲突继续保护已发布应用产物，不等于回滚用户源码、任意外部网络副作用或长期服务状态。

## 6. 由多实例验证发现的通用进程问题

双实例的诊断首次在独立应用中出现 WORKER_EXITED(0)：worker 已完成计算，但最终 IPC 数据尚未发送完就 disconnect。独立回归用512KiB一次性结果与1200条贡献诊断复现，因此不是多实例配置错误或 Admin 问题。

worker 现在登记本身发出的 IPC Promise，在关闭通道前等待发送回调收尾，失败变成非零退出；原有关闭 watchdog 覆盖此等待，不增加固定睡眠，也不要求父进程重试命令。成功结果仍在宿主清理成功后生成，失败诊断仍使用 diagnosis 事件与非零退出。等待发送回调不是父应用已消费结果的事务确认，也不提供断线重放或跨进程持久消息。

## 7. 参考依据与验证入口

本轮读取固定 [Cordis registry](../cordis/packages/core/src/registry.ts) 与 [原生插件测试](../cordis/packages/core/tests/plugin.spec.ts)，并对实际 npm RC.11 执行同一对象挂载两次、只退出其中一个的进程探针。参考 checkout 与 npm 不是同一提交，所以不以版本字符串代替执行结果。

固定 [Satori Bot](../references/satori/packages/core/src/bot.ts) 分开记录配置、实例、平台标识与受管路由，提供领域身份设计参考；其中 static reusable 和较早生命周期写法没有盲目抄进 cormi 当前 Plugin 类型。此前 WebUI 的 Node/client 分离与调用者所有权继续沿用，详见 [生态研究](37-cordis-ecosystem.md)。没有修改参考源码或搬运其受限实现。

`pnpm test:plugin` 继续真实 pack 创建器和插件，移动作者/kit 后从消费者自己的 tgz 安装树验证。新增双实例流程包括倒序登记、两页客户端导航、计数与请求结果不串用、禁用恢复、diagnose 实例所有者、三类冲突、重复构建和生产深链接。原资源/单实例流程继续完整执行。Node 的独立撤回和请求排空另有确定性 gate/HTTP 回归；计数与截图不替代这些生命周期断言。

本轮不提供任意旧插件自动多实例化、跨实例状态持久化、实例级 Node 源码 HMR、浏览器 Cordis 宿主、生产鉴权、插件市场或公共 npm 发布。后续优先基于真实扩展使用暴露的契约问题继续开发。
