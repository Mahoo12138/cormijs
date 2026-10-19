# cormi：Cordis 生态参考与开发 API 扩展契约

日期：2026-10-19。本文区分固定源码事实、cormi 的取舍、已实现契约和待验证范围。原版源码克隆不等于安装或运行了这些上游项目。当前功能主线仍是 cormi；Admin 只承担真实客户端和依赖负载，参见 [框架验收准入](35-framework-validation.md)。

## 1. 本地参考基线

工作区下 `references/` 保存三个独立 Git 浅克隆，不进入 workspace、提交或分发包。没有安装上游依赖、执行其脚本或改动原 `cordis/umi` 参考基线。

| 本地目录 | 官方仓库 | 固定 HEAD | 本次核心版本 |
| --- | --- | --- | --- |
| references/koishi | koishijs/koishi | 97d5c395750cec37b772e0b94dc63c427e3bb868 | @koishijs/core 4.18.11，Cordis ^3.18.1 |
| references/koishi-webui | koishijs/webui | 1dc5c0e1c76a207c2ec48697d4b56364cfe28dce | console/client 5.30.11，Cordis ^3.18.1 |
| references/satori | satorijs/satori | db22bb3c22f8ee9f6d9d9ecf04fd58b70006956f | @satorijs/core 5.0.0-alpha.0，Cordis ^4.0.0-rc.3 |

这里的 Satori 是消息协议与适配器生态，不是同名 SVG 渲染项目。版本来自 checkout 内 package.json，并非把默认分支视为当前 npm 稳定版。Koishi 的 Satori 依赖仍指向4.x，不与本次Satori5 alpha混为同一套API。cormi实际依赖维持Cordis4.0.0-rc.11；引用架构思想不能声称旧生态插件已无修改兼容。固定文件哈希与路径见 [参考清单](../artifacts/cordis-ecosystem.json)。

Koishi和Satori根LICENSE为MIT。WebUI根LICENSE为AGPL-3.0，client包声明为AGPL-3.0，console包及根package.json则声明MIT；仓库中存在不同层次的许可声明，不能用一个字段概括所有包。本次只阅读设计并独立实现领域代码，没有直接搬运WebUI实现；实际复用源码前必须按具体文件和包再次核对许可，不以根元数据推断全部目录的授权。

## 2. 源码事实如何影响设计

**调用者作用域，而不是服务提供者作用域。** Satori5的DisposableSet配置Service.tracker并用`ctx.effect`撤回注册；InternalRouter.define也使用调用者的effect。Cordis4自身的Service/reflect将服务调用关联到调用者Context。这使功能插件调用服务扩展方法时，服务可将资源归属绑定到当前插件，而不是要求每个作者再复制一层onDispose。来源：[Satori集合](../references/satori/packages/core/src/index.ts)、[路由定义](../references/satori/packages/core/src/internal.ts)、[Cordis Service](../cordis/packages/core/src/service.ts)。本轮另在cormi实际安装的RC.11运行了调用者追踪探针，不只照抄v3文档。

**组合层可以是原生子插件。** Koishi MockBot安装MockAdapter，Console构造函数安装Entry/Schema等子服务，说明用户入口与内部能力数量不必一一对应。来源：[Koishi Mock](../references/koishi/plugins/mock/src/adapter.ts)、[WebUI Console](../references/koishi-webui/packages/console/src/index.ts)。cormi旧的`devApiVitePlugin`因此保留为单配置入口，内部挂载服务与Vite桥接；不为组合再做第二个注册器，也不等待一个依赖未就绪父服务的子插件而造成初始化循环。

**协议与传输实现分离。** WebUI的Console/DataService/Entry定义贡献和数据，而NodeConsole接入HTTP/WebSocket与dev/prod文件选择。Satori的Adapter/WsClient将平台连接和bot行为分开。来源：[Console数据](../references/koishi-webui/packages/console/src/service.ts)、[Entry](../references/koishi-webui/packages/console/src/entry.ts)、[NodeConsole](../references/koishi-webui/plugins/console/src/node/index.ts)、[Satori Adapter](../references/satori/packages/core/src/adapter.ts)。当前对应关系是DevApiService管理规则，Vite桥接只安装HTTP会话，贡献者依赖devApi而不依赖vite。

**Node与浏览器扩展可以配对交付，但没有理由混合依赖图。** WebUI分别处理服务端Entry和浏览器模块的安装/撤回；它的浏览器Context确实继承Cordis并将Vue组件卸载关联到插件，不能说Cordis只能在Node使用。来源：[客户端Context](../references/koishi-webui/packages/client/client/context.ts)、[客户端loader](../references/koishi-webui/packages/client/client/plugins/loader.ts)。cormi目前选择生成React runtime清单是产品策略，不是Cordis能力限制。本轮用同一个真实tgz的Node/client独立exports验证配对，不把Vue控制台整套移植进React应用；后续动态工作台有真实服务依赖需求时再评估浏览器Cordis宿主。

