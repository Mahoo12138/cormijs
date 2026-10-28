# 快速开始

## 环境要求

| 依赖 | 版本 |
| --- | --- |
| Node.js | ≥ 22.14.0（仓库验证基线 22.14.0） |
| pnpm | 10.6.3 |
| 浏览器 | Chromium 系；浏览器回归默认使用本机 Microsoft Edge |

仓库使用 `.nvmrc` 固定实验 Node 版本。不要用全局升级替代项目版本。

## 在仓库内运行示例

```sh
git clone <cormi 仓库>
cd cormijs

nvm use
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm cormi dev --root examples/basic
```

打开 `http://127.0.0.1:8001/`。首页包含计数器、静态页面、嵌套布局、动态参数和 catch-all 路由。

::: tip 为什么先 build
`pnpm cormi` 执行的是 `packages/cormi/dist/cli.js`。首次使用或修改框架包后，需要先运行 `pnpm build`。
:::

### 其他示例

所有示例共用同一套 CLI，端口和部署前缀在示例的 `cormi.config.ts` 中声明。

```sh
pnpm cormi dev --root examples/config-routes   # 配置式路由，/routes/
pnpm cormi dev --root examples/model           # 共享模型，/models/
pnpm cormi dev --root examples/request         # useRequest，/request/
pnpm cormi dev --root examples/locale          # 国际化，/locale/
pnpm cormi dev --root examples/access          # 权限，/access/
pnpm cormi dev --root examples/features        # 原生插件组合，/workspace/
```

示例源码就是文档的验收用例。遇到行为差异时，优先查看对应示例的配置和源码。

## 日常命令

| 命令 | 作用 |
| --- | --- |
| `pnpm prepare:app` | 生成路由类型、浏览器入口等受管文件，不启动服务器 |
| `pnpm dev` | 生成、启动开发服务、处理组件更新和配置重载 |
| `pnpm typecheck` | 检查业务源码、配置与生成代码，不输出业务 JS |
| `pnpm build` | 生成、转译、构建，验证成功后替换受管产物 |
| `pnpm preview` | 预览已有构建，不重新构建，也不提供 Mock |
| `pnpm inspect --json` | 读取上一次成功生成的快照，不重新扫描源码 |
| `pnpm run config:app --for build --json` | 查看当前配置派生和环境覆盖来源 |
| `pnpm diagnose --for dev --json` | 在独立 worker 中检查插件、服务和贡献 |
| `pnpm exec cormi generate page about` | 生成页面、组件、模型、API 或 Mock 文件 |

在仓库根目录把 `pnpm dev` 换成 `pnpm cormi dev --root <root>`；在新创建的应用中，这些脚本已经写入 `package.json`。

`build` 成功不代表类型正确：构建转译和 `typecheck` 是两条独立检查，CI 应分别执行。

## 从本地 kit 创建应用

框架包当前是 private，创建器通过本地 tarball kit 工作。两个目标目录都必须不存在，父目录必须存在。

```sh
cd /path/to/cormijs
pnpm build
pnpm pack:local --out /path/to/cormi-local-kit

pnpm create:app /path/to/cormi-first-app \
  --kit /path/to/cormi-local-kit --template react-api

cd /path/to/cormi-first-app
pnpm install --ignore-scripts
pnpm prepare:app
pnpm dev
```

模板：

- `react`：基础 React SPA，无开发 API。
- `react-api`：包含可点击的 Mock 请求示例。
- `plugin-react`：插件作者项目，包含库构建与应用构建的分离。

创建器不会自动安装依赖、初始化 Git 或覆盖已有目录。新项目内含 `.cormi-local/`，保存本轮的框架归档、哈希清单和 Cordis 声明补丁；移动项目时要一起保留。

::: warning 把 kit 移出 workspace
如果 kit 或新应用仍在 cormi 仓库的 pnpm workspace 内，先整体移到仓库外再执行 `pnpm install`。否则 workspace 会接管依赖解析，无法验证真实的独立消费。
:::

## 环境文件与 mode

`mode` 决定读取哪个环境文件，不等同于 `NODE_ENV`。`dev` 默认 `development`，其他命令默认 `production`；显式 `--mode staging` 可同时用于 `dev`、`build`、`typecheck`、`config` 和 `diagnose`。

文件名优先级从低到高：

```text
.env → .env.local → .env.<mode> → .env.<mode>.local → 启动 CLI 时继承的环境
```

只有 `CORMI_PUBLIC_` 前缀的变量会进入浏览器。公开值可以是：

```ts
import.meta.env.CORMI_PUBLIC_TITLE
```

在 HTML 中则是 `%CORMI_PUBLIC_TITLE%`。私有值只应通过插件 options 显式传入，不要整体序列化到 `app`、runtime options、路由 meta 或日志。

## 常见问题

**端口被占用。** 同一项目只允许一个 CLI 会话；不同项目可以并行，但端口不能冲突。先停止占用端口的进程，再检查 `.cormi.lock` 是否属于仍然存活的会话。

**dev 结束后 build 失败。** `preview` 只服务已有产物。先停止 dev，再执行 `pnpm build`，最后 `pnpm preview`。

**输出目录被拒绝。** 没有 `.cormi-build.json` 的旧 `dist`、或包含用户修改的目录不会被自动清空。换一个 `app.outDir`，或先自行保管旧产物。

**修改配置后没有热更新。** 这是预期行为。组件走 Fast Refresh；配置和 Node 插件变更会重启 worker。不要在 dev 运行期间手改 `.cormi` 下的生成文件。

下一步：[项目结构](/guide/project-structure)。
