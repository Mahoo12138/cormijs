# cormi：TypeScript 项目引用与可替换检查器

日期：2026-10-20。P16 实现协议，基于 P15。最终执行结果见 [P16 记录](58-p16-results.md)。本轮处理应用类型检查，不提供新的应用构建器、TS watch 服务或第二套 Cordis 生命周期。

## 1. 能力归属

`@cormijs/plugin-typescript` 提供三个原生入口：`typescriptServicePlugin` 提供 `typechecker` 服务；`typecheckCommandPlugin` 注入 `commands/application/typechecker`，负责 prepare、检查和关闭；旧的 `typescriptPlugin` 用 `ctx.plugin()` 组合前两者，默认 preset 的使用方式不变。命令消费者可以在不改源码的情况下换一个检查器，撤回所需服务后不会回退或保留一个假的可用命令。

`TypeChecker.check(root, generated, signal, options?)` 是领域契约；默认实现为按需加载的 TypeScript 5.9.3。普通调用仍可直接使用 `checkTypes()`。更换服务的测试证明原生注入、撤回和清理契约，不声称已经交付第二个生产编译器。

`generatedProject` 属于 TypeScript 插件的 options，而不是 app 或 bootstrap 的字段。Web 解析器不需要知道 TS 项目引用的选项，core 和 launcher 也不获得 TS 专属分支。早期试写 app.typecheck 被现有 Web 边界拒绝后，改为领域插件自己的配置，没有扩大 Web 白名单。

## 2. 使用正常的 solution 配置

根 tsconfig.json 可以只描述项目集合：

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

浏览器项目应明确包括生成目录，例如：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": false
  },
  "include": ["src", ".cormi/**/*"],
  "references": [{ "path": "./shared" }]
}
```

`shared/tsconfig.json` 则按 TypeScript 原生要求设置 composite/declaration 和自己的输入输出位置。被代码依赖的项目必须满足原生 composite/noEmit 约束；根 solution 只聚合的 noEmit 应用/工具项目与被实际导入的声明依赖不是一回事。Node 项目保留自己的 lib、types、module 等设置，不为了前端检查而向所有项目注入 DOM/React 全局类型。

这里使用 TypeScript 官方 SolutionBuilder，保留依赖顺序和声明边界；没有把全部源文件摊平成一个 Program，也没有利用未公开的普通 CompilerHost 源码重定向开关。项目可以使用目录引用、自定义配置文件名、嵌套聚合和菱形依赖，重复节点仅解析一次。

独立项目仍用普通 Program 检查，兼容原先的 noEmit 行为。没有 tsconfig 时继续使用既有内存默认配置，并非本轮新改成严格消费模板；实际应用建议维护自己的 tsconfig。

## 3. 生成文件归哪个项目

有引用图时，如果恰好一个项目的 TypeScript 解析结果已经包含 `.cormi/app.tsx`，它就是生成根的所有者。普通单项目或本身包含实际根文件的根配置保留原有注入行为。纯 solution 的零个或多个候选不会根据文件名、项目顺序或 jsx 选项猜选，而是报告 `TYPECHECK_GENERATED_PROJECT_REQUIRED`。

TypeScript 5.9.3 的本地探针显示，单写目录名 `.cormi` 不等价于 `.cormi/**/*`，前者可能不展开点目录；这里以实际解析结果为准，不增加另一套 glob 算法。明确排除了生成文件的高级应用，可以为检查插件指定归属：

```ts
import { defineConfig } from 'cormijs';
import { reactPlugin } from '@cormijs/plugin-react';
import { typescriptPlugin } from '@cormijs/plugin-typescript';

