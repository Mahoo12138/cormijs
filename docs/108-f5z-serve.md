# cormi F5z：独立生产服务 `cormi serve`

日期：2026-10-21。本切片补齐 U32 的独立 server 命令：应用启用 `servePlugin` 后，`cormi serve` 读取已完成构建的静态产物与 SSR bundle，启动原生 Node HTTP 服务，对导航请求执行服务端渲染、对其余请求提供 `dist` 静态文件。它不启动 Vite，也不执行 API 路由、代理或 Mock。

## 1. 使用方式

```ts
import { servePlugin, ssrPlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'ssr', plugin: ssrPlugin, options: { id: 'application:ssr' } },
    { id: 'serve', plugin: servePlugin, options: { id: 'application:serve', host: '127.0.0.1', port: 4173, base: '/' } },
  ],
  app: { ssr: true },
});
```

```sh
cormi build
cormi serve
```

服务只从 `dist`（可配置 `outDir`）提供资源；`dist/.cormi/ssr/ssr.mjs` 缺失时以 `SERVE_BUILD_MISSING` 失败。

## 2. 契约与语义

- 插件：`cormi:serve`，`inject: ['commands', 'projectRoot']`；注册 `serve` 命令，未挂载时命令不存在；
- 选项：`id`、`mountId`（默认 root）、`host`（默认 127.0.0.1）、`port`（默认 4173，0 允许）、`outDir`（默认 dist，项目内相对路径）、`base`（默认 `/`，需与 `app.base` 一致）；
- 构建前置：必须有 `index.html` 与 SSR bundle；否则启动失败；
- 导航：`Accept: text/html` 的 GET/HEAD 进入 SSR，注入服务端标记与 hydration script；SSR 抛错时回退到已构建的 CSR 外壳；
- 静态：其余 GET/HEAD 按 URL 映射到输出目录，限制在真实输出目录内（拒绝 `..`、NUL 与 symlink 逃逸），按扩展名设置 content-type，未命中 404；不列目录；非 GET/HEAD 405；
- base：请求必须位于 `base` 前缀；前缀外导航 302 到 base；静态路径剥离前缀后映射到输出根；服务 URL 带 base；
- 关闭：命令 handle 关闭 HTTP server 并断开连接；无 Vite 会话、无 watcher；
- 错误码：`SERVE_INVALID`（选项）、`SERVE_BUILD_MISSING`、`SERVE_BUILD_INVALID`、`SERVE_FAILED`。

## 3. 与 Umi 4 的差异

Umi 的 `umi serve` 是内建服务，通常与 MPA/API/proxy 集成；cormi 的 serve 是无框架依赖的静态 + SSR 服务，API、Mock 与代理仍需独立网关或 preview。

| 方面 | Umi 4 | cormi F5z |
| --- | --- | --- |
| 命令 | 内建 serve | 可选 servePlugin |
| SSR | 支持 | 读取 SSR bundle |
| 静态资产 | 内建 | dist 白名单式提供 |
| API/proxy | 可组合 | 不执行 |
| 压缩/流式/TLS | 依服务 | 未提供 |

## 4. 限制

- 只服务已构建产物，不支持开发热更新或按需编译；
- 不执行 `src/api/**` 编译处理器、Mock、代理或 MPA 中间件；
- 无 gzip/brotli、Range、ETag、缓存策略、TLS、HTTP/2 或流式 SSR；
- 无集群/优雅停机信号处理或进程守护；
- base 路径不被重写为 Vite 资源路径；应用需与 `app.base` 一致；
- 目录索引只返回 404，不自动列出文件。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/browser/ssr.test.ts`（dev、preview 与 serve 的服务端标记、loader 数据、hydration 无 pageerror） | 1/1 |
| `pnpm check` | 544/544，0 失败/取消/跳过（本切片无新增 Node 用例） |
| `pnpm test:browser` | 52/52，0 失败/取消/跳过（无新增文件） |
| `pnpm test:package` | 328 阶段通过（完整套件；ssr consumer 新增 serve 会话与服务端渲染断言） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5z-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U32 后续：serverLoader、流式渲染、SSR head 收集与按路由拆包；
- U17 UI adapter、F6 多 builder/微前端、U16 Antd/dayjs；
- U25 runtimePublicPath 受 Vite chunk 导入限制未交付。
