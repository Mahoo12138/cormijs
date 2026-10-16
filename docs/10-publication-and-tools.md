# cormi：受管构建发布与应用检查协议

日期：2026-10-16。阶段：P1c。本文描述本轮实现的边界；验证结果见 P1c 结果记录，不将“能重新构建”扩张为任意故障下的无损原子部署。

## 1. 仍然由插件提供能力

core 和 launcher 不 import Vite、React 或 TypeScript。Web 命令通过 builder 服务执行原始构建，并在命令层调用受管 publication；Vite provider 只负责向分配的全新目录写入产物。React compiler 提供 application 服务和类型检查输入，inspectionPlugin 提供 inspect，独立的 plugin-typescript 提供 typecheck。默认 preset-react-vite 装配这些插件，用户可选择不加载检查插件。

原始 `ctx.builder.build` / `ctx.web.build` 仍只写全新目录，不自行替换任何已有目录。`cormi build` 的 Web 命令实现才增加 staging、目录验证和替换策略。这一区分使其他 builder 能复用发布流程，也避免把 CLI 与低层 API 的文件所有权混为一谈。

## 2. 目录所有权与重复构建

面向用户的 app.outDir 首版仍限制为项目根下非隐藏、非保留的专用直接子目录，默认 dist。src、public、node_modules 等位置禁止作为受管发布目标。Vite 低层允许项目内已存在真实父目录下的嵌套 staging 目标，但不允许父路径经过符号链接。

每次受管发布取得独立 `.cormi-publish.lock`，然后创建 `.cormi-publish-<random>/`，其中 `output/` 用于新构建，`transaction.json` 记录事务身份；发生替换时 `previous/` 暂存旧目录。CLI 的 `.cormi.lock` 仍覆盖完整命令；publication 锁还保护直接调用发布函数的正常并发。锁不是操作系统权限隔离，不防御同用户恶意替换目录。

成功发布的目录含 `.cormi-build.json`：格式版本、随机发布 ID、项目根指纹、输出目录名，以及整个输出树的文件/目录清单。文件包含大小和 SHA-256；目录也记录，以识别用户后来添加的空目录。清单不含自己的 manifest，校验时单独检查 manifest 类型与身份。

已有目标必须同时满足两项条件：由本项目的这一协议创建，且文件清单与哈希仍完全匹配。缺少记录的旧 dist 报 OUTPUT_NOT_OWNED，手工增加、删除或修改内容则报 OUTPUT_MODIFIED。框架不会因为看见同名目录就清空它，也不自动给 P1b 的旧产物补一份“所有权证明”。迁移时先保管旧目录，或选择新的 app.outDir，确认新输出正确后再自行处理旧产物。

产物验证拒绝 symlink、hard link 和特殊文件，要求 index.html 存在。当前完整清单上限是 100000 个文件/目录、文件总大小 1 GiB；超限明确失败。这些是安全/复杂度上限，不是已经完成的大型工程性能指标。

## 3. 发布、失败与回滚语义

编译回调只获得新的 staging 路径。回调失败、输出结构无效或取消时，旧 dist 未进入切换，保持不变；本轮暂存目录正常清理。原生构建不响应 AbortSignal 时仍需等待它结束，随后拒绝发布，不声称取消能够立刻停止任意第三方代码。

发布前再次确认 root、staging 和旧目录身份、旧内容清单以及取消状态。正常替换由两个同步 rename 完成：先移动旧目录到 previous，再将新目录移动到 dist。这段没有 JavaScript await，但**两个目录 rename 不等于单次原子交换**；其他进程可能观察到短暂的 dist 缺口，进程崩溃或断电也可能发生在中间。因此这是本地构建产物管理，不是零停机在线部署协议。

若新目录 rename 失败且旧目录已经移走，框架尝试将 previous 恢复到原位置，不覆盖新出现的未知目标。恢复成功则报告 PUBLISH_FAILED，旧内容保留；恢复本身也失败则报告 PUBLISH_ROLLBACK_FAILED，并保留锁、事务记录、旧目录和新产物供恢复。框架不会为了清理临时目录而删掉唯一旧副本。