// 这是无构建后端的 typecheck 组合，不是完整 dev/build preset。
export default defineConfig({
  plugins: [
    { id: 'react', plugin: reactPlugin },
    {
      id: 'types',
      plugin: typescriptPlugin,
      options: { generatedProject: 'tsconfig.app.json' },
    },
  ],
});
```

选定文件必须已经属于根引用图，配置值必须是项目相对的配置文件路径。使用默认 React–Vite preset 时，优先将 `.cormi/**/*` 纳入唯一浏览器项目；确需显式 options 时，在自己的 preset 组合中调整已有 `typescript` 项，不能再额外挂一份同名服务。

生成入口和路由声明会一起加入所有者，不能利用 exclude 跳过组件类型/路由参数校验。生成入口使用显式 TS/TSX 模块路径，所有者检查时启用 allowImportingTsExtensions；其他项目不因此统一改写模块选项。不会静默扩大 composite 项目的 rootDir：若原 rootDir=src 排除了根部 .cormi，应由作者明确调整目录布局或配置，原生 TS6059 会保留。

## 4. 不写业务输出，也不相信旧声明

solution 检查需要上游声明才能按原生引用语义检查下游。每次调用建立自己的内存文件覆盖层，让 composite 库仅产生内存声明，并在同一调用中供下游读取。JS、声明、source map 和 tsbuildinfo 不写到业务文件系统；TypeScript 的创建/删除/修改时间回调也不转交磁盘写入。

每轮都 force 检查当前源输入，所有项目 noCheck=false。预先计算并屏蔽本轮声明目标，忽略旧构建信息，避免磁盘旧 `.d.ts` 让新源码错误被掩盖。已经在磁盘上的声明、构建缓存和业务输出保持原字节，不会先删除再生成。虚拟输出之间的冲突、覆盖已检查输入以及越出应用根的输出都会拒绝。

这不是 tsc --build 的发布替代：它不更新供其他进程使用的真实声明、不维护持久增量缓存，也不会把内存里成功的依赖产物发布出去。原生诊断包括配置、语法、语义和声明生成约束；上游失败会阻止其依赖分支取得成功结果，不拿后端转译成功替代类型检查。

整个 `cormi typecheck` 仍会先 prepare，所以可以更新受管 `.cormi`。不写业务编译输出不等于整个命令完全不写文件。成功后再次核对生成清单的 generation；检查不能基于一代入口却返回另一代摘要。

## 5. 输入变化、取消与资源归属

覆盖层记录读取的文本、目录扫描、模块解析时存在/不存在的文件及目录，并在结束前重查。中途变化报 TYPECHECK_INPUT_CHANGED，不自动重放整个命令。特别是只查询过 fileExists=false 的高优先级模块候选后来出现，也必须使结果失效；不能只验证最终读到的源码文件。

内容与探测重查不是文件系统事务，也不承诺捕获“改变后又完全恢复”的所有瞬间。配置和源模块仍是可信项目输入，不把这些检查描述为恶意文件系统沙箱。引用配置限制在应用根内且不使用符号别名；extends、模块解析和声明依赖仍按 TypeScript 执行，不把引用配置范围说成所有磁盘读取都被隔离。

命令插件通过自身 AbortController 与调用方 signal 组合管理一次检查。撤回 checker 时，原生消费者先取消、等待已接受检查实际收尾，再关闭 prepared application；迟到返回不能成为成功 result。准备阶段取消、准备结果随后才到达时，也必须关闭该结果，不能启动检查器。独立直接调用 checkTypes 的调用者自行持有取消信号。

TypeScript 编译主要是同步计算，同一线程 AbortSignal 不能抢占同步 CPU 工作；独立 worker 的期限仍由已有 launcher 负责。这里没有另起一套 TS worker 调度器，也不宣称服务退出能强制终止任意第三方同步函数。

## 6. 有界结果与当前范围

成功返回 compiler、version、mode=single/solution、唯一根文件数、生成文件列表、项目配置/引用/生成所有者摘要，以及虚拟声明数。根文件数不包含全部 TypeScript lib/传递声明数量，不是性能评分。程序化错误携带诊断；CLI 沿用有限错误摘要和非零退出，不承诺完整无限日志。

一次最多64个项目、256条引用、20000个根文件项；读取与模块探测另有数量预算，虚拟输出最多20000项/64MiB。没有启用 watch、持久 tsbuildinfo、任意自定义 transformer、跨应用根的 references 或多版本 TypeScript 矩阵。单项目旧行为、用户 skipLibCheck/checkJs 等非强制选项保持原有语义。

## 7. 依据与验证

外部语义以 [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)、[TSConfig references](https://www.typescriptlang.org/tsconfig/references.html) 和已安装 TypeScript 5.9.3 的公开声明/API 实测为依据。未将编辑器的源重定向行为当成普通 createProgram 的公开契约。

固定 DeepSeek Harness 的 `native/system/tsconfig.json` 和 `native/system/packages/entry/tsconfig.json` 展示了根工具输入、引用项目与 composite 声明输出的实际组织；固定 WebUI/Satori 根配置则主要是 paths 和文件集合，不因此宣称它们实现了同一种引用检查器。借鉴模块职责，未复制其编译器或 vendored Cordis，也未更新参考 checkout。

框架测试位于 tests/typescript-*.test.ts；独立 tgz/严格声明/无 Vite 服务消费和 React solution 的 dev/build/preview 位于 scripts/test-package.ts。测试页面只增合成 sharedValue 与类型断言，不修改 Admin 业务。
