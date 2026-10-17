# cormi P2a：开发态编译恢复与结构诊断结果

本文保留 2026-10-16 的初批实现与测试事实。2026-10-17 新增所有权和通知生命周期复核，最新结论与完整测试结果见 [P2a 收尾复核](14-p2a-review.md)，不要将这里的历史数量视为当前回归数量。

日期：2026-10-16。基于 main 的 P1c 提交 `6923d9ad3f72acfdba930484b682606422dacb53` 继续开发。最终本机 **128 项 Node 测试与 9 项真实浏览器测试全部通过**，0 失败、0 取消、0 跳过。命令、日志和源码哈希见 [P2a 机器记录](../artifacts/p2a-validation.json)。这不是完整 P2、跨平台或正式发布验收。

## 1. 本轮交付

开发态首次遇到可修复的路由冲突、缺失客户端模块或编译 hook 错误时，保持同一开发会话，并显示浏览器结构诊断。首次失败不写入假装成功的 React 入口，也不生成成功 inspect 快照；旧会话的磁盘产物保留，但不会被当前会话直接认作有效应用。修复输入后重新生成并自动恢复，无需手工重启 CLI。

后续结构冲突保留上一次成功生成的入口与当前 React DOM。移除冲突且最终生成内容不变时，只清除诊断，不重复写文件或刷新组件。实际浏览器测试验证 Count:2 在这个修复过程中保留。结构发生有效变化仍按既有约定整页刷新，不承诺任意修改都保存状态。

浏览器面板独立于应用组件树，使用 Shadow DOM，显示错误码、阶段、相关文件及可用的 hook/plugin 身份，支持缩小与重新展开。桌面 1280×800 和窄屏 390×844 已实际截图检查；窄屏 viewport 并不代表真实 iOS/Android 浏览器兼容性测试。

传输从编译器经过 `PreparedApplication.development`、Web 命令和 `ServerHandle.setDevelopmentState` 到后端。Vite 专属 HTML/WebSocket/模块图逻辑留在 Vite 插件；core 和 React compiler 不直接调用 Vite。纯类型子入口 `@cormijs/builder/development` 不加载 Cordis Context 扩展。

## 2. 正确性与数据边界

初始网络监听事件仍叫 ready，但增加 applicationStatus。error 明确表示“服务在监听，应用编译失败并等待修复”，文本输出也作此区分，不只打印应用就绪。这不是完整实时 CLI 状态流；后续状态由开发订阅传给浏览器。

诊断 revision 单调递增，旧状态被忽略，相同 revision 的冲突内容明确拒绝。新打开的页面主动请求当前状态，不依赖错误发生时已经发出的一次广播。hasOutput 只代表本 compiler 会话是否已经成功发布过应用，不代表用户修改后的业务源码一定可运行。

浏览器信息采用有界白名单：固定解释消息、项目相对文件、有限的 hook/plugin 标识。任意 exception.message、cause、stack、环境变量、源码和私有 options 不直接序列化。显示使用 textContent 而非 HTML 插值；带有 `<img ...>` 的测试 hook ID 只显示为文字，浏览器中没有生成相应 img 或执行事件。用户主动公开数据、可信第三方插件自定义行为不属于安全沙箱保障。

prepare、build、typecheck 继续执行严格的一次性失败契约。基础配置、HTML 缺失、受管文件所有权错误等不能伪装成正常开发应用。生产 HTML/JavaScript 不注入诊断客户端；preview 不启动这套编译恢复。

## 3. 实际执行结果

| 验证 | 实际结果 | 范围 |
| --- | --- | --- |
| pnpm check | 128/128，0 fail/cancel/skip | 原 118 项 + 10 项开发恢复和后端契约用例，含框架及测试类型检查 |
| pnpm test:browser | 9/9，0 fail/cancel/skip | 原 4 项 + 新 5 项真实浏览器用例 |
| 冷启动冲突、缺失模块、运行中冲突重复 | 连续两轮，每轮 3/3 | 原用例重复验证，不计作新增六项 |
| 恢复/后端/应用命令/生成故障重复 | 连续两轮，每轮 20/20 | 原用例重复验证，不计作新增四十项 |
| plugin-vite 严格声明检查 | exit 0，skipLibCheck=false | 不以跳过依赖声明检查遮蔽本轮类型边界 |
| 物理独立 core 消费者 | 包含在 pnpm check 中通过 | 消费者的 NodeNext 检查已收紧到 skipLibCheck=false |
| 示例源码与应用 typecheck | 均 exit 0 | 两条检查入口正常，不由 build 转译代替 |
| 示例 inspect、原 P0 demo | 均 exit 0 | 历史应用命令与 raw builder 没有退化 |
| offline frozen install | exit 0 | 沿用锁定依赖和本地缓存，不升级全局工具 |

