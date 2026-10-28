# 配置

## `cormi.config.ts`

配置默认导出 `defineConfig` 的结果：

```ts
import { defineConfig } from 'cormijs'
import reactVite from '@cormijs/preset-react-vite'
import { appRuntimePlugin, modelPlugin } from '@cormijs/plugin-react'

export default defineConfig({
  presets: [reactVite],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'model', plugin: modelPlugin, options: { id: 'app:model' } },
  ],
  app: {
    base: '/',
    outDir: 'dist',
    server: { host: '127.0.0.1', port: 8000 },
  },
})
```

也可以导出工厂函数：

```ts
export default defineConfig(({ root, command, mode, env }) => ({
  app: {
    base: mode === 'staging' ? '/staging/' : '/',
  },
}))
```

| 参数 | 说明 |
| --- | --- |
| `root` | 项目根目录 |
| `command` | 当前目标命令，例如 `dev`、`build`、`config` |
| `mode` | 环境文件选择器，不等于 `NODE_ENV` |
| `env` | 本次启动的不可变快照，**可能包含私有值** |

不要在 `app`、runtime options、路由 meta 或日志中整体展开 `env`。

## 顶层字段

| 字段 | 说明 |
| --- | --- |
| `presets` | 可复用的插件组合与默认值 |
| `plugins` | 原生 Cordis 插件条目 |
| `app` | 应用配置，由命令提供者和插件解释 |
| `watch` | 额外的项目内观察文件 |
| `worker` | 显式 worker 基础设施插件；普通应用不需要 |

未知顶层字段会以 `CONFIG_INVALID` 失败。

## 插件条目

```ts
{
  id: 'model',
  plugin: modelPlugin,
  options: { id: 'app:model' },
  enabled: true,
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定、唯一的实例 id；不能与保留 id 或已有条目重复 |
| `plugin` | 原生 Cordis 插件对象或函数 |
| `options` | 传给插件的选项 |
| `enabled` | `false` 时不挂载该条目 |

id 最长 128 字符，只允许字母、数字与 `:._/-`，且必须以字母或数字开头。`cormi:commands`、`cormi:diagnostics`、`cormi:worker-profile`、`cormi:execution-consumer` 是保留 id。

插件卸载时，它贡献的路由、运行时、菜单和生成内容会一起撤回。

## preset

```ts
import { definePreset } from 'cormijs'

export const myPreset = definePreset({
  id: 'my:preset',
  presets: [reactVite],
  plugins: [
    { id: 'my:feature', plugin: myFeature },
  ],
  defaults: {
    base: '/app/',
  },
})
```

- preset 可以嵌套，最多 32 层。
- preset id 不能重复，也不能循环引用。
- `defaults` 按声明顺序合并；应用自己的 `app` 覆盖 preset 默认值。
- preset 只是组合，不是特权内核。默认 preset 见[插件总览](/plugins/)。

## `app` 常用字段

以下字段由 React–Vite preset 或对应插件解释。未挂载相关插件时，功能 key 不会生效。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `base` | `/` | 部署前缀，同时用于 Router basename 和资源路径 |
| `outDir` | `dist` | 构建输出目录 |
| `server.host` | — | 开发/预览监听地址 |
| `server.port` | — | 开发/预览端口；`0` 表示随机空闲端口 |
| `pages` | `src/pages` | 约定页面目录 |
| `mountId` | `root` | HTML 挂载元素 id |
| `strict` | `false` | 是否启用 React StrictMode |
| `history` | `browser` | `browser`、`hash` 或 `memory` |
| `ssr` | `false` | 启用 SSR；还需要 `ssrPlugin` |
| `routes` | — | 显式路由 IR；设置后关闭约定扫描 |
| `runtime` | — | 低层运行时模块贡献 |
| `runtimeConfig` | — | 外部运行时配置模块引用 |

功能插件也可能登记自己的 `app` key。以对应插件页面的示例为准，不要假设所有字段都属于 core。

## 环境变量

### 文件优先级

同名 key 从低到高：

```text
.env
.env.local
.env.<mode>
.env.<mode>.local
启动 CLI 时继承的环境
```

- 继承的空字符串也是明确值，不会被文件覆盖。
- 不存在的候选文件不报错。
- 四个候选路径都会纳入观察；创建、删除、编辑或原子重命名会触发 worker 重载。
- 未选中的 `.env.other` 不会加入当前 mode 的观察集合。
- 每个文件最多 64 KiB，四文件合计最多 512 个不同 key。

### 解析规则

- 使用 Node 22 的 `util.parseEnv` 语义。
- 支持空值、注释、`export` 前缀、BOM/CRLF、单/双/反引号与跨行值。
- **不做** `$NAME`、`${NAME}`、命令替换或 dotenv-expand。
- `true`、`false`、数字仍然是字符串。
- 语法错误只报告文件名与行号，不输出错误行内容或私有值。
- `__proto__`、`constructor`、`prototype`、`NODE_OPTIONS`、`VITE_USER_NODE_ENV` 和裸 `CORMI_PUBLIC_` 被拒绝。

### 公开值

只有 `CORMI_PUBLIC_` 前缀且名称合法的字符串会进入浏览器：

```ts
import.meta.env.CORMI_PUBLIC_TITLE
```

```html
<title>%CORMI_PUBLIC_TITLE%</title>
```

- 最多 256 项，合计 256 KiB。
- 浏览器类型由应用声明，不会自动为每个变量生成类型。
- 公开前缀是主动披露声明，不是脱敏算法。

### mode 与 NODE_ENV

`mode` 只选择环境文件：

- `dev` 默认 `development`。
- 其他命令默认 `production`。
- `--mode staging` 可同时用于 `dev`、`build`、`typecheck`、`config`、`diagnose`。
- worker 的 `NODE_ENV` 由目标命令决定：dev 为 development，其余为 production。
- `preview` 服务已构建文件，不会因环境文件变化修改旧 bundle。

mode 必须匹配 `[a-z0-9][a-z0-9_-]{0,63}`，`local` 保留。

## TypeScript 项目

默认应用可以把 `.cormi/**/*` 纳入浏览器项目：

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

使用 solution / project references 时：

- 根 `tsconfig.json` 只聚合项目。
- 恰好一个项目的解析结果包含 `.cormi/app.tsx` 时，它成为生成根所有者。
- 有零个或多个候选时，需要在 TypeScript 插件 options 中明确归属：

```ts
import { typescriptPlugin } from '@cormijs/plugin-typescript'

plugins: [{
  id: 'types',
  plugin: typescriptPlugin,
  options: { generatedProject: 'tsconfig.app.json' },
}]
```

`generatedProject` 必须是项目相对路径，并且已经属于根引用图。被引用的 composite 项目仍需满足 TypeScript 原生 `composite` / `noEmit` 约束。

## 查看配置来源

```sh
cormi config --root . --for build --mode staging --json
cormi diagnose --root . --for dev --json
```

`config` 报告 preset/user/derive 的字段赋值来源，不执行目标 build，也不改写生成快照。它仍需要配置求值、插件初始化和项目写锁。

`diagnose` 在独立 worker 中检查插件、服务和贡献，不是运行中 dev 进程的在线监视器。

## 限制

- 不对 `.env` 提供敌对文件系统隔离。
- 不支持在旧 worker 上原地热更新配置；配置变化会重启 worker。
- 不提供远端密钥服务或任意 dotenv 方言。
- `app` 的完整字段来源仍由各插件 schema 决定，`cormi config` 不展示构建器内部默认值。

下一步：[命令行](/reference/cli)。
