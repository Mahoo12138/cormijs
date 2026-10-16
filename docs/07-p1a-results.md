# cormi P1a：配置启动与命令生命周期结果

记录日期：2026-10-16。阶段：P1a。**本机回归 70 项通过，完整 P0 跨平台门槛与 P1 React SPA 未完成。** 机器记录为 artifacts/p1a-validation.json，不覆盖历史 P0 文件。

## 1. 本轮交付

用户明确框架名为 cormi，分发包名才使用 cormijs。已同步产品名、CLI、cormi.config.ts、.cormi、.cormi.lock、CormiError、日志与临时路径。原本地路径保持 /Users/mahoo/Projects/cormijs；包解析名保留 cormijs/@cormijs，不维护两套实现。

新增 packages/cormi，发布标识为 private 的 cormijs，提供 defineConfig、definePreset、命令行、独立配置编译、锁、IPC 和 worker supervisor。core 只增加命令协议；注册表也是 Cordis provider，Web 命令由插件登记，launcher 不 import Web/Vite。examples/p0/cormi.config.ts 是显式 HTML+Vite 组合，不是 React preset。

配置已支持异步工厂、嵌套 preset、稳定插件 ID、禁用项、app 合并/冻结与 watch。静态编译不执行配置顶层代码，.env 与配置在新 worker 求值；关闭确认 child close 后才释放锁。

## 2. 环境

沿用现有 Node 22.14.0、pnpm 10.6.3、macOS arm64，以及 Cordis 4.0.0-rc.11、Vite 7.3.2、TypeScript 5.9.3、tsx 4.23.15。配置编译显式使用已有依赖缓存的 esbuild 0.28.2，安装使用 offline/ignore-scripts。未运行参考仓库脚本，未修改全局 PATH、Node 或代理。

Cordis 仍使用上一轮只改声明的 pnpm patch，不改上游运行时；未来发布的消费者分发问题仍未解决，所有包保持 private。

## 3. 已执行测试

pnpm check 检查框架/测试类型并运行 node:test：**70 tests、70 pass、0 fail、0 cancelled、0 skipped**。相对 P0 增加 29 项；旧 provider 替换、独立消费者、真实 Vite 构建和 20 轮启停回归均保留。

| 测试文件 | 数量 | 证据范围 |
| --- | ---: | --- |
| core.test.ts | 14 | 旧 13 项 + 父子等待依赖环的有界失败与清理 |
| hooks.test.ts | 8 | 顺序/冲突/登记快照/错误来源 |
| isolation.test.ts | 1 | 不可解析 Vite 的物理独立 core 消费者及 NodeNext |
| providers.test.ts | 5 | consumer 不变更换 provider、卸载、迟到会话 |
| vite-build.test.ts | 7 | build/preview、输出保护、取消和私有 env |
| vite-dev.test.ts | 7 | 实际服务、20 次启停、端口占用、初始化卸载 |
| config.test.ts | 5 | 配置合并/冻结/身份/循环、静态依赖及缺失路径 |
| locks.test.ts | 4 | 独占、token 变化、symlink、stale 与 canonical 根 |
| commands.test.ts | 1 | 命令调用、重复注册及作用域卸载 |
| launcher.test.ts | 12 | 真实 CLI/worker、工厂/env、锁、重载/恢复/超时 |
| launcher-boundaries.test.ts | 3 | 私有输入 HTTP 拒绝、运行时修复、清理挂起 |
| launcher-recovery.test.ts | 3 | 显式 watch、.env 重载、父进程强杀/合作式退出/stale 锁 |

launcher 测试运行真实 Node 子进程和 Vite dev/build/preview，访问 HTTP、修改临时文件，检查端口、锁和缓存，并非只有 mock。fixture 独立，清理只针对自建资源，不按模糊进程名停止其他服务。

## 4. 实际发现并修正的问题

**IPC 回调类型。** 首轮编译暴露 process.send 参数隐式 any，按 Node 类型修正，没有用 any 隐藏。

**测试配置字符串错误。** 第一轮 62 项中两个自定义命令测试失败，共用 echo 字符串少闭合括号。修复字符串、增加结构化事件诊断，原断言保留后通过；这不是框架生命周期失败。

**ready 瞬间修改丢失。** 扩展到 65 项时，运行时配置恢复测试超时。supervisor 在 ready 后进行了两次采样，两次之间的文件修改被误登记为已使用的基线。改为记录编译指纹及 worker 初始化时的 watch 指纹，不以 ready 后新内容替代已执行输入。启动中修改和紧邻 ready 的修改都有回归。

**点目录不代表配置私有。** 生成临时配置模块后，必须显式禁止开发服务器访问。增加 serverOnlyFiles 与 Vite deny 策略；实际请求配置、传递依赖、raw query、config.mjs、锁文件和 /@fs 均返回 403。不能把这一保护当作可信第三方插件沙箱。

## 5. 故障语义

语法错误保留旧服务并等待修复，相同内容不重启风暴。运行时 app 错误要在新 worker 验证，此时旧 worker 已停止，报告没有旧服务；修复后恢复。不能把两种情况统称为任何错误都零停机回滚。

同项目第二个 build 在配置求值/写入前返回 PROJECT_BUSY，原 dev 和缓存不变；不同项目仍可执行。symlink 根别名归一化到同一锁，锁身份改变则旧 owner 不删除。

CPU 阻塞配置由 supervisor 的超时限制，终止其准确持有的 worker，并在确认退出后释放锁。挂起清理产生非零退出与 CLEANUP_INCOMPLETE/WORKER_STOP_TIMEOUT，不把超时包装成取消已完成。

父 CLI 被强杀时，合作式 worker 通过 disconnect 关闭；父进程无法 finally，因此保留 stale 锁，下一次仍拒绝。没有验证也不保证父进程死亡且 worker 同时 CPU 阻塞能自动恢复。

## 6. 运行

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm build
pnpm check
pnpm cormi dev --root examples/p0
```

Ctrl+C 停止后可执行 pnpm cormi build --root examples/p0，再执行 pnpm cormi preview --root examples/p0。当前输出目录必须不存在，已有 dist 不会覆盖；保管旧产物或选择其他 app.outDir。pnpm demo 仍是一轮构建/预览检查/退出，不是常驻开发命令。

## 7. 尚未完成

路由 IR、页面扫描、.cormi/app.tsx 生成、revision/提交协议、生产 staging、React/Router/runtime、React-Vite 桥接与默认 React preset 尚未实现。inspect/typecheck 应用命令待做，pnpm typecheck 只检查 workspace。

未执行 Linux/Windows、React 浏览器交互/Fast Refresh、npm tarball 全流程或长期内存趋势测试。70 项通过不代表所有平台/任意插件都可靠。锁不自动回收，动态依赖需显式 watch，默认执行超时与 patch 分发限制见 [协议](06-naming-and-launcher.md)。

下一切片为路由 IR、受管生成/提交及 React 插件组合。参考 cordis/umi 保持不变，没有发布、推送、部署或创建顶层 Git。