新目录已经发布但后续清理失败，错误使用 PUBLISH_CLEANUP_INCOMPLETE，并明确 published 状态；不能把“退出非零”简单理解为“磁盘仍是旧版本”。这种情况需要先检查目标和工作目录，不能盲目重试。

SIGKILL 等情况下 finally 不一定执行。可能遗留发布锁和事务目录；后续发布返回 PUBLISH_BUSY，不依据 PID、年龄或超时自动抢锁。人工恢复前先确认相关 CLI/worker 均已停止，再对照 owner.json、transaction.json、dist 与 previous 的存在和 manifest 校验决定恢复方式。不要先删除整个 `.cormi-publish-*`，其中可能包含需要恢复的旧产物。当前没有自动恢复命令，也没有持久化 fsync 日志协议的断电耐久性承诺。

## 4. 三类生成文件与一致性

React prepare 现在生成：`.cormi/app.tsx` 可执行入口、`.cormi/routes.d.ts` 路由和公开环境变量类型、`.cormi/inspect.jsonc` 生成快照。三个目标共用受限 AtomicEntry 实现，每个文件写入前验证所有权，独占临时文件写完后检查目录身份与 revision，再单文件 rename。未拥有的用户文件不会被覆盖。

每轮先生成全部内容，然后提交 routes.d.ts、app.tsx，最后提交 inspect.jsonc。最后一份 manifest 存储前两份完整内容的 SHA-256、生成 ID 和白名单摘要。inspect 与 typecheck 读取时校验这些哈希；检测到中间状态或外部改写，报告 GENERATED_SET_INCONSISTENT，而不是声称这一组文件已经事务性更新。

单文件原子可见性仍然成立，但 IDE 可能在多个文件提交之间观察到混合状态；不承诺跨文件原子可见性。独占 CLI prepare/typecheck 避免正常多进程同时写入，哈希用于发现不一致。中途失败后可重新 prepare 修复由框架拥有的生成物；不回滚业务页面源码。

路由与 runtime hook 在计算开始时记录声明顺序及 revision。异步执行期间注册/注销发生变化，当前结果不能冒充同一轮的有效贡献快照。开发态下一轮重新计算；生产/一次性 prepare 明确失败。生成入口实际变化后仍通过 updates/invalidate 通知后端，不把类型文件或 manifest 的变化当作 React 页面 HMR。

