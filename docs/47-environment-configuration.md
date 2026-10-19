# cormi：环境配置、公开值与加载一致性

日期：2026-10-19。P11 在现有 launcher、Web 命令与 Vite provider 中统一环境输入，没有增加环境服务容器、第二套插件生命周期或 Admin 业务。本文是接口与边界；实际执行结果另见 P11 结果记录。

## 1. mode 与 NODE_ENV 分开

mode 是业务环境文件的选择器，不等于 React 的开发/生产执行模式。默认 dev 的 mode 为 development，其余命令默认为 production；显式 --mode staging 可同时用于 dev、build、typecheck、config 与 diagnose。config/diagnose 的 --for 决定目标命令语义。worker 启动时 NODE_ENV 仍由目标命令决定：dev 为 development，其他目标为 production，即使环境文件或继承环境写了其他值也不会改变这一启动规则。

例如 cormi dev --mode staging 与 cormi build --mode staging 读取同一组 staging 文件，但前者的 import.meta.env.DEV 为 true，后者的 PROD 为 true。preview 服务已构建文件，不因当前环境文件变化而修改旧 bundle 中的公开值；要改变已部署客户端值必须重新 build。

mode 限制为 1–64 个小写 ASCII 字母、数字、下划线或连字符，首字符为字母/数字；local 保留。路径分隔符、点、空字符串与超长值在配置求值和项目锁之前拒绝，防止 mode 变成任意文件路径。它不是额外的配置文件执行入口，也不自动合并多份 cormi.config.ts。

## 2. 确定的文件优先级

同名键按以下顺序覆盖，右侧优先：**.env → .env.local → .env.<mode> → .env.<mode>.local → 启动 CLI 时继承的环境**。继承的空字符串也是明确值，不会因 falsy 被文件覆盖。NODE_ENV 最后再由目标命令确定。重复赋值在同一文件中以最后一项为准。

不存在的候选文件不报错，但四个候选路径全部纳入输入观察，因此后续创建、删除、编辑或原子重命名替换都会触发既有 worker 重载。未选中的 .env.other 不加入该 mode 的观察集合。每一代使用新 worker，不在旧 process.env 上不断叠加，删除变量不会留下前一代的本地值。

文件只接受项目根内的独立普通 UTF-8 文件，单个最多 64 KiB，拒绝符号链接、硬链接、目录和特殊文件；读取有界并核对身份与内容指纹。四文件合计最多 512 个不同键，每个文件最多 512 次赋值。它是可信项目中的误用和并发变化保护，不是对敌对同用户文件系统的安全沙箱或跨文件原子事务。

## 3. 值仍然是字符串，不隐式展开

采用明确的赋值边界检查，然后由 Node 22 的 util.parseEnv 解释值。支持空值、注释、export 前缀、BOM/CRLF、单/双/反引号包裹与跨行值；未闭合引号、不是赋值的行、引号后附加非注释内容、NUL 和非法变量名会拒绝，不静默忽略半个文件。引号以对应字符闭合，本实现不提供 shell 转义分隔符语义。

**不做 $NAME、${NAME}、命令替换或 dotenv-expand。** PUBLIC=${PRIVATE} 保持原始字符串，不会因为读取环境而把 PRIVATE 的值复制进公开变量。true、false、数字也都是字符串；业务类型转换和校验由应用/插件承担。值解析与环境加载不执行文件内容。

键使用 ASCII 字母/下划线开头，后续字母/数字/下划线，最长 128 字符。__proto__、constructor、prototype、NODE_OPTIONS、VITE_USER_NODE_ENV 与没有后缀的 CORMI_PUBLIC_ 拒绝。语法错误只报告文件名和行号，不把错误行的内容、私有值或文件内容哈希写进诊断输出。

## 4. Node 插件与公开客户端值

环境文件在配置模块 import、配置工厂与任何 Cordis 应用插件初始化前预检。supervisor 持有私有内存快照，通过本来就存在的私有 worker IPC 交给新进程；配置缓存只包含编译后的配置代码，不把环境值写成另一份临时 JS。worker 不再次读取 dotenv 文件，也不修改父进程的环境。

配置工厂新增只读 env 参数：

```ts
import { defineConfig } from 'cormijs';
import reactVite from '@cormijs/preset-react-vite';

export default defineConfig(({ env, command, mode }) => ({
  presets: [reactVite],
  app: {
    base: mode === 'staging' ? '/staging/' : '/',
  },
  // 需要私有值的 Node 插件应通过自己的 options 显式接收，不能整体序列化 env。
}));
```

该 env 包含继承的 Node 环境与文件值，是不可变的本次启动快照，**可能包含密钥，不能展开到 app、runtime options、route meta 或 console.log**。同一快照应用到当前 worker 的 process.env，供配置模块顶层和既有 Node 依赖读取；之后可信代码自行修改 process.env 不会反向改变快照。

