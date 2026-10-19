# cormi：插件作者项目与独立交付

日期：2026-10-19。本文描述 P8 的创建和交付协议，最终验证结果另见本轮结果记录。目标是让作者用普通 TypeScript、原生 Cordis 插件和明确的浏览器 exports 完成开发，不是新增插件市场、第二套插件加载器或 Admin 产品功能。

## 1. 创建一个插件工作区

现有 `create-cormi` 增加 `plugin-react` 模板；`react` 和 `react-api` 应用模板保持原入口。创建器仍只读 kit 并写入新目录，不安装依赖、不初始化 Git、不执行用户代码、不请求注册表。插件模板允许 `@example/hello` 这样的作用域包名，总长度（包含 @ 与 /）不超过100字符，为生成的贡献ID保留长度预算；不允许占用 cormijs 或 @cormijs 的框架名称。这是当前模板的显式限制，不是 npm 包名的完整语法定义。

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm pack:local --out /absolute/path/to/new-kit
pnpm create:app /absolute/path/to/new-plugin \
  --kit /absolute/path/to/new-kit \
  --template plugin-react --name @example/hello
```

两个目标目录都必须不存在。包尚未公开发布，因此 kit 仍是明确必需输入，不能将此流程包装成公共 registry 上已经可用的 npm create。已有 `createProject({ directory, kit, template: 'plugin-react', name })` API 使用相同校验。

进入新插件目录后执行：

```sh
pnpm install --ignore-scripts
pnpm build
pnpm dev
```

默认联调地址为 `127.0.0.1:8003/workbench/plugin`。端口可在生成的 `cormi.config.ts` 中修改。先 build 是为了建立 package exports 引用的声明文件；普通 TSX 组件编辑直接读取源码，不需要每次手工打包。公开导出或类型接口变化后，应重新 build 更新声明。

## 2. 一个作者项目，两种输出

| 位置 | 职责 |
| --- | --- |
| src/index.ts | 原生 Cordis Node 插件，校验 options、组合子插件 |
| src/api.ts | 独立开发 API 贡献者，只依赖 devApi 服务 |
| src/client.tsx、src/context.ts | 浏览器 RuntimePlugin、根 Provider 与公开上下文 |
| src/page.tsx | 插件提供的示例路由页面 |
| src/page.module.css、src/assets/、src/assets.d.ts | 插件样式、图片及静态资源类型声明 |
| playground/Home.tsx、cormi.config.ts、index.html | 作者联调应用，不进入插件分发包 |
| dist/ | 插件库的 JavaScript、声明、source map 和保持相对布局的 CSS/静态资源 |
| app-dist/ | 联调应用的静态构建结果，与库 dist 分离 |
| scripts/pack.mjs | 显式调用的本地打包器，不是安装脚本 |
| PACKAGE.md | 面向消费者的说明，打包时作为 README.md |
| .cormi-local/ | 本地框架归档及 Cordis 声明补丁，不进入插件 tgz |

包 exports 明确分开根入口、`/api`、`/client`、`/page`，types 条件位于 import 前。Node 根入口不会被应用浏览器直接 import；浏览器的 client/page 不反向引用 core、Node API、Vite 或用户配置。所有框架运行依赖作为明确 peer 提供，插件开发工具放在 devDependencies；Vite 仅属于作者联调应用，不是插件的运行 peer。

## 3. 原生插件如何组合能力

生成插件的 `Config` 遵循当前 Cordis 的同步 Standard Schema 协议，对 development、label、apiBase 做校验；没有新增第三方 schema 运行依赖。耗时 I/O 不应进入同步 Config。实际 apply 注入 react，通过 `ctx.plugin(defineReactFeature(...))` 添加页面和 runtime，只有 development=true 才挂载 API 子插件。

`src/api.ts` 通过 `ctx.devApi.add()` 登记 `/hello`，资源绑定到调用者作用域，正常卸载自动撤回，不额外复制一套 disposer 注册器。整个功能插件禁用时，路由、Provider 和 API 同时随原生子插件关系撤销。开发 API provider 由应用选择和配置；功能插件不偷偷安装一个全局 provider，也不依赖 Vite 实例。

前端示例通过 Provider 取得 label/apiBase/development。只有这些明确公开数据进入 runtime；服务端配置、handler 和 Node 对象不会被序列化。示例请求支持 AbortController，重复请求替换前一个，组件卸载取消请求，只允许当前未取消请求更新结果。这不是通用生产 HTTP 客户端、鉴权方案或第三方插件沙箱。

默认贡献 ID 与 `/plugin` 路由只适合一个实例。要同时启用多个实例，作者应设计实例 ID、路径和 provider 隔离，不能仅改变最外层配置 id 就宣称多实例完成。

## 4. 源码联调与发布入口分开

作者配置静态导入 `./src/index.js`（由已有配置编译器解析 TypeScript 源文件），因此 Node 插件和静态传递依赖变更由 supervisor 触发 worker 重启。不存在借助缓存 URL 假装传递模块已经刷新。

浏览器开发使用一个只属于作者项目的原生 Cordis/Vite 桥接，将具体包的 `/client`、`/page` 裸入口映射到源 TSX。它没有修改公开 exports，没有为所有消费者硬编码作者目录，更没有把源码桥接加入 cormi core。普通页面组件采用已有 React Fast Refresh；运行时模块边界或结构改变仍按框架规则刷新，Node 编辑不承诺保留 React state。

```sh
# 先停止 dev，再逐项检查；同一项目仍由 CLI 独占锁保护
pnpm typecheck
pnpm check:app
pnpm diagnose --for dev
pnpm build:app
pnpm preview
```

库 typecheck 与应用 check:app 是不同范围。diagnose 只观察新 worker 的插件/服务，不执行目标命令；具体边界见 [诊断协议](39-plugin-diagnostics.md)。

## 5. 从当前源码打包，而不是把旧 dist 装进包

`pnpm pack:plugin` 先要求没有活跃 cormi 会话，再检查 src 的普通文件、链接、路径、文件数、深度及大小预算。点文件、符号链接、硬链接和未知资源扩展会拒绝；P9 已增加 CSS、常见图片/字体和 d.ts 的明确资源白名单及受管复制，详见 [插件资源协议](43-plugin-assets.md)。

打包器在独立 `.cormi-package-*` 内创建 src 快照，使用作者安装的 TypeScript 严格编译到全新 dist，强制 noCheck=false、skipLibCheck=false、noEmitOnError=true。不会从开发过程中积累的旧 dist 复制残留模块，也不会清空作者已有 dist。每次成功包位于新的 `artifacts/plugin-*` 中，前次归档不覆盖。

分发清单移除作者 scripts、devDependencies、pnpm overrides 和本地 file/link/workspace 引用，保留独立 exports、运行依赖和 peer 声明。source map 对应的 src 一并交付；CSS sideEffects 声明保留，资源按源目录布局进入 dist。PACKAGE.md 作为包 README，存在的 LICENSE/NOTICE 原字节保存；没有替作者选择许可证。默认 private:true，未执行 publish、postinstall 或 prepare。

只清理成功操作自己的 stage，失败保留中间输入供检查。该工具针对可信作者目录和明确本地命令，不承诺敌对同用户文件系统修改下的事务、任意编译器插件隔离或字节级可复现 tarball。开始时的锁检查用于拒绝已有会话，不是与之后新建会话之间的原子互斥。

## 6. 安装到另一个应用

将生成 tgz 复制到目标应用自己的本地目录，再显式安装，目标应具备当前 cormi preset/runtime 与必要 peers。不能直接使用作者源码路径或 workspace 链接替代分发验收。

```ts
import { defineConfig } from 'cormijs';
import reactVite from '@cormijs/preset-react-vite';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';
import feature from '@example/hello';