Vite provider 按会话登记由显式 invalidate 管理的文件。对于这些文件，handleHotUpdate 返回空模块列表，不再让原生 watcher 额外发送一次刷新；其他业务组件仍走正常 Fast Refresh。浏览器验收同步到实际 DOM 刷新，而不是仅检查磁盘入口已经改变。此处理参考 [Vite 自定义 HMR](https://vite.dev/guide/api-plugin.html#handlehotupdate)，行为仍以本仓库锁定版本的测试为准。

## 5. 路由类型

routes.d.ts 输出 RouteId、RoutePath、RouteParamsById 和 RouteParams<Id>。类型来自已验证的最终路由 IR，包含父级参数；catch-all 对应 `"*"` 键。没有路由时联合类型为 never。路径类型表示路由模板，例如 `/users/:id`，不是把任意 URL 字符串都变成安全导航目标。

```ts
import type { RouteId, RouteParams } from '../.cormi/routes';

const route: RouteId = 'file:src/pages/users/[id].tsx';
const params: RouteParams<typeof route> = { id: '42' };
```

上面相对导入适用于位于 src 下的示例文件；不同源文件层级应使用相应相对路径。声明还包含 CORMI_PUBLIC_ 前缀下的 ImportMetaEnv 类型。没有生成带运行时逻辑的 typed-link API，也不会替代后端参数校验。

生成入口对 routes 和 runtime plugins 增加显式类型，因此 typecheck 能发现页面导出不是 React 组件、runtime 模块不符合契约，以及空插件数组的隐式 any 等问题。运行时 bundle 不引入这些 type-only 导入。

## 6. inspect：上次生成事实，不伪造当前状态

```sh
pnpm cormi prepare --root examples/basic
pnpm cormi inspect --root examples/basic --json
```

inspect 返回 basis=last-successful-generation、freshness=source-not-reevaluated，以及生成 ID、相关文件哈希、路由来源、runtime 模块位置和 hook 顺序。只输出白名单摘要，不输出全量 app、插件私有 options、process.env 或 runtime options。

inspect 不重新扫描页面、不修复生成文件、也不执行页面模块。源文件已变化甚至当前路由出现冲突时，只要上次生成集完整，仍可查看其快照；输出清楚说明并未重新验证源文件。没有完整快照则报 INSPECT_MISSING，不自动运行 prepare。

它仍经过现有 launcher：读取和求值可信配置、挂载插件、持有项目锁、写入并清理本次私有配置缓存。这不是可以在任意损坏配置或正在运行的 dev 会话旁绕过锁执行的离线无副作用命令。完整的配置覆盖来源、实时插件状态和耗时诊断留待后续，不能从当前 summary 推断这些已经实现。

## 7. typecheck：应用与生成入口都要检查

```sh
pnpm cormi typecheck --root examples/basic --startup-timeout 30000
```

typescriptPlugin 先通过 application.prepare 生成一致输入，再用锁定的 TypeScript 5.9.3 Compiler API 检查项目 tsconfig.json。不存在 tsconfig 时使用明确的内存默认值，不擅自写用户 tsconfig。现有 tsconfig 的 include/exclude 和 compilerOptions 大体保留，但强制 noEmit=true、noCheck=false，禁止输出 JS、声明文件或 tsbuildinfo；编译器被用户设置 noCheck 也不能导致本命令假通过。

无论用户是否 exclude .cormi，都把 application 提供的 app.tsx/routes.d.ts 加入根输入，以覆盖 lazy 模块导出与生成代码。完成后复核读取到的项目源码、编译器配置内容和生成 ID；观察到变化则要求重跑。它不是操作系统级源码事务快照，也不宣称验证了所有外部依赖在检查期间永远不变。

错误报告 TYPECHECK_FAILED，包含有界的文件、行列和 TypeScript 诊断编号；退出非零。当前 IPC 的消息有大小限制，不是完整诊断列表导出 API。项目引用 solution build 暂不支持，遇到 references 明确报 TYPECHECK_REFERENCES_UNSUPPORTED，不把空根项目当成全部子项目通过。JS 文件是否检查仍取决于 allowJs/checkJs 等用户选项。

该能力不依赖 builder 或 Vite 服务；测试配置可以仅装配 React compiler、TypeScript 与 inspect 插件。构建依旧只做转译：build 通过不代表 typecheck 通过，发布流水线应显式先运行 typecheck。

## 8. 数据边界、参考与后续

Vite adapter 额外拒绝 HTTP 访问 inspect.jsonc、生成声明、发布暂存目录和发布锁，同时继续允许浏览器访问 app.tsx。public 目录由用户控制，可信自定义插件主动泄露数据不在这里的沙箱保障内。

实现入口：[publication](../packages/plugin-web/src/publication.ts)、[inspection](../packages/plugin-web/src/inspection.ts)、[类型生成](../packages/plugin-react/src/types.ts)、[TypeScript 插件](../packages/plugin-typescript/src/index.ts)。官方接口依据为 [Node 文件系统 API](https://nodejs.org/docs/latest-v22.x/api/fs.html) 和 [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)；官方页面可能随版本更新，本仓库仍按 lockfile 中的版本编译与测试。

后续重点是首次路由失败修复与 overlay、跨平台、真实打包消费者和 Cordis 声明补丁的分发。当前不扩大 SSR/RSC、多构建后端、在线零停机部署等产品范围。
