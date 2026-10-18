# cormi：路由错误边界、懒加载失败与挂载约束

阶段：P5b。本文说明实际接口，不代表 React Router 全部数据路由 API 已开放。需求来自 [Admin AM02/AM09](admin/00-module-ledger.md)，实际结果见 [P5b](30-p5b-results.md)。

## 1. 声明与加载时机

`RouteRecord.errorBoundary?: ModuleRef` 引用一个 React 组件，不接受 JSX 或闭包。显式配置和 `defineReactFeature()` 共用该字段；未指定时沿父级传播，最外层保留通用失败界面。普通 `path: '*'` 用于未匹配路径，不能代替运行异常边界。

```ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';

export default defineConfig({
  presets: [preset],
  app: {
    strict: true,
    routes: [
      {
        id: 'application',
        module: { specifier: './src/Layout.tsx', exportName: 'default' },
        errorBoundary: {
          specifier: './src/ErrorBoundary.tsx',
          exportName: 'ErrorBoundary',
        },
        source: { file: 'cormi.config.ts' },
      },
      {
        id: 'home', parentId: 'application', index: true,
        module: { specifier: './src/Home.tsx', exportName: 'default' },
        source: { file: 'cormi.config.ts' },
      },
    ],
  },
});
```

错误组件用原生 `useRouteError()` 读取异常，位于 Router 内部。使用路由 Hook 的 App 同样必须在路由内部，不能整体移到外层 runtime Provider。

边界模块在生成入口中静态导入，页面仍然 lazy。引用经过既有 ModuleRef/clientSpecifier 的私有文件、服务端模块和作者路径检查，Node 不执行页面或边界。相同解析路径共享 namespace import，功能插件登记时冻结边界引用，inspection 对作者位置做同样的受限描述。

静态边界的目的，是在页面网络请求或顶层求值失败时已经具备错误组件。代价是边界及其依赖进入启动导入图，因此错误模块应保持精简；没有承诺零启动成本。

## 2. 同路由 lazy 失败的实际白屏修复

本轮在锁定的 React Router 7.18.2 上复现：同一路由 lazy 拒绝后标记仍保留，初始渲染继续选择 hydration fallback，已有的同路由边界没有显示。独立 memory-router 字符串渲染探针和真实浏览器中止模块请求都得到空输出。没有修改路由库内部文件。

生成器现在通过 `resolveRouteComponent()` 包装页面导入。成功时返回原组件；失败时完成 lazy 解析，返回渲染时重新抛出**原错误值**的组件，由已有边界处理。没有成功页替代、异常文本改写、日志过滤或自动重试。Admin 原来的 React.lazy 页面和 Suspense 布局保持原生行为。

## 3. 失败层次与恢复边界

| 情况 | 当前行为 |
| --- | --- |
| 声明的本地边界文件缺失 | 生成报错；dev 等待创建后恢复，prepare/build/typecheck 严格失败 |
| 非组件或不存在的命名导出 | 应用 typecheck 检查生成入口；exclude `.cormi` 不能绕过 |
| 页面渲染或模块求值异常 | 最近可用边界捕获；未声明则向父级传播 |
| 页面 lazy 网络失败 | 边界显示真实失败，不转成普通404 |
| 子边界渲染再次抛错 | 向父边界传播；真实生成入口测试覆盖 |
| 静态边界自身网络/顶层求值失败 | 启动模块图失败，尚未加载的边界不能捕获自己 |
| 事件处理器或独立异步任务异常 | 不属于路由渲染错误承诺，调用方应单独处理 |

缺失边界加入现有修复观察集合；生成失败仍保护已有受管入口。浏览器 ESM/React.lazy 的失败结果不承诺自动清空：网络修复测试明确重新加载，源码修复先等后端转换反映新内容，再导航恢复。这里不是任意异常下自动重试或状态保留协议。

## 4. StrictMode 与 root 归属

`app.strict` 默认 false，只接受布尔值，生成入口传入 `mountApplication({strict})`。Admin 原入口有 StrictMode，因此迁移显式设 true，不修改其他应用默认值。生成 inspection 记录实际 strict。

应用级 runtime setup 在 React 渲染前执行，StrictMode 包裹渲染树，不重复调用非 React 的 setup。浏览器测试分别验证开发 effect 重放与 cleanup、setup/dispose 一次、重复 dispose 幂等，不能把 React 开发 effect 重放称为 Cordis 插件重复安装。

同一 runtime 模块实例以 WeakSet 按 HTMLElement 记录占用，异步 setup 尚未结束时同元素第二次 mount 立即拒绝；正常 dispose 后可重挂载。不同元素不共享 router。此检查不是跨多份 runtime 打包副本的互斥，也不接管其他库创建的 React root。

## 5. 实现入口

[IR](../packages/routes/src/index.ts)、[功能引用](../packages/plugin-react/src/feature.ts)、[生成器](../packages/plugin-react/src/generate.ts)、[编译观察](../packages/plugin-react/src/index.ts)、[运行时](../packages/runtime/src/index.tsx)。回归：[边界协议](../tests/route-boundaries.test.ts)、[原错误保留](../tests/route-import.test.ts)、[应用类型](../tests/route-boundary-types.test.ts)、[真实浏览器](../tests/browser/route-boundaries.test.ts)。

真实模板的原错误界面和故障恢复见 [Admin 迁移接缝](admin/04-routing-migration.md)。core 与构建服务不依赖 MUI、模板业务或错误页样式。