**源码不是全能正确性的证明。** Console.addListener的简单赋值不能推广为所有扩展入口自动有所有权；Satori的连接代际检查也不替代cormi配置准入测试。参考代码中用模拟req/res测试Webhook，不足以证明真实socket取消和响应背压正确。本轮继续使用真实Node HTTP、浏览器fetch和受控异步gate。

## 3. 当前实现：一个能力服务，多个贡献者

已有包新增`@cormijs/plugin-dev-api/service`，暴露原生Cordis的`DevApiService`与Context augmentation；原主入口仍是可直接创建的Node HTTP处理器，`/vite`才依赖Vite桥接。没有新建框架包、修改core、引入全局服务单例或自动安装插件。

```ts
import type { Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-dev-api/service';

export const example: Plugin.Object<void> = {
  name: 'example:catalog',
  inject: ['devApi'],
  apply(ctx) {
    ctx.devApi.add('example:catalog', {
      mocks: [{
        method: 'GET', path: '/items',
        handle: () => ({ body: [{ id: 1, title: 'Example' }] }),
      }],
    });
  },
};
```

上例add内部使用调用者`ctx.effect`，正常卸载自动撤回。手动需要提前撤回时，返回可等待、幂等的注销函数。`DevApiService`通过普通plugin项安装；`devApiViteBridge`注入vite和devApi；旧`devApiVitePlugin`组合二者以保持已有配置可用。不要在一个可见作用域同时再装两个同名provider。

add只允许mocks/proxies；命名空间、请求预算由provider统一决定，不能每个插件乘一份并发额度。同method/path或相同proxy前缀冲突在发布前整批拒绝，不依赖加载顺序静默覆盖。HEAD先匹配全局显式HEAD，再退到GET；Mock优先；代理按最长分段前缀匹配。注册快照冻结，handler闭包仍属于可信代码。

`summary()`提供prefix、贡献id/owner、公开方法与路径，不输出handler、target来源、请求头或私有options。此接口是领域诊断摘要，不是完整服务图或密钥识别系统。

## 4. 撤回、取消与关闭

请求获得具体注册实例的lease，lease覆盖handler和响应写入两个阶段。撤回首先从可路由表中移除该实例，再取消其请求；合作handler可及时结束，固定目标proxy关闭实际上游请求。其他贡献仍可服务；旧注销函数不能移除后来的同ID注册。

请求头未发时取消返回`503 DEV_API_WITHDRAWN`；已经发送响应头则断开，不在半段响应后拼接新JSON。响应背压、迟到handler仍占原会话额度，直到实际收尾；超时不假装已经终止第三方代码。注册撤回2秒未排空报`DEV_API_CLEANUP_TIMEOUT`，未排空注册仍计入256项预算，外层worker保留既有退出期限。

Vite会话close、bridge卸载和provider卸载都回收自身资源。通过服务动态增删贡献可以在现有开发server生效；配置文件或Node插件源码改变仍是worker重启，不承诺任意Node源码进程内HMR。dev API是开发工具，不是生产网关：build/preview不安装中间件，不支持WebSocket/SSE/流式响应，AbortSignal不是不合作函数的强制中断。

关闭还必须对同步重入保持幂等。AbortSignal 的取消监听器会同步执行；若关闭函数先取消、后赋值关闭 Promise，监听器再次调用 close 就会创建第二次关闭操作。本轮复核分别在 HTTP 会话和 Cordis 服务重现该问题。修正先保存 Promise，再在其微任务中取消和排空；关闭准入立即生效，重入者获得同一 Promise。部分 JSON 上传尚未结束时撤回所属贡献，也已验证不调用业务 handler、释放该请求并保留其他贡献。

## 5. 从真实分发验证扩展价值

`tests/fixtures/dev-extension`是独立测试插件包，不是新框架产品。根入口用原生子插件组合Node API和浏览器runtime，`/api`只依赖devApi服务，`/client`不导入Node服务。调用方明确传入是否开发命令；在生产环境保留客户端runtime但不安装开发请求贡献。

验证要求：真实pack后从应用自己的安装树消费，严格声明可检查；Mock成功/空/异常/Unicode JSON、代理真实请求、浏览器AbortController取消和插件禁用/重启用均使用同一套公开接口；build产物不含Node私有标记和代理目标，preview不提供Mock。Admin只用原Users页面产生真实浏览器环境，不补CRUD、鉴权或模板交互。

最终通过范围与未执行项见 [本轮结果](38-p6-results.md)；上游阅读范围不等于整个生态已审计，未来需要某项能力时仍应读取固定版本并保留可复现差异。