export default defineConfig(({ command }) => ({
  presets: [reactVite],
  plugins: [
    { id: 'development-api', plugin: devApiVitePlugin,
      options: { prefix: '/customer/api' }, enabled: command === 'dev' },
    { id: 'my-feature', plugin: feature,
      options: { development: command === 'dev', label: 'My plugin', apiBase: '/customer/api' } },
  ],
  app: { base: '/customer/' },
}));
```

apiBase 是明确的 API 命名空间，不由插件猜测 app.base；它应与选用传输的 prefix 一致。生产仍保留插件页面和 Provider，但不挂载开发 API 子插件或中间件。生产后端由应用另行提供，preview 不冒充 Mock 服务器。

消费者仍需自己的 Cordis RC.11 声明补丁配置。根 pnpm patchedDependencies 不会通过插件 peer 自动传播；模板 .cormi-local 只解决作者安装，插件 tgz 不携带另一套框架或偷偷修补用户依赖。

## 7. 生态依据与验证入口

本轮继续阅读固定 [Koishi WebUI status 入口](../references/koishi-webui/plugins/status/src/index.ts) 及其 [分发元数据](../references/koishi-webui/plugins/status/package.json)，借鉴原生子插件和 Node/client 入口分离，不搬运其实现。当前 cormi 的 React 生成清单、同步 schema 与 dev/prod 策略由已有公开协议决定；Koishi Cordis3 与 cormi Cordis4 不视为直接兼容。更完整的版本与许可记录见 [生态参考](37-cordis-ecosystem.md)。

仓库新增 `pnpm test:plugin`：实际打包创建器，创建外部作者项目，验证库/应用类型、源码 HMR、Node 重启、整体禁用、真实插件 tgz、旧 dist 排除、私有输入拒绝、消费者重定位后冻结重装、开发与生产行为。它和原 `pnpm test:package` 分开计数；浏览器使用已有 Playwright 和独立无头上下文，不读取个人资料。

默认静态资源采用显式 import 与 CSS url()，消费应用负责实际资源变换；不承诺包内任意 new URL(import.meta.url) 在依赖预构建后仍指向原目录。这不是插件市场、任意旧生态插件兼容、任意资源打包或 Windows 支持。下一步以真实作者反馈和可复现问题继续缩减配置摩擦，而不是为填满功能列表扩张新宿主。
