# cormi：可复用 React 功能插件与客户端模块引用

日期：2026-10-18。阶段：P4a 应用功能扩展。Windows 原生验收按用户决定挂起，不再作为当前功能开发的前置条件；保留已有平台工具，不删除它们或宣称 Windows 已通过。本文说明实际实现，精确测试结果见 [本轮结果记录](22-p4a-results.md)。

## 1. 功能边界

此前已经具备应用启动、路由扫描、React 运行时、开发恢复与构建。现在补齐“一个插件自带页面与 runtime，应用只配置这个插件”的链路，而不是再增加一套平台测试。Node 插件负责声明，React 编译插件处理路由与生成，浏览器 runtime 处理渲染；core 与 Web 编排仍不依赖 Vite 或 React 的具体对象。

新增的公开接口位于已有包内：`@cormijs/plugin-react` 导出 `defineReactFeature` 与 `clientModule`，`@cormijs/runtime` 导出 `useRouteMatches`，`@cormijs/routes` 的 ModuleRef 支持可选 from，RouteRecord 支持公开 meta。没有创建只有转发作用的空包。

## 2. 一个完整功能的最小定义

以下模式已用于 [status 功能](../examples/features/features/status/plugin.ts)。client 文件位于 plugin.ts 的 client 子目录，不由 Node 导入执行。

```ts
import { clientModule, defineReactFeature } from '@cormijs/plugin-react';

export function statusFeature(options: { label: string; parentId?: string }) {
  return defineReactFeature({
    id: 'example:status',
    routes: [{
      id: 'feature:status',
      parentId: options.parentId,
      path: 'status',
      module: clientModule('./client/Page.tsx', import.meta.url),
      meta: { title: '功能插件', feature: 'status' },
    }],
    runtime: [{
      id: 'example:status-runtime',
      module: clientModule('./client/runtime.tsx', import.meta.url),
      options: { label: options.label },
    }],
  });
}
```

`defineReactFeature` 返回原生 Cordis Plugin.Object，声明 inject: ['react']。它通过现有 routes reducer 和 runtime collector 注册贡献，注销函数由 ctx.effect 归属到该插件。没有新增 activate/deactivate 状态机。应用仍用普通插件项的 enabled 控制装配，见 [应用配置](../examples/features/cormi.config.ts)。

功能 ID、路由 ID、runtime ID 都必须稳定；不同实例应自行使用不同 ID。stage 可选，使用现有 OrderedHooks 的排序规则；同 stage 的便利接口以稳定 hook ID 排序，不暗示注册时间优先。需要 before/after、动态计算或服务依赖的高级插件继续直接使用 ctx.react.routes/runtime，不强迫所有插件改成静态描述。

功能 routes 的 parentId 可以引用应用或另一功能提供的布局，因此完整父子图在所有贡献汇总后才验证。缺失父节点、重复路径或 ID 仍失败，不靠覆盖顺序“取最后一个”。meta、模块描述和公开 runtime options 在定义时复制，后续修改原输入对象不会偷偷改变已经登记的贡献。

停用插件会撤销它的路由与 runtime 登记，不删除源码。CLI 的 Node 配置变更依然通过 worker 重启，不承诺无停机；页面组件改动交给已有 Fast Refresh。浏览器 Provider 是应用级组合，不是 Node 的服务容器，也不随普通路由跳转重建。

## 3. 模块引用：默认项目根与显式作者位置

`{specifier:'./src/Page.tsx',exportName:'default'}` 保留项目根相对语义。可复用插件应使用 `clientModule('./client/Page.tsx', import.meta.url)`；helper 返回带 from 的数据引用，其目标按作者文件所在目录解析，而不是按 cwd、临时 config.mjs 或应用根解析。本地配置转译器已映射 import.meta.url 到原始源码，因此本地插件也能使用同一模式。

from 必须为绝对 file URL，不能带查询、片段、凭据或表示目录。带 from 的 specifier 必须以 ./ 开头，目标限制在作者目录的子树内，不接受 ./../ 越界。作者文件与目标文件要求真实、规范化、存在的源码文件；目标不能是符号链接、已知服务端输入、.server 文件、配置或私有生成文件。缺失目标在开发态进入既有修复流程，新增文件后可恢复；prepare/build/typecheck 仍严格失败。

