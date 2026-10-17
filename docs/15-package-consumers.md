# cormi P3a：真实打包消费者与声明兼容配置

日期：2026-10-17。本文定义本地打包与验收方式；执行结果另记，不把 workspace 链接能运行当作 npm 分发可用。

## 1. 范围

使用 pnpm 10.6.3 的真实 pack 为 packages/* 逐包生成 tgz，逐个核对 exports、bin、声明、内部相对导入、依赖声明和 sourcemap。包内依赖仍使用真实发布名 cormijs / @cormijs/*。打包会将 workspace:* 转为精确版本，但并不向注册表发布。包保持 private，不自动选择项目开源许可证。

验收消费者在 workspace 外的临时目录创建，包含空格和中文路径。消费者通过 pnpm 从 tgz 安装，不复制 framework 的 node_modules，不创建返回 workspace 的符号链接，也不将所有包挂成 React 应用的顶层依赖。内部未发布包通过消费者根 overrides 指向同批 tgz；这只是代替本轮不存在的内部 npm 注册表，不是自动修复缺失 dependencies。

React 消费者首次安装后，将整个 kit 重命名到另一个含中文与空格的路径，移除该消费者自己的 node_modules，再执行 frozen/offline 安装。旧位置必须不存在，锁文件哈希必须保持不变，所有安装链接仍须位于消费者内；随后的 CLI、浏览器、构建和预览都使用这份迁移后的安装。这样验证的不只是同一路径的二次启动。

## 2. Cordis 的明确临时选择

继续使用 cordis@4.0.0-rc.11，不引入第二个 Context、不重命名上游运行时、不改 Cordis JavaScript。当前声明扩展名补丁由消费者根 package.json 的 pnpm.patchedDependencies **显式配置**，补丁文件与上游 LICENSE 随本地试用包一起提供。

这种配置解决的是“内部试用者如何获得同一补丁”的交付问题，不是宣称依赖包可以自动替消费者打补丁。无根补丁的原始 tarball 消费会作为负向测试保留：Node ESM 运行应正常，严格 NodeNext 类型检查应报告上游声明路径错误。正向配置必须在 skipLibCheck=false 下通过，并比对补丁前后 Cordis JavaScript 哈希不变。

暂不选择维护一个改名 Cordis fork，因为它增加运行时/类型身份兼容和上游跟进责任；也不使用 postinstall 修改用户 node_modules、不用 paths 映射或 any 隐藏坏声明。后续如果上游提供已核验的修复版本，应重新执行同一验收后移除根补丁。公开发布是否继续要求 pnpm 配置、选择怎样的许可和包名归属，仍需明确决策。

## 3. 试用包

`pnpm pack:local` 先构建，再生成新的 `.cache/cormi-kit-<uuid>`。也可通过 `--out` 指定一个尚不存在的目录；不会清空旧目录。其中 tarballs/ 是本批 tgz，compatibility/ 是声明补丁和上游许可，app/ 是使用这些 tgz 的 React 示例，manifest.json 保存哈希和发布限制。

将整个试用包移出 workspace 后，进入 app 执行 `pnpm install --ignore-scripts`。依赖缓存不在包中，首次安装可能需要网络；不是完全离线软件镜像。随后使用 `pnpm exec cormi typecheck`、`pnpm dev`、`pnpm build`、`pnpm preview`。同时启用 hoist=false、auto-install-peers=false、strict-peer-dependencies=true，防止提升依赖或隐式安装掩盖缺失依赖。

`scripts/test-package.ts` 通过 `pnpm test:package` 执行完整验收。它使用本机已有内容缓存以离线安装，外部包仍是独立安装副本；只复用下载数据，不复用 workspace 模块解析。缺少缓存、tar 或浏览器时明确失败，不静默跳过。当前检查工具使用系统 tar，未据此承诺 Windows 完整兼容。

## 4. 包完整性与消费者类型

发布白名单包含 dist 与 src，确保 .js.map/.d.ts.map 引用的源文件随包存在。包检查拒绝缺失 exports、损坏 source map、未转换的 workspace 依赖、未声明的编译后裸包导入、危险路径、测试/缓存/私有文件、链接和特殊归档成员。它只检查本工具自己刚生成的包，不作为处理任意不可信压缩包的公共服务。

归档自身版本必须与 workspace 清单相符。私有文件检查覆盖 .env、包管理器凭据配置、常见私钥/证书、.cormi 等目录；这只是已知文件名与路径规则，不是任意字符串的密钥识别系统。试用 app 的 src、HTML 和 tsconfig 先完整检查、读取为受限文件快照，再独占创建目标并写入独立文件。源目录/文件链接、硬链接和私有文件会在目标创建前拒绝，不通过复制指回工作区的链接交付示例。

核心消费者只有 core 和类型工具，必须无法解析 Vite/React。launcher 消费者只配置一个自定义命令，不安装 Web 构建后端。另建 SDK 消费者检查所有公共 ESM 和类型入口；React 应用消费者则只列出文档要求的入口、preset、runtime 和 React peer，避免全量 SDK 根依赖掩盖应用缺陷。缺少必要 peer 的配置也应被拒绝。

真实 React 消费检查必须覆盖 prepare/typecheck/inspect、实际页面与计数交互、Fast Refresh 保留状态、结构冲突修复、子路径动态路由、连续 build、失败 build 保留旧产物、类型错误非零退出和生产 preview。所有 server 来自消费者自己的 CLI bin。浏览器测试驱动可使用仓库测试工具，但应用及其依赖只能从消费者安装树加载。

同一源码重复 pack 时，本机 pnpm 10.6.3 可能以不同顺序序列化 workspace 转换后的 dependencies，导致 tgz 原始哈希不同。manifest 的 sha256 始终对应实际包字节，用于完整性核对；contentSha256 仅规范化 package.json 的依赖对象键顺序，并逐文件计算内容摘要，不改变源码或 exports 条件顺序。重复验收比较此内容摘要，不宣称字节级可重现打包。每个消费者生成的 pnpm-lock.yaml 另存到本轮日志目录并记录哈希，以保留实际传递依赖解析结果。

pack:local 本身不安装依赖，因此初始试用 app 不自带一份声称跨平台通用的已解析锁文件。首次安装产生锁文件后应保留并使用 frozen-lockfile；本轮重定位验收验证的是同一平台、同一已解析锁文件的可迁移性，不是新机器无缓存时完全离线可用。

## 5. 外部依据与版本限制

使用官方 [pnpm pack](https://pnpm.io/10.x/cli/pack)、[workspace 发布转换](https://pnpm.io/10.x/workspaces#publishing-workspace-packages)、[pnpm 根配置](https://pnpm.io/10.x/settings#overrides)和 [Node 22.14 包入口](https://nodejs.org/download/release/v22.14.0/docs/api/packages.html)核对行为。网页是滚动文档，本轮以本机 pnpm 10.6.3 的实际帮助和执行结果为准，不使用较新版新增的 recursive pack 或 pack --dry-run。

这一步不包含 npm 发布、推送、部署、自动升级 Cordis、完整平台矩阵、在线零停机或长期内存趋势验收。结果和发现必须记录到独立的本轮结果文件，历史 P0/P1/P2 数据不改写。
