# cormi：应用配置派生与来源诊断

日期：2026-10-18。阶段：P4c。本文描述已接入的应用输入派生，不代表所有运行时服务或构建器配置均可追溯。Windows 继续挂起；实测范围见 [P4c 结果](27-p4c-results.md)，下一项真实应用验收见 [Admin 迁移计划](26-admin-migration.md)。

## 1. 两种不同的检查命令

`cormi config --for dev` 重新求值当前可信配置、装配插件、执行应用配置派生并输出受限诊断；`cormi inspect` 仍读取上次成功生成的路由/入口快照。不把旧生成集冒充当前配置，也不让查看配置偷偷执行目标 build、生成页面或启动 dev。

```sh
pnpm cormi config --root examples/features --for dev --json
pnpm cormi config --root examples/features --for build --mode staging --json
```

`--for` 只允许用于 config，默认 dev。它决定传给配置工厂及派生回调的 command，也决定默认 mode 和 worker 的 NODE_ENV；实际执行的命令仍是 config。显式 --mode 保持独立。例子中 staging 派生将 base 从 /workspace/ 改为 /staging/，相同 mode 下的真实 dev/build 消费同一条派生链。

config 仍需要有效配置、插件就绪与项目写锁。可信配置或插件初始化本身可能产生副作用；该命令不是安全沙箱，也不是坏配置下无需求值的离线取证工具。正在运行的同项目 dev 仍会阻止另一个 CLI 会话。

## 2. 层次与顺序

配置加载器保持原语义：子 preset 默认值 → 父 preset 默认值 → 用户 app。对象递归合并，数组整体替换；对象中的 undefined 表示未提供，null 是显式值且必须被消费者接受。顶层 app:null 不再有隐式空对象含义。

应用插件装配完毕后，applicationConfigPlugin 对命令输入执行 deriveConfig。回调按 OrderedHooks 的 before/after 约束拓扑排序，再以 stage、ownerOrder 和 ID 确定候选顺序。回调输入为被冻结的 value、command、mode、signal；返回完整下一份 app 对象，不是局部 patch。需要保留其他项时显式展开 value。

```ts
import type { Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-web';

export const deployment: Plugin.Object<void> = {
  name: 'example:deployment',
  inject: ['appConfig'],
  apply(ctx) {
    ctx.effect(() => ctx.appConfig.derive.tap({
      id: 'example:deployment:base',
      owner: 'example:deployment',
      ownerOrder: 0,
      run: ({ value, mode }) =>
        mode === 'staging' ? { ...value, base: '/staging/' } : value,
    }));
  },
};
```

派生只处理应用配置，不回头安装/停用插件，不改变真实 root、command、mode、watch 或插件 options。回调不能新增/改写这些同名保留引导字段。需要根据命令选择插件集合，仍在 defineConfig 工厂内完成，避免插件是否加载依赖它自己先执行的循环。

## 3. 插件边界

applicationConfigPlugin 位于 @cormijs/plugin-web，默认 preset-react-vite 显式组合它。它提供 ctx.appConfig 和 config 命令，并通过通用命令 middleware 让实际 dev/build/prepare/typecheck 获得同一份派生输入。inspect 刻意保留旧快照语义，不执行派生；config 自己解析一次，避免重复派生。

core 只新增有限 JSON 快照与来源数据协议，以及通用 CommandRegistry.use；不拥有 Web 默认配置、React、Vite 或派生流水线。launcher 记录 preset/user 的赋值来源和禁用项，不 import plugin-web。普通无 Web 自定义命令项目仍可运行；需要这套应用配置策略时由用户显式挂载插件。

middleware 注册有稳定 ID 和作用域撤回。一次 next 不得重复调用；回调已完成后保留的 next 也不得再执行命令。请求取消及宿主活动状态在向后传递时重新检查。middleware 的接口属于可信扩展，并不声称能沙箱化任意恶意插件或强制回收未等待的第三方副作用。

## 4. 输出能回答什么

报告以 JSON pointer 表示字段，例如 /server/port；键名中真正的点不会与嵌套对象混淆，斜杠和波浪号有转义。每个字段有 present、受限 value、redacted 和 history。history 记录 preset/user/derive 来源及 set/delete，不储存历史原始值。显式用户重复赋予同样值也记录一次赋值；派生回调返回相同数据只记录回调执行顺序，不伪造值发生变化。

整个对象被标量替换时，原子字段有 delete、新字段有 set；数组作为一个配置值替换，不按索引推断“深度合并”。报告同时列出已声明插件的 ID、配置位置和 enabled，不含插件 options，也不声称列出了 Cordis 内部所有动态子插件或运行服务图。

只有 entry、base、outDir、pages、mountId、server.host、server.port 的有限普通标量在白名单内可显示；其余值包括 runtime options、任意自定义对象、公开或私有环境变量派生的自定义值一律标为 [redacted]。旧值不输出。字段名、插件 ID 和已明确展示的普通应用路径不是机密扫描器；开发者不能把秘密主动塞进这些展示标识后期待自动识别。

报告 basis 为 current-config-evaluation，validation 为 json-and-derivation-only。**这不是完整有效 Vite 配置或构建成功证明**：渲染器和构建器各自填充的默认值、Standard Schema 对私有插件 options 的最终转换、任意函数内部如何读取环境变量，以及后续第三方 middleware 再写入的变化，不在这份来源图中。命令不会为了检查这些后续层启动构建器。

## 5. 一致性与故障

配置每步被复制并深冻结，拒绝访问器、稀疏数组、循环、非有限数字、函数与保留原型字段；复制不会调用 getter。单份数据限制为 100000 个节点、64 层和约 4 MiB 序列化预算。组合后的应用输入也检查预算，不只检查每个 preset。

派生回调集合最多 256 项；执行期间新增或撤回注册会使当前结果以 CONFIG_DERIVE_CHANGED 拒收，不能发布来源与结果不一致的快照。不同命令和并行解析使用独立数据，不保存共享的“最后有效 app”。回调抛错记录 hookId/pluginId 和 cause；非法返回或保留字段修改在实际命令运行之前失败。

close 会取消并等待已经进入的派生任务。不合作的 Promise 无法被 AbortSignal 强制停止，外层 worker 的有界关闭规则仍然适用。Node 配置或本地派生插件源码修改沿用 worker 重启，并非在运行中的 server 里任意热替换配置。

## 6. 实现入口

[数据协议](../packages/core/src/config-data.ts)、[加载器来源](../packages/cormi/src/config.ts)、[命令 middleware](../packages/cormi/src/commands.ts)、[配置插件](../packages/plugin-web/src/configuration.ts)、[实际示例](../examples/features/configuration.ts)、[边界回归](../tests/configuration.test.ts)。

多模式 .env 分层、任意 CLI 业务字段覆盖、全服务运行图、构建器默认值的完整来源解释仍未实现；按真实 Admin 迁移暴露的需要决定后续范围，不继续为了增加抽象而推迟真实应用试用。