最终验证前后核对 **107 份源码、配置、补丁、示例和测试文件**的 SHA-256，确认没有变化；之后只补充结果文档和审查提交范围。仍使用 Node22.14.0、pnpm10.6.3、macOS arm64、现有 Edge155.0.4283.45 的独立无头上下文，不读取个人浏览器 profile。

新增浏览器用例分别验证冷启动冲突及深路径自动恢复、运行中冲突与新标签页状态重放、创建缺失 runtime 模块后恢复、诊断文本非 HTML 与私有异常哨兵隔离、生产资产不包含开发诊断代码。旧 Fast Refresh、嵌套路由、受管重建、runtime 清理用例仍全部通过。

## 4. 联调中发现并修正的问题

**空入口恢复后仍被缓存。** 首版把尚未成功生成的入口解析到另一个虚拟模块 ID，生成真实代码后浏览器可能继续得到空模块。修正为始终使用最终生成文件的模块身份，冷启动时只替换 load 内容，恢复时失效同一模块节点。新增真实 HTTP 的空入口到有效代码切换断言，随后浏览器自动恢复通过。

**初次预构建期间退出超时。** 原 app-tools 用例在首次请求生成入口后立即关闭，持续出现 WORKER_STOP_TIMEOUT。临时关闭探针显示 compiler 和 HTTP 关闭已发生，但 Vite close 仍等待；结合锁定版本实现，调整为先等待已进入客户端模块处理的请求收尾，再关闭可能被这些请求依赖的优化器/服务器。使用当前 Vite 的 waitForRequestsIdle 和 close，不改第三方运行时代码、不提高 worker 退出期限、不按进程名强杀。探针已经移除。消费 HTTP 响应体的测试修正单独并不能解决该问题，因此没有把根因归咎于测试。

**Cordis 声明与浏览器类型边界。** 原仅声明补丁漏掉 utils.d.ts 中 `from '.'` 的目录入口引用，补充为 `from './index.js'`。同时将浏览器 wire 类型移到独立、无 Cordis 导入的子入口，避免把 Context augmentation 引入纯展示模块。最终严格声明检查和物理独立消费者通过；这仍未解决未来发布用户如何获得补丁的问题。

**验收同步点与测试自身错误。** 初始浏览器测试中分别修正了 Shadow DOM 的文本读取方式、多标签页上下文和测试配置字符串括号。Node 故障重复曾在 app.tsx 已写入、inspect.jsonc/诊断尚未完成时断言 ready；改为等待更高 revision 的成功状态，并同时验证 inspect 哈希与 compiler 快照一致。不是增加固定长睡眠、吞掉错误或把所有状态都当作成功。修正后再次运行完整套件及两轮故障重复通过。

## 5. 使用与文档

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm build
pnpm cormi dev --root examples/basic
```

示例默认端口8001；同项目仍只允许一个 CLI 会话。使用开发示例时可临时增加与 about.tsx 同路径的 about.jsx 查看冲突面板，再移除临时文件验证恢复。测试自身使用隔离临时目录，不改动原示例业务文件制造错误。

协议见 [开发恢复](12-development-recovery.md)。桌面和窄屏截图分别位于 `.cache/cormi-development-desktop.png`、`.cache/cormi-development-mobile.png`，截图哈希已写入机器记录，不作为发布资产或源码提交。

## 6. 下一阶段和保留限制

优先推进实际打包安装的独立消费者验收，以及 Cordis 声明兼容补丁的正式分发选择，再验证 Linux/Windows。当前仍未实现完整配置覆盖来源、独立于坏配置的诊断服务器、任意第三方代码沙箱、长期内存趋势验证、断电发布恢复或在线零停机部署。没有发布 npm、推送远端或部署服务；P2 的完整退出条件仍保留在计划中。
