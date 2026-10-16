# cormi P1c：受管构建发布与应用检查结果

日期：2026-10-16。基于 main 上的 P1b 提交 `9bb655eee58df34ef7eb820aaa048e3c37b81ce3` 继续开发。本轮本机最终验证为 **118 项 Node 测试、4 项真实浏览器测试通过**；完整 P1/P2、跨平台与发布门槛仍未全部完成。原始命令、退出码、日志哈希与源码哈希见 [P1c 机器记录](../artifacts/p1c-validation.json)，不覆盖历史 P0/P1a/P1b 记录。

## 1. 实际交付

Web 命令层增加受管 publication，支持重复 build。构建器仍仅写分配到的全新目录，完成后验证完整文件清单，再替换本项目拥有、且未被手工修改的旧产物。core 与 launcher 没有引入 Vite/React/TypeScript 依赖；发布逻辑不是把 Vite 的原始 build 偷换成全局清目录。

React 生成集新增 routes.d.ts 和 inspect.jsonc。路由类型来自最终 IR；清单记录 app.tsx/routes.d.ts 的内容哈希、生成 ID 和白名单摘要。每个文件单独受管写入，不宣称多文件原子事务；检查命令通过哈希拒绝混合代际文件。

inspectionPlugin 提供应用 inspect，读取上一次成功生成的快照，不重新扫描页面。独立 plugin-typescript 提供应用 typecheck，先 prepare，再检查业务与生成根；默认 preset-react-vite 装配这些插件。TypeScript 按需加载，独立测试证明检查与快照能力不需要 builder 或 Vite provider。

所有新包保持 private。精确接口、迁移方法与故障语义见 [发布与检查协议](10-publication-and-tools.md)。

## 2. 产物保护与恢复

成功输出包含 .cormi-build.json，记录格式、项目指纹、发布 ID、文件/目录清单与 SHA-256。未拥有的已有 dist 不自动接管；被增加、删除或修改过文件的目录不自动覆盖。对 P1b 旧产物，应先保管旧目录或选择新的 app.outDir，不靠自动补写 manifest 推断所有权。

构建失败、返回错误 staging 路径、缺失入口、产物含 symlink/hard link 或取消，都会拒绝发布。旧目标在切换之前保持不变；正常失败会清理本轮 staging。切换失败尝试恢复 previous；恢复也失败时保留事务目录和锁，下一次发布拒绝进入，避免覆盖唯一可恢复的旧产物。

测试包含真实文件操作、并发调用和强杀独立测试子进程。切换/回滚故障通过内部 rename 注入点确定性模拟；没有把这些测试写成真实断电实验。替换由两个目录 rename 实现，**不是单次原子交换，不保证外部读者无可见缺口，更不是在线零停机部署**。父进程/worker 强杀或断电可能遗留锁和工作目录，当前没有自动恢复命令。

## 3. 应用检查边界

inspect 输出明确包含 basis=last-successful-generation、freshness=source-not-reevaluated。结果含路由来源、runtime 模块与 hook 顺序，不输出完整 app、插件私有 options 或 process.env。它仍经过可信配置求值、插件初始化与现有 CLI 项目锁，不能声称在任何坏配置下都能离线无副作用查看。

typecheck 读取用户 tsconfig，缺失时使用明确的内存默认值。无论 exclude 是否排除 .cormi，都加入生成根；强制 noEmit=true 和 noCheck=false，不输出业务 JS 或 tsbuildinfo。页面不是 React 组件、路由参数/ID 类型错误和业务类型错误均有回归。solution/project references 暂不支持，明确失败；checkJs 等业务选项仍由用户配置决定。

实际测试还验证 build 可以转译某些类型错误代码、但 typecheck 必须失败；这证明两条命令的职责不同，而不是声称 build 已自动做完整类型检查。

## 4. 最终执行结果