客户端只接收 CORMI_PUBLIC_ 开头且名称合法的字符串，最多 256 项、合计 256 KiB。这份 publicEnv 在配置执行前截取，通过 CommandRequest → BuildPlan 传入构建后端。不会从最终 process.env 再收集值，因此插件后来增加或改写的公开项不会悄悄改变本次客户端编译输入。需要派生复杂公开配置时，使用原有 runtime options 的显式 JSON 贡献，而不是隐式修改 process.env。

浏览器使用 import.meta.env.CORMI_PUBLIC_NAME，HTML 可用 %CORMI_PUBLIC_NAME%；MODE、BASE_URL、DEV、PROD 保持对应的内置语义。客户端类型仍按应用声明的 ImportMetaEnv 管理，本轮不自动生成所有变量的类型。公开前缀是开发者主动披露的声明，不是脱敏算法；HTML 占位替换也不是针对不可信值的 HTML 转义器。

## 5. Vite 不再二次读取环境

本轮对实际安装的 Vite 7.3.2 核对了环境加载和 define 行为：原 provider 的 envFile:false 不是该版本关闭环境读取的有效开关。现在使用 envDir:false、envPrefix: [] 禁止再次加载或从进程收集，然后在 InlineConfig 中声明准确的公开 define；configResolved 将相同快照提供给开发与 HTML 读取。

生产 define 的值捕获早于 configResolved，仅在该 hook 内修改 env 会造成开发正常而 build 丢值，因此两条路径都按实际生成代码及浏览器结果验证。原生插件的 envDir/envPrefix、环境 define 和按 environments.client 指定的环境 define 都检查，不得另行公开私有项、覆盖或删除快照中的定义；直接修改 config/configEnvironment 的 define 表也不能让开发与构建静默分歧。inline mode 最终值必须与 BuildPlan.mode 相同；当前 Vite 本来就优先 inline mode，不把无效的 native mode 配置说成能改变实际模式。

独立使用低层 builder 时可显式传 BuildPlan.publicEnv；未传时只截取当时进程中的合法 CORMI_PUBLIC_ 字符串，不读取项目环境文件。普通 CLI 则始终显式传入自己的启动快照。core 只有数据接口，没有 dotenv/Vite 运行依赖，React runtime 不加载环境文件。

原生 Vite 插件和 Node 配置仍是可信代码；任意插件主动在后续 hook、中间件、transform 或 public 目录泄露数据，不由这些误用检查构成强制隔离。本轮不支持 SSR 或任意新增 Vite environment 的私有策略。

## 6. 错误、恢复与来源报告

语法/文件检查发生在旧 worker 被停止前：新选中环境文件无效时，旧服务继续响应，现有页面状态和生成物保留；相同失败内容不形成重启风暴。修复后使用新 snapshot 重启。若错误发生于可信配置求值或插件初始化，仍遵守旧策略：旧 worker 已停则准确报告 servingPrevious=false，不声称所有失败零停机。

文件在旧 worker 清理中变化时，过期候选不能初始化；在新 worker 初始化中变化时，过期 ready 不能对外交付。两者使用既有代际和输入校验，不新增独立 watcher/热替换引擎。并发编辑不是事务：过期初始化可能已经执行了外部副作用，框架只能协作关闭自己拥有的资源。

cormi config --for dev|build --mode staging --json 的 result.data.environment 给出 mode、nodeEnv、四个文件是否存在，以及键的覆盖历史/获胜来源与是否公开。不会输出值、私有内容指纹或枚举全部无关继承变量。文件键名和 CORMI_PUBLIC_ 继承键本身必须是公开元数据。此摘要不运行服务读取器，也不是 dev 进程在线快照；完整 app 报告仍沿用已有的白名单脱敏范围。

## 7. 生态参考与验证入口

固定 Koishi loader 的 readConfig 在加载插件配置前合并环境文件，保留初始继承键并移除上次本地值，见 [loader 源码](../references/koishi/packages/loader/src/index.ts)。cormi 借鉴启动顺序和所有权，不照搬其全局就地更新与吞掉读取异常的行为；这里由 supervisor 预检、独立 worker 消费，Cordis 仍只处理原生插件 Config/inject/effect。

外部接口核对依据为 [Node 22.14 util.parseEnv](https://nodejs.org/download/release/v22.14.0/docs/api/util.html#utilparseenvcontent)、[Vite 7 环境与 mode](https://v7.vite.dev/guide/env-and-mode) 和 [Vite 7 公共配置](https://v7.vite.dev/config/shared-options)。线上文档说明接口背景，真正的实现依据还包括已安装版本源码与本轮测试，不将读取网页当作所有版本兼容证明。

回归入口：tests/environment.test.ts、tests/environment-cli.test.ts、tests/environment-recovery.test.ts、tests/vite-environment.test.ts、tests/environment-review.test.ts 与 tests/browser/environment.test.ts；真实归档消费者复用 scripts/environment-fixture.ts。所有环境值为本轮生成的合成输入，没有读取或改写开发者真实机密文件。仍不承诺自定义 envDir、远端密钥服务、任意 dotenv 方言、进程内更新、Windows 或公开分发。
