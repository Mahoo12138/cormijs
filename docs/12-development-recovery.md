# cormi P2a：开发态错误恢复与结构诊断

初稿日期：2026-10-16。复核修订：2026-10-17。本文记录当前实现的协议；执行结果和仍未验证的边界另记于阶段结果文档。P1c 的发布、类型检查和快照规则不因开发态恢复而放宽。

## 1. 开发服务器可用，不等于应用编译成功

`cormi dev` 在遇到可修复的路由冲突、无效路由结构、缺失客户端模块或编译 hook 错误时，保留同一 compiler 和 server 会话，显示开发诊断并继续观察输入变化。首次失败不会向磁盘写一个假装正常的 React 应用，也不会生成成功 inspect 快照。已有历史生成文件不删除，但在本次 compiler 首次成功之前不把它当作当前有效应用。

CLI 的初始 ready 事件新增可选 `applicationStatus`。值为 error 时表示网络服务可以访问、应用尚未编译成功，文本模式明确打印 server listening 与 waiting for repair，而非只打印应用就绪。这个字段是初始监听事件的状态；持续状态通过开发会话订阅送到浏览器，不是完整 CLI 生命周期事件流。

修复后，正常生成 app.tsx、routes.d.ts 和 inspect.jsonc，再清除错误状态并刷新页面。即使修复结果恰好与旧会话的磁盘内容相同，也要让当前浏览器从首次失败的空入口转入有效应用。

## 2. 插件边界

编译器通过 `PreparedApplication.development` 提供 entry、current() 与 subscribe()；Web 命令将初始描述放入 BuildPlan.development，并把后续状态传给 ServerHandle.setDevelopmentState。Vite provider 内部才处理模块缓存、WebSocket 和 HTML 注入。需要开发恢复但后端不支持诊断时明确报 BUILDER_DIAGNOSTICS_UNSUPPORTED，并关闭已申请的资源。

纯结构类型从 `@cormijs/builder/development` 导出，不导入 Cordis、Node 或 Vite。builder 根入口仍负责 Context 类型扩展。浏览器诊断脚本只使用这份纯协议和原生 DOM，不把 Context 的模块扩展或 Node 工具链带进浏览器依赖图。

```ts
interface DevelopmentState {
  revision: number;
  status: 'ready' | 'error';
  hasOutput: boolean;
  diagnostic?: {
    code: string;
    phase: string;
    message: string;
    files: readonly string[];
    pluginId?: string;
    hookId?: string;
  };
}
```

revision 单调递增。后端复制、验证有界字段，忽略旧 revision，相同 revision 携带不同内容时明确失败。hasOutput 只表示本 compiler 会话是否成功发布过应用；后续结构错误下它仍为 true，不代表用户修改的业务源码可正常运行。

## 3. 浏览器展示与传输

Vite 只在开发会话注入独立虚拟模块。模块建立 Shadow DOM 诊断面板，显示错误码、阶段、相关项目相对文件以及 hook/plugin 身份；支持缩小成提示按钮、重新展开和窄屏布局。固定容器隔离应用样式，不修改应用根组件树或清空 React DOM。

编译错误消息通过固定白名单解释，不直接序列化 exception.message、cause、stack、配置、环境变量或源码。无法安全细化的错误提示到终端查看完整信息。文件路径归一化到项目内，字段数量和长度有上限。所有文字使用 textContent，不把 hook ID 或路径插进 HTML，因此形似标签的输入只显示为文本。

新连接会请求当前诊断快照，不能依赖错误发生时的一次广播；客户端断连时提示诊断可能过期。协议仍依托 Vite 开发连接，不是独立网络服务或权限沙箱。浏览器能访问公开开发服务就能访问这份限定诊断；面向网络开放开发服务器仍需用户主动配置和承担风险。

当本会话尚无有效输出时，生成入口的 load 返回无副作用的空模块。该模块使用最终生成文件的真实模块 ID，而不是把同一 URL 永久别名到另一个虚拟 ID；恢复后失效同一模块图节点才能可靠读到新生成代码。

## 4. 修复、更新和关闭

