# cormi 命名与配置启动协议

日期：2026-10-16。状态：P1a 已实现，未发布的实验性协议。本文描述当前启动代码，不将后续 React/生成能力混作既有功能。

## 1. 名称与分发边界

用户明确框架名为 **cormi**，只在发布包命名时使用 **cormijs**。CLI 是 cormi，配置是 cormi.config.ts，受管目录为 .cormi，锁为 .cormi.lock，日志及错误使用 cormi/CormiError。公开环境变量前缀继续是 CORMI_PUBLIC_。

入口包目录为 packages/cormi，package.json 分发标识为 cormijs；其他包保持 @cormijs/core、@cormijs/builder 等。源码 import 使用真实包名，因此 `import { defineConfig } from 'cormijs'` 不与产品名称冲突。不创建两套运行时，也不为未发布原型保留旧错误类名兼容别名。

现有工作区 /Users/mahoo/Projects/cormijs 和参考仓库不搬迁；历史验证 JSON 不改写。npm 名称的可用性、归属及实际发布不在本轮范围。

## 2. 启动器与命令插件

CLI 管理参数、配置编译、项目锁、worker 和错误退出。core 只定义 CommandRegistry 协议；launcher 通过 Cordis 挂载注册表 provider。实际 Web 命令属于 webCommandsPlugin，它注入 commands/web 并登记 dev/build/preview。用户可以配置完全不依赖 Web/Vite 的命令插件。

命令接收 root、mode、options、signal、serverOnlyFiles。options 是经过验证和冻结的 app JSON。命令返回一次性 result 或 server handle；后者具有 URL 和可等待、幂等的 close。一次性结果在 worker 清理后发送，最终仍需结合进程退出码和清理诊断判断成功。

默认 dev 使用开发 NODE_ENV 并监听配置，其余命令默认 production；这是当前 CLI 启动策略，不是内核的 Web 实现。mode 可以传入业务环境名，--no-watch 关闭配置重载。每命令可配置生命周期元数据尚未实现。

## 3. 当前配置示例

```ts
import { defineConfig, definePreset } from 'cormijs';
import { webPlugin, webCommandsPlugin } from '@cormijs/plugin-web';
import { vitePlugin } from '@cormijs/plugin-vite';

const htmlVite = definePreset({
  id: 'example:html-vite',
  plugins: [
    { id: 'web', plugin: webPlugin },
    { id: 'web-commands', plugin: webCommandsPlugin },
    { id: 'vite', plugin: vitePlugin },
  ],
  defaults: { base: '/', outDir: 'dist' },
});

export default defineConfig(({ mode }) => ({
  presets: [htmlVite],
  app: { server: { host: '127.0.0.1', port: mode === 'test' ? 8081 : 8000 } },
  watch: [],
}));
```

顶层只接受 presets/plugins/app/watch；未知字段立即报错。preset 深度优先展开，子级默认值先于父级，用户 app 最后覆盖；对象递归合并，数组整体替换。app 限制为有限 JSON 数据，复制后深度冻结；插件私有 options 不自动序列化到客户端。

插件项包含稳定 id、原生 Cordis plugin、可选 options 和 enabled。禁用项也不能与其他项同名，cormi:commands 是保留 ID。重复服务 provider 由 Cordis 明确拒绝，插件自身 Standard Schema Config 仍由 Cordis 处理，不创建第二套生命周期。

## 4. 编译、求值与依赖追踪

Supervisor 通过 esbuild 0.28.2 静态编译入口与项目内依赖，包导入保持 external；不会执行配置顶层代码，不调用 Vite loader。结果写入当前独占会话的 .cormi/run-<id>/config.mjs。实际 import、配置工厂和插件初始化在新 Node worker 内执行。

import.meta.url/dirname/filename 映射回原始源文件，避免数据文件相对路径误指向临时目录。当前验证常见 ESM/TS，不承诺所有 Node loader、动态 require、import attributes、任意 CJS 都完全透明。静态本地文件限制在项目真实根内，不读取 tsconfig paths。

