# cormi F2a：model 约定与 useModel

日期：2026-10-20。本切片交付 F2 的第一部分：显式启用的 `modelPlugin` 发现 `src/models/**` 下的模型 Hook，按挂载创建一次性共享状态，页面通过 `@cormijs/runtime` 的 `useModel(namespace, selector?)` 读取。对象模型、reducers/effects、`extraModels`、依赖排序和初始状态仍未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { modelPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'application-model', plugin: modelPlugin, options: { id: 'application:model' } }],
  app: { base: '/models/' },
});
```

```ts
// src/models/counter.ts
import { useState } from 'react';

export default function counter() {
  const [count, setCount] = useState(0);
  return { count, increment: () => setCount(value => value + 1) };
}
```

```tsx
// src/pages/index.tsx
import { useModel } from '@cormijs/runtime';

function Counter() {
  const { count, increment } = useModel<{ count: number; increment: () => void }>('counter');
  return <button onClick={increment}>{count}</button>;
}

function SelectedCount() {
  const count = useModel('counter', (state: { count: number }) => state.count);
  return <output>{count}</output>;
}
```

`modelPlugin` 是普通原生 Cordis 插件：`inject: ['react']`，通过 `ctx.effect(() => ctx.react.models.tap(...))` 登记模型来源，卸载后下一次编译不再包含这些模型。

## 2. 发现与命名

默认扫描 `src/models`：

| 文件 | namespace |
| --- | --- |
| `src/models/counter.ts` | `counter` |
| `src/models/admin/user.ts` | `admin.user` |
| `src/models/user.model.ts` | `user` |
| `src/pages/users/models/state.ts` | `users.state` |

规则与 Umi 的默认路径命名一致：移除路径中的 `src`、`pages`、`models` 段，文件扩展名去掉，`.model` 后缀去掉，剩余目录和文件名用 `.` 连接。namespace 必须唯一，重复时以 `MODEL_CONFLICT` 失败。

可用 `options.dir` 替换目录，或用 `options.files` 显式列出模型文件；二者不能同时设置。目录中的隐藏文件、`.d.ts`、test/spec 文件和符号链接不参与加载，符号链接或非法路径明确失败。

Node 生成阶段只读取路径，不 import 或执行模型源码。模型模块作为浏览器静态 import 进入生成入口，只在挂载时执行。

## 3. 运行时语义

`mountApplication` 接受按 namespace 排序的模型描述，并用 `ModelProvider` 包住 Router：

1. 每个模型默认导出必须是函数；调用一次并缓存其返回值；
2. 返回对象中的状态和动作由同一挂载内的所有页面共享；
3. 路由切换不重建模型；完整页面刷新会销毁文档并重新创建；
4. `useModel(namespace)` 返回当前模型值；传入 selector 时返回 selector 的计算结果；
5. selector 在 Provider 重新渲染时重新计算；本切片不做 Umi 的深比较优化，消费者可能随 Provider 一起重渲染；
6. namespace 不存在时抛出 `MODEL_NOT_FOUND`，在应用外使用时抛出 `MODEL_OUTSIDE_APPLICATION`。

模型 Hook 可以正常使用 React 状态与 effect，但与路由 Hook 一样受 React 规则约束。Provider 位于 Router 外、插件 Provider 内，因此模型不能使用 `useLocation` 等路由 Hook；路由组件可以读取模型。

## 4. 类型与观察

- `.cormi/routes.d.ts` 在有模型时生成 `export type ModelNamespace = "counter" | ...`；
- `inspect.jsonc` 的 `summary.models` 记录 namespace 与模块来源，`hooks.models` 记录贡献 owner；
- 模型目录、文件增删或内容变化进入现有开发观察，重新生成入口；
- 模型来源切换受贡献 revision 检查保护；
- 同一项目可挂载多个 `modelPlugin` 贡献，但 namespace 必须唯一；当前不提供对象模型或 `extraModels`。

## 5. 与 Umi 4 的差异

参考 Umi 4.7.25 的 `packages/plugins/src/model.ts`、`packages/plugins/libs/model.tsx` 与 `ModelUtils.getNamespace`：

| 方面 | Umi | cormi F2a |
| --- | --- | --- |
| 启用方式 | `model` 插件，配置启用 | 显式 `modelPlugin` |
| 发现范围 | `src/models`、页面内 models、extraModels | 默认 `src/models`，可配置目录/文件 |
| 模型形态 | Hook 模型与对象模型、reducers/effects | 仅 Hook 模型 |
| 源码 namespace | 可解析对象/函数返回值 | 仅路径命名 |
| 运行时 | Dispatcher + 深比较 selector | React Context + selector 计算 |
| 依赖排序 | 支持 topological sort | 暂不支持 |
| 初始状态 | initial-state 插件 | 尚未交付 |

本切片不承诺 Umi model 插件或类型生成的二进制兼容。

## 6. 限制

- 模型默认导出必须是函数；对象模型不会按 Umi reducers/effects 解释；
- 不支持 `extraModels`、模型间依赖排序或 `preferSourceNamespace`；
- selector 不做深比较或记忆化；
- 模型 Hook 每挂载执行一次；不得把模型 Hook 用于 SSR 之外的 Node 阶段；
- 模型 Provider 使用 React Context，不是全局单例；多个 `mountApplication` 实例彼此隔离；
- 模型源码仍受客户端边界检查，Node SDK、私密文件、符号链接和项目外路径不能进入浏览器入口。

## 7. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/model.test.ts`（发现、命名、冲突、生成、类型、卸载） | 2/2 |
| `tests/browser/model.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 457/457，0 失败/取消/跳过（F1f 为 455，新增 2 项；约 109 秒） |
| `pnpm test:browser` | 27/27，0 失败/取消/跳过（F1f 为 26，新增 model 用例；约 282 秒） |
| `pnpm test:package` | 141 阶段满足预期（F1f 为 133，新增 8 个 model 阶段） |
| `examples/model` prepare + typecheck | 退出 0 |

浏览器验收覆盖：两个组件共享 counter；selector 读取同一状态；user 模型独立更新；路由切换后状态保留；刷新后重新创建；开发与生产预览一致。独立打包消费覆盖模型插件公开类型、`ModelDescriptor`/`useModel`、开发、构建与静态预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f2a-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 8. 下一步

- F2b：`getInitialState`/初始状态与刷新语义，已由 [F2b](67-f2b-initial-state.md) 交付；
- F2c：request/useRequest，包含取消、错误和竞态；
- U09 后续：对象模型、reducers/effects、extraModels 与模型依赖排序。