首次失败保留观察逻辑。页面路径、已知客户端模块元数据和贡献 revision 的变化可发起新一轮编译；创建缺失 runtime 模块也可以恢复，不必改配置来触发 worker 重启。Node 配置或插件源码变化仍走既有 supervisor 重启策略，不能把编译恢复混称为进程内插件 HMR。

沿用单消费者 RevisionQueue：迟到计算不能发布过期入口；过期错误也不能覆盖已经接受的新轮次诊断。相同输入的失败不构成自动重试风暴。恢复到完全相同的已发布代码，只清除诊断，不额外改 mtime 或刷新组件，从而保留已有页面状态。

组件源码仍由 Vite/React Fast Refresh 负责。路由结构的有效变化依旧使用明确的失效/整页刷新，不承诺页面状态迁移。编译错误 overlay 与 Vite 原生转译错误 overlay 各有职责，不替代任意运行时异常处理。

关闭命令先撤销生成更新和诊断订阅，再关闭 compiler 与 server。后端关闭之后拒绝新诊断；没有把 WebSocket 存活、轮询定时器或迟到编译当作可忽略的资源。

复核补充：compiler 同时跟踪已经进入执行的诊断与生成通知，close 必须等这些 Promise 收尾。每次开始调用监听器前重新核对取消状态、订阅身份和诊断版本；已注销的监听器不会因旧快照继续得到回调。相同 callback 的重新订阅具有新的身份，旧注销句柄不能移除新注册。

观察者抛错会记录为通知交付错误，继续通知其余有效观察者，不把已经成功的编译反向标记成路由错误；关闭时通过 AggregateError 报告不完整交付。永久挂起的观察者仍可能触发外层 worker 清理超时，不承诺强制取消任意第三方 Promise，也不支持在通知回调内等待该会话自身关闭。

在本次锁定的 Vite 集成里，正常关闭先等待已进入客户端模块处理流程的请求收尾，再调用 Vite close，避免同时取消依赖优化器和等待其转换结果形成关闭等待。使用的是 Vite 当前版本提供的 waitForRequestsIdle；外层 worker 仍有清理期限，不将未响应任务冒充已经取消。该顺序需要随 Vite 升级重新验证。

## 5. 仍然必须失败的场景

prepare、build、typecheck 仍是严格的一次性命令，遇到编译错误退出非零。preview 只服务已有产物，不启动编译恢复或注入诊断模块。生产 HTML/JS 不包含开发 overlay 客户端。

缺少基础 HTML 入口、非法基础配置、受管目录被替换、未拥有的生成文件以及启动阶段无法安全处理的写入错误，不伪装成可用开发应用。磁盘多文件写入仍不是跨文件事务；后续写入错误可能导致 inspect 检测到混合状态，需要修复后重新生成。

AtomicEntry.open 在进入可容错编译前核对已有生成文件的所有权与文件类型。因此，即使同一时刻也存在可修复的路由冲突，未拥有的 app.tsx/routes.d.ts/inspect.jsonc 仍会直接拒绝启动，而不会被路由恢复分支掩盖。

本切片不是首次配置语法错误下的独立诊断服务器，也不是通用权限隔离、断电恢复或跨平台保证。没有解决 Cordis 声明补丁向发布消费者的传播问题；本机补丁继续只修改声明，不改上游 JavaScript。

## 6. 实现入口

[纯诊断协议](../packages/builder/src/development.ts)、[应用命令转发](../packages/plugin-web/src/application.ts)、[React 编译恢复](../packages/plugin-react/src/index.ts)、[错误白名单](../packages/plugin-react/src/development.ts)、[Vite 传输](../packages/plugin-vite/src/development.ts)、[独立 DOM 面板](../packages/plugin-vite/src/development-client.ts)。

[编译恢复回归](../tests/development-recovery.test.ts)、[后端契约回归](../tests/development-backend.test.ts)、[真实浏览器回归](../tests/browser/development.test.ts)。Vite 公共接口参考：[HMR API](https://vite.dev/guide/api-hmr)、[Plugin API](https://vite.dev/guide/api-plugin)。验证针对项目已锁定的版本，不表示依赖最新版本或任意版本都兼容。