自动追踪配置入口、静态依赖、缺失相对模块候选，以及根 package.json、pnpm-lock.yaml、.env。解析失败保留候选路径，创建缺失文件可恢复。watch 可以列出其他项目相对文件，不允许越界；npm 包内部修改、任意动态 import 和所有文件读取不会自动追踪。

目前对已知文件做内容指纹轮询，默认 200ms，不是大项目性能优化版本。输入数和显式 watch 数有上限。编译前后核对静态输入；每代 worker 的基线来自编译指纹和初始化时的额外 watch 指纹，不能在 ready 后重新采样，把新修改误当作已应用。这不意味着普通文件系统读取已获得任意业务代码的事务快照。

单个 .env 在 worker import 配置前装载，父进程已有环境优先，不修改 supervisor 的环境。模式专属 .env、多层覆盖及额外展开协议尚未实现。

## 5. 锁与关闭

配置编译/求值前 canonicalize 项目根并 mkdir .cormi.lock。同项目只允许一个 CLI 会话，包含 preview 和自定义命令；不同项目独立。低层 ProjectRuntime/builder 不自动持有 CLI 锁。

owner.json 记录随机 token、PID、root 和时间；释放验证目录 dev/ino、非 symlink 与 token，只删除自己的锁内容。PID 和时间只用于诊断，不构成抢锁或自动 stale 回收依据。锁针对正常并发和误操作，不是对同用户恶意文件系统修改的权限沙箱。

正常退出顺序为停止接收任务、协作取消、等待初始化/执行收尾、关闭会话、销毁 host、确认 child close、移除当前 run 缓存，再释放锁。清理失败或超时报告非零。强制终止只作用于准确持有的 ChildProcess；无法确认终止则保留锁。

启动默认 10 秒、退出默认 5 秒，可以使用 --startup-timeout / --shutdown-timeout 调整。启动超时当前也包含一次性命令执行，大型 build 需要按情况调高；这不是构建性能承诺。

父 CLI 被 SIGKILL 后，合作式 worker 通过 IPC disconnect 清理，但父进程已不能执行 finally，因此 stale 锁和 run 缓存保留，后续返回 PROJECT_BUSY。CPU 阻塞 worker 无法处理 disconnect，在 supervisor 同时死亡时不保证自动收尾。人工恢复前必须核实所属会话与 worker，不提供按 PID/时间猜测的自动删除命令。

## 6. 重载及私有输入

语法错误在停止旧 worker 前发现，旧服务继续运行，同一失败内容不会形成重启风暴。运行时配置校验/初始化失败只有新 worker 能发现；此时旧 worker 已停止，明确报告没有旧实例，继续等待编辑修复。不宣传零停机或整应用回滚。

serverOnlyFiles 是后端无关输入。Web 命令传入已知配置依赖，Vite provider 转换为拒绝规则，额外屏蔽配置、.cormi/run-*、.cormi.lock 和常见密钥文件。真实 HTTP 测试验证配置、传递依赖、raw query、/\@fs 路径都不能读到配置内容，而普通客户端入口正常。

不禁止整个 .cormi，因为未来客户端生成入口也在其中。配置和原生插件属于可信代码；主动将密钥复制入 public、通过自定义中间件暴露数据不在沙箱保障内。官方 fs.deny 对 public 目录也有限制，见 [Vite server options](https://vite.dev/config/server-options.html#server-fs-deny)。

## 7. 实现入口与限制

代码入口：[supervisor](../packages/cormi/src/supervisor.ts)、[worker](../packages/cormi/src/worker.ts)、[config](../packages/cormi/src/config.ts)、[compiler](../packages/cormi/src/compiler.ts)、[lock](../packages/cormi/src/lock.ts)、[Web 命令](../packages/plugin-web/src/commands.ts)。

未完成：React、路由、代码生成、staging 原子发布、inspect/typecheck 应用命令、Linux/Windows、进程内插件源码 HMR、完整发布消费者验收。P1a 不是完整 P1。
