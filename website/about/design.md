# 设计原则

cormi 的目标不是“把 Umi 改个名字”，而是验证一套组合方式：

> 一套应用能力可以作为 preset 交付；插件能声明自己依赖什么、贡献什么、退出时清理什么；编译结果可以解释来源。

## 分层

```text
cormi CLI / launcher
└─ core                Cordis 宿主、就绪、诊断、命令协议
   ├─ builder          构建契约（无 Vite 类型）
   ├─ routes           路由 IR 与校验
   ├─ plugin-web       应用命令、生成队列、受管发布
   ├─ plugin-vite      Vite provider
   ├─ plugin-react     React 编译服务与运行时贡献
   └─ preset           默认组合 + 可选能力插件
```

依赖方向只有一个：上层插件依赖公共契约，core 不反向导入 React、Vite 或业务知识。

- **core**：只拥有宿主、就绪屏障、诊断与命令协议。
- **builder**：定义 `BuildPlan`、`ServerHandle`、`DevelopmentState`。
- **plugin-web**：消费 builder，拥有默认编译与发布策略。
- **plugin-vite**：通过 Cordis 提供 Vite 会话，不把 Vite 类型泄漏给 core。
- **plugin-react**：拥有 React 编译服务与路由/运行时贡献。
- **plugin-react-vite**：唯一同时了解 React 与 Vite 的可选桥接。

默认 React + Vite 是产品组合，不是内核特权。

## 插件是契约，不是目录

一个能力要被称为插件，至少要满足：

1. **契约独立于提供者**：例如 `ctx.react.routes`、`RuntimePlugin`、`RequestClient`。
2. **消费者声明 `inject`**：不读取提供者的内部字段。
3. **可以关闭或替换**：测试中卸载提供者后，消费者不会回退到假实现。
4. **资源有明确所有者**：退出时由 Cordis 作用域或 React 卸载释放。

“文件放在 plugin 目录”不构成可替换性。

## 约定默认显式

cormi 参考 Umi 的使用方式，但不会静默接管：

- `src/pages` 是基础路由约定。
- `src/app.tsx`、`src/models`、`src/locales`、`src/access.ts`、`src/api`、`mock/` 等都需要显式挂载插件。
- 默认 preset 不把已有的 `src/app.tsx` 当作配置。
- 显式 `app.routes` 会关闭约定扫描。

这会让第一次配置多几行，但避免了“为什么我的普通组件被当成框架配置”的隐式行为。

## 运行时与构建分开

- Node 配置在独立 worker 中求值，可以访问 Node API。
- 浏览器运行时只被生成的入口 import，Node 阶段不执行页面源码。
- 构建服务通过 Cordis 注入，React 编译器不知道 Vite，Vite provider 不知道业务。
- SSR 复用同一棵路由树和 Provider，不创建第二套应用。

## 失败要可见，恢复要有边界

- 构建先写 staging，失败保留上一份成功产物。
- 受管产物有归属检查，不自动清空未知目录。
- 开发态可修复错误保留会话，并通过诊断面板展示；一次性 build/typecheck 仍失败退出。
- 强杀进程可能留下 stale 锁，不按 PID 或时间猜锁。
- Node 源码变更重启整个 worker，不伪装成进程内 HMR。

## 已知取舍与接缝

这些不是“已经全部插件化”的证明，而是当前明确的边界：

| 取舍 | 现状 |
| --- | --- |
| 环境文件加载 | bootstrap 在配置求值前预检，尚未拆成完全可替换的策略 |
| watch / HMR | Node 源码按整 worker 重启；浏览器组件走 Fast Refresh |
| 配置来源 | `cormi config` 解释 preset/user/derive，仍不包含构建器内部默认值 |
| 产物发布 | 受管 staging + 所有权检查，不是跨文件事务 |
| 类型检查 | 独立命令，不把转译成功当类型正确 |
| 公开分发 | Cordis 声明补丁仍需消费者根显式配置 |

框架仍在早期，优先吸收应用功能，而不是继续拆分所有启动抽象。

## 验证哲学

- 先用明确断言复现缺陷，再最小修复。
- 测试覆盖异步初始化/清理、反复启停、密集变更、无效输入、插件撤回、最后有效产物和失败退出。
- 浏览器验收不只看首页 smoke。
- 资源计数、内存采样和有限循环不等于长期无泄漏证明。
- 文档、真实包消费和当前实现保持一致；本地通过不冒充公开发布。

## 不适合什么

cormi 不是：

- Umi 的二进制兼容层或插件市场。
- 通用后端框架、数据库层或部署平台。
- 一套新的 DI 库或第二套插件生命周期。
- 已经达到 1.0 的公共产品。

它适合希望你掌控组合方式、能接受显式配置与早期边界的 React 应用。
