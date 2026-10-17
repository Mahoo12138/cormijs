# cormi P3a：真实打包消费与试用交付结果

日期：2026-10-17。接续 P2a 提交 `09218f06d48e707d4a19ed8030323e7e99b2eb7e`。本机最终 **148 项 Node 测试、10 项既有浏览器测试通过**；另将真实 tgz 的独立消费者验收完整执行两轮，每轮 36 个检查阶段全部满足预期。阶段数不是额外的 Node 测试数量，其中包含按预期失败的负向断言。精确命令、退出码、包哈希、日志、锁文件及源码哈希见 [本轮机器记录](../artifacts/p3a-review-validation.json)。

## 1. 接续范围与产物

进入工作区时已有未提交的 P3a 打包实现及 [初批验证记录](../artifacts/p3a-validation.json)。本轮先核对其中 112 份源码哈希与实际文件一致，保留已有改动，再补充私有文件、源码链接和版本一致性回归，以及整个试用包重定位后的干净重装。初批 JSON 和其引用日志未覆盖。

新增 `pnpm pack:local` 与 `pnpm test:package`。pack:local 构建并逐包调用 pnpm pack，生成 11 个真实 tgz、compatibility 声明补丁与上游许可、manifest.json 和独立 React app。所有包仍为 private；没有发布 npm、推送远端、部署服务或替项目选择开源许可证。

本轮可供本地试用的 kit 位于 `/Users/mahoo/Projects/cormijs/.cache/cormi-kit-45dc89d8-5d22-4e1a-822e-601c67d8dd38`。其中包含 `tarballs/`、`compatibility/`、`app/`、`manifest.json` 和使用说明。11 个 tgz 合计 127669 字节，这不包括第三方依赖，也不是安装大小或运行性能指标。缓存目录中的试用包不会纳入 Git。

## 2. 实际独立安装了什么

消费者创建在 workspace 外带空格和中文的临时目录，应用及依赖均从 tgz 和包管理器安装树解析，不复制 workspace 的 node_modules，不允许任何安装链接指回工作区。只共用下载缓存；启用 hoist=false、auto-install-peers=false 和 strict-peer-dependencies=true，避免提升与隐式 peer 安装掩盖依赖声明问题。

Core 消费者不安装 Vite 或 React，验证 Context 身份、服务提供/注入/卸载及严格 NodeNext 类型。Launcher 消费者从自己的 CLI bin 执行自定义命令，不依赖 Web 构建后端。SDK 消费者检查全部公共 ESM/类型入口和禁止的内部深路径。React 消费者仅声明入口、preset、runtime 和 React peers，未把全部传递包提升为顶层依赖。

React 消费者第一次安装后，将整个 kit 移到另一含中文和空格的路径，移除该消费者自己的 node_modules，然后执行 `pnpm install --offline --ignore-scripts --frozen-lockfile`。旧位置不存在；tarball 与补丁哈希保持一致；pnpm-lock.yaml 没有变化；重新安装的链接仍只指向消费者内部。后续全部应用操作使用这份迁移后重新安装的 CLI 和依赖。

真实应用链路包括 prepare、typecheck、inspect、页面渲染、计数器、组件 Fast Refresh 保留 Count:2、结构冲突及修复、`/demo/users/73` 深路径、连续 build、构建失败保护旧产物、类型错误非零退出和生产 preview。浏览器使用本机 Edge 155.0.4283.60 的独立无头上下文，两个消费者运行均没有未预期 pageerror，测试没有读取个人浏览器 profile。

## 3. Cordis 补丁的交付决策

暂时继续使用 cordis@4.0.0-rc.11，由**消费者根** package.json 的 `pnpm.patchedDependencies` 显式启用声明补丁。kit 已提供该配置、补丁文件和与固定参考 checkout 一致的上游许可文本。它解决了本地 pnpm 试用者获得兼容配置的问题，不意味着普通 npm/yarn 安装自动获得补丁。

负向消费者不设置补丁：Node ESM 运行正常，而严格 NodeNext 类型检查按预期退出 2，并出现 Cordis 声明路径错误。正向消费者使用同一批 tgz 与根补丁，skipLibCheck=false 检查通过。补丁前后 Cordis 运行时 JavaScript 哈希相同，且 cormi 导出的 Context 与实际 Cordis Context 是同一对象。没有 fork、第二套 Context、postinstall 改写或 any/skipLibCheck 掩盖。

无补丁透明公共分发仍是发布门槛。后续可核验上游修复版本再移除补丁，或另行决定正式分发策略；本轮没有未经验证地升级依赖或宣称此限制已经消失。