| 验证 | 实际结果 | 范围 |
| --- | --- | --- |
| pnpm check | 118 tests / 118 pass / 0 fail / 0 cancelled / 0 skipped | 框架/测试类型检查与 Node、真实 CLI/worker、文件、HTTP 回归 |
| pnpm typecheck:example | exit 0 | 示例源码的既有检查 |
| pnpm test:browser | 4 / 4 pass，0 fail/skip/cancel | 实际 React DOM、路由、状态、生命周期及产物预览 |
| 浏览器结构更新定向重复 | 连续 3 次，每次 1 / 1 pass | 保留计数、页面新增/删除与冲突恢复，不额外算成三个新用例 |
| publication/generation/react-compiler 重复 | 24 / 24 pass | 发布、生成与异步故障的重复回归，不重复计数为新增 |
| pnpm demo | exit 0 | 原 P0 raw builder 示例未退化 |
| offline frozen install | exit 0 | workspace 与锁文件一致 |
| examples/basic 的 cormi typecheck | exit 0 | 文档中的真实应用命令可执行 |
| examples/basic 的 cormi inspect --json | exit 0 | 生成快照可读，命令结束释放锁 |

最终验证开始和结束对 **99 份源码/配置/测试/示例文件**计算哈希，确认未变化；后续只补充结果文档与检查提交范围。仍使用现有 Node 22.14.0、pnpm 10.6.3、macOS arm64、Edge 无头独立 profile 和锁定依赖，没有升级全局工具或读取个人浏览器 profile。

相对 P1b 增加 25 个 Node 用例：publication 11、app-tools 11、generation 1、react-compiler 1、Vite 受管失效 1。四项浏览器测试数量未增加，但生产预览用例扩展为首次 build、成功重建、失败重建保留旧产物、删除源页面后仍可预览。

## 5. 测试发现与修正

首批针对性测试通过后，完整回归在 117 项中暴露两处问题。一处是没有 runtime 插件时，生成的空数组缺乏明确类型，新的真实 typecheck 场景报隐式 any；修正为显式 RuntimeEntry[]，没有放宽 strict 或开启 noCheck。另一处是输出 symlink 在新前置校验中更早返回 OUTPUT_PATH_INVALID，旧测试还期待 OUTPUT_NOT_FRESH；更新精确错误契约，仍保留不改动目标的断言。

浏览器首次回归中，测试在看到磁盘入口更新后立即导航，但后续整页刷新打断了 page.goto。起初调整验收同步点为真实 DOM 刷新，完整四项通过后，额外重复仍重现 ERR_ABORTED。因此没有将一次通过当作问题解决，也没有添加固定长睡眠或吞掉导航错误。

进一步修正为每个 Vite 会话登记显式 invalidate 管理的文件，其 handleHotUpdate 不再同时传播原生 watcher HMR；生成入口只由明确提交后的 invalidate 发起刷新，普通页面保留 Fast Refresh。新增真实 watcher 回归验证这些文件的自动 HMR 模块列表已过滤，HTTP 转换内容仍更新。修正后 118 项 Node、4 项浏览器及三次浏览器定向重复均通过。浏览器删除页断言还加强为当前页面自动恢复到 404，而非手动第二次导航掩盖同步问题。

此外，代码审查收紧了 AtomicEntry 的目录身份检查：在读旧文件、同内容快路径和临时文件写入前也核对目录，避免仅在最终 rename 前发现被替换；新增目录换成 symlink 的回归。异步 hook 变更也在计算末尾检查 revision，不能生成来源清单与实际贡献不一致的结果。

## 6. 使用

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm build
pnpm cormi typecheck --root examples/basic --startup-timeout 30000
pnpm cormi inspect --root examples/basic --json
pnpm cormi build --root examples/basic --startup-timeout 30000
pnpm cormi preview --root examples/basic
```

同项目仍只允许一个 CLI 会话，先停止 dev/preview 再执行其他命令。只有符合新所有权协议的 dist 才能重复替换；不对未知旧目录使用清空策略。发生 PUBLISH_ROLLBACK_FAILED 或异常中断时，先确认相关进程终止并检查事务/备份，不能先删除 .cormi-publish-*。

## 7. 下一切片

优先补首次路由错误的开发态修复恢复和结构诊断 overlay，然后执行 Linux/Windows 与真实打包消费者验证。Cordis 声明补丁如何分发仍待解决；完整配置覆盖来源、实时插件图、跨文件事务、断电耐久性、自动发布恢复、长期内存趋势和在线部署都没有在本轮完成。没有发布 npm、推送远端或部署服务。
