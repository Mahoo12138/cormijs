# ADR：默认 Vite，不绑定 Vite

日期：2026-10-16。状态：设计已采纳，实现与测试按 P0 逐项推进。

## 背景与修正范围

Draft 0.1 把 Vite adapter、固定 Web 流水线放在 core，并计划等第二个后端出现后再分离。这与用户要求的 Cordis 插件优先目标不一致。保留“直接使用 Vite 公开接口、不移植 Umi 兼容层”的选择，修正调用者与依赖方向。

core 只提供最小宿主、就绪和诊断。builder 定义契约；plugin-web 消费契约并拥有默认编译流程；plugin-vite 通过 Cordis 提供 builder 和专属 vite 服务。React 应用语义不 import Vite，React-Vite 桥接显式注入 vite。默认 preset-react-vite 是产品组合，不是不可覆盖的隐藏内置。

## 本次最小契约

P0 使用一个 HTML 入口、root、mode、base、outDir 和监听配置构成 BuildPlan。Builder 提供 dev/build/preview，结果不暴露 Vite 类型。ServerHandle 只有实际 URL 和异步幂等 close。选择单 provider，不增加全局 builder 注册中心；替换由 Cordis 的卸载/重新挂载完成。需要多项目时使用独立 Context。

provider 在 apply 阶段发布服务，不创建服务器。consumer 在就绪屏障后调用服务。Vite 专属插件先登记，创建会话时取快照；不能在 config hook 之后追加插件并假设生效。取消是协作式的，无法停止的构建要等待收尾并丢弃结果；宿主超时必须明确报告，不能伪造资源已释放。

P0 输出默认拒绝已存在目录，避免清空用户成果；通用生产 staging/发布、跨进程锁、自动重启留在 P1/P2。P0 不开放任意 Vite 配置透传；先支持原生 plugin 工厂登记，后续增加受控配置入口。

## 验收与非目标

证明 core 可在没有 Vite 的独立安装环境运行；同一 Web consumer 可切换 fake builder；真实 Vite dev/build/preview 可关闭；缺失依赖和异步失败不能报告成功；卸载期间拒收新任务和迟到会话。fake builder 不是第二个生产后端，不意味着已有多后端功能对等。

不重写 Cordis DI，不把所有纯函数拆成插件，不复制 Harness 全量 profile 管理，不在 P0 开发通用任务 DAG、插件市场或进程内任意 HMR。公共协议仍是实验性版本。

## 参考依据

[Koishi 服务与依赖](https://koishi.chat/zh-CN/guide/plugin/service)用于能力/实现分离；[DeepSeek Harness 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)用于 definition/provider/consumer 与组合层的组织参考。具体调用必须按锁定 Cordis 发布包验证，不能跨版本照抄。

[Vite JS API](https://vite.dev/guide/api-javascript.html)用于会话创建/关闭与 Node 环境边界；[Vite Plugin API](https://vite.dev/guide/api-plugin.html)用于原生扩展登记时机。滚动文档仅作接口参考，最终事实以安装版本及本地实验为准。