## 4. 打包边界与本轮修复

包验证核对 exports 的 types/import 目标、CLI 文件与 shebang、内部版本、已声明的裸包依赖、相对引用、source map 目标和归档成员。dist 对应 src 一并交付，以免声明/JavaScript 的 source map 指向包外缺失文件。默认 preset 的公开声明显式使用 Preset，避免推导类型让消费者额外依赖未声明的传递类型。

本轮新增五项打包边界用例，其中四项首先在原实现上失败，随后修复：归档中的 .npmrc、私钥/证书或 .cormi 文件原本可能漏过检查；归档自身版本未与清单版本核对；复制示例会带入 src/.env.local；symlink 源目录会被复制为返回原路径的链接。原始失败日志为 `.cache/p3a-boundaries-red.log`，哈希保留在机器记录中。

修复后，包与模板都检查已知敏感路径；模板先读取并检查所有源文件，再独占创建输出并写入独立文件。链接、硬链接、受限私有文件和超预算目录会明确失败，原有目标不会被覆盖。第五项验证正常模板可复制、不会随源文件后续改动变化，并拒绝已存在的目标。这是已知路径/文件名规则，不是任意源码内容的密钥识别系统，也不是不可信第三方包沙箱。

同一源码重复 pack 的原始 tgz 字节可能因 pnpm 对 dependency 对象序列化顺序变化而不同。每个原始 sha256 对应实际归档；contentSha256 仅规范化依赖对象键顺序，保留 exports 条件顺序。两轮包内容摘要相同，不将其表述为字节级可重现打包。

## 5. 最终验收

| 验证 | 本轮结果 |
| --- | --- |
| pnpm check | 148/148 Node 测试通过；框架、测试及打包脚本类型检查通过 |
| pnpm test:browser | 10/10 既有真实浏览器测试通过，0 失败/取消/跳过 |
| pnpm test:package | 两轮完整通过，每轮 36 个检查阶段；使用全新外部消费者 |
| 打包边界定向重复 | 15/15 通过，不重复计为新增测试 |
| 严格声明检查 | Vite provider 的 skipLibCheck=false 通过；独立包消费者也检查严格类型 |
| 示例源码、cormi typecheck、inspect、P0 demo | 全部退出 0 |
| offline frozen workspace install | 退出 0，锁文件与工作区一致 |
| pnpm pack:local | 生成并验证本轮 11 包试用 kit，没有发布 |

相对上次已提交的 P2a，Node 用例增加 15 项；相对本轮接续的初批 P3a，实现复核新增 5 项。消费者检查的 raw NodeNext 错误、缺少 react-dom peer、失败构建和失败类型检查均是明确预期的负向结果，不是被忽略的回归失败。

最终验证期间对 113 份所选源码、配置、测试、示例、补丁及许可文件计算哈希，每条命令结束后核对未变化；最后仅补充结果文档。每次消费者的实际 pnpm-lock.yaml 都存入独立日志目录并记录哈希。pack:local 初始 app 不安装依赖、没有现成锁文件；第一次安装后应保留生成的锁文件。

## 6. 使用与保留限制

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm test:package
pnpm pack:local
```

将输出的整个 kit 复制或移动到 workspace 外，再进入 app：

```sh
pnpm install --ignore-scripts
pnpm exec cormi typecheck
pnpm dev
```

停止 dev 后再执行 `pnpm build`、`pnpm preview`。也可用 `pnpm pack:local --out <尚不存在的外部目录>` 直接指定输出位置。不要在原仓库 .cache 下直接安装，以免 pnpm 将其视为外层 workspace 的一部分；不要仅搬走 app 而遗漏相邻 tarballs 和 compatibility。

这不是完全离线依赖镜像，首次安装可能需要网络。测试使用固定 Node22.14.0、pnpm10.6.3 与本机依赖缓存，尚不保证 npm/yarn、Linux/Windows、所有 peer 版本或原始无补丁消费者。公开包名归属、项目许可与正式发布仍待明确；运行时和 CLI 名称仍为 cormi，分发包名才使用 cormijs。

下一切片优先执行 Linux 的真实构建/生命周期/包消费验证并处理 Windows 差异，再用一个小型真实应用评估插件复用价值。不因打包通过而勾选整个 P2/P3；长期资源趋势、自动中断发布恢复、首次坏配置的独立诊断服务等原有门槛继续保留。

实现与协议：[打包工具](../scripts/packaging.ts)、[独立消费验收](../scripts/test-package.ts)、[新增边界测试](../tests/packaging-boundaries.test.ts)、[消费协议](15-package-consumers.md)。