可以显式引用应用外的独立插件目录，但这不是对任意外部目录开放 HTTP。生成器只生成选定客户端模块的静态引用，不放宽 Vite 整个 fs.allow；未经导入的邻接文件仍应被开发服务器拒绝。裸包引用保持裸包名，由构建后端处理 browser/export conditions，不用 Node require 解析结果覆盖浏览器解析规则。

外部源码包必须有自己的正确依赖安装与 peer 声明。框架不会偷偷给 TypeScript 增加 paths，或通过隐式提升借用应用的 React 类型。外部目录引用、可复用 npm 功能包与完整 monorepo 解析不是同一范围：本轮提供前两者所需的基础引用形式，但没有实现任意 Node 包源码修改自动重启、跨盘符导入或所有包管理器布局兼容。

已知 Node 工具链模块（包括 cormijs、Cordis、core、构建/编译插件和 node:）不能作为浏览器模块引用。Node 插件本身仍是受信任代码；这些防误用与私有输入检查不是第三方插件安全沙箱。

## 4. 公开路由元数据

RouteRecord.meta 为 JSON 对象。路由校验复制并深冻结该对象，要求有限数值、无环、无访问器、无函数或保留原型键；每份公开数据有深度、节点数和序列化大小上限。预算在递归复制时累计，避免先序列化巨大结果再报超限。runtime options 使用同一数据规则，错误代码仍区分 ROUTE_META_INVALID 与 RUNTIME_OPTIONS_INVALID。

生成器把 meta 放进 React Router 的 `handle.cormi.meta`。浏览器组件可以在路由树内部使用：

```tsx
import { useRouteMatches } from '@cormijs/runtime';

export function Breadcrumbs() {
  const matches = useRouteMatches();
  return <p>{matches.map(match => String(match.meta.title ?? match.id)).join(' / ')}</p>;
}
```

匹配顺序为父到子，最近路由在末尾；返回 id、pathname、params 和 meta。这个 helper 过滤框架内部保留路由，提供只读描述，不自动把父 meta 合并到子 meta，不解释权限策略，也不提供鉴权。调用位置必须在 RouterProvider 内部；应用外层 Provider 中不具备路由上下文。

meta 与 runtime options 都会进入浏览器资产，**不得存放密钥**。inspect 显示公开 meta 与来源；from 的绝对作者 URL 不直接输出，项目内表示为 project: 相对位置，外部作者只显示 external: 文件名。它仍是上一次成功生成快照，不是配置安全审计。

## 5. 运行与分发

```sh
pnpm build
pnpm cormi dev --root examples/features
```

默认地址为 `127.0.0.1:8002/workspace/`，功能页面为 `/workspace/status`。应用只有布局和概览页；功能插件提供状态页、根 Provider 和元数据。可以修改插件页面验证 Fast Refresh，也可以在配置中切换 enabled 验证完整撤销。停用后的导航链接由应用自己管理，本例保留链接以便观察 404，不是假装自动生成菜单系统。

停止 dev 后可分别运行 typecheck、build、preview；同项目独占锁与受管产物保护保持不变。示例不是用户业务后端或真实登录系统。

`pnpm pack:local --template features` 生成携带同样示例的本地 kit；默认仍是 basic。整个 kit 移到 workspace 外后进入 app 安装，不只复制 app。features 模板明确依赖 @cormijs/plugin-react，因为它自己编写 Node 功能插件；没有把全部内部包装到根依赖来掩盖问题。新功能也进入真实 tgz 消费者验证。

## 6. 后续功能主线

下一步优先补标准创建项目流程与开发请求代理/Mock 插件，然后收敛配置派生、配置来源诊断和应用编译阶段。Windows、其他平台与长期资源趋势继续作为独立质量事项，不占用当前功能迭代的主要范围。SSR/RSC、完整 Umi 兼容和公开 npm 发布不随本次增加。

实现入口：[功能定义](../packages/plugin-react/src/feature.ts)、[模块引用](../packages/plugin-react/src/modules.ts)、[路由数据](../packages/routes/src/json.ts)、[浏览器路由读取](../packages/runtime/src/route-matches.ts)、[单元回归](../tests/features.test.ts)、[浏览器回归](../tests/browser/features.test.ts)。

相关官方接口：[React Router handle](https://reactrouter.com/how-to/using-handle)、[useMatches](https://reactrouter.com/api/hooks/useMatches)、[Vite server.fs](https://vite.dev/config/server-options)、[Node URL](https://nodejs.org/download/release/v22.14.0/docs/api/url.html)。框架扩展规则以本地实现为准，不将参考库自身的能力自动视为 cormi 已交付。
