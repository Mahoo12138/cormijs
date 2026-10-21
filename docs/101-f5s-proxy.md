# cormi F5s：开发与预览代理

日期：2026-10-21。本切片补齐 U18 的代理配置：`proxyPlugin` 把路径前缀映射到上游 http(s) 服务，并同时合并进 Vite 的开发与预览服务器。Mock 仍是开发期数据约定，代理面向真实后端联调。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { proxyPlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [{
    id: 'proxy',
    plugin: proxyPlugin,
    options: {
      proxy: {
        '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
        '/ws': { target: 'https://backend.example.test', ws: true },
      },
    },
  }],
});
```

开发与预览中 `/api/**` 与 `/ws` 请求转发到上游；未匹配的路径仍由前端服务处理。

## 2. 契约与语义

- 插件：`cormi:proxy`，`inject: ['vite']`；每个实例通过 `ctx.vite.add` 注册；
- 选项：`id` 与必填 `proxy`；1–32 个条目；
- 前缀：必须以 `/` 开头、不得以 `//` 开头、不得包含 `..`/反斜杠/NUL，长度 ≤256；
- 目标：字符串或 `{ target, changeOrigin?, secure?, ws? }`；`target` 必须是 http/https URL、≤1024 字符、不得内嵌用户名/密码；布尔选项类型受校验；
- 合并：插件的条目覆盖 Vite 现有 `server.proxy`/`preview.proxy` 中的同名前缀，其他前缀保留；
- 运行：开发与预览都使用 Vite 原生代理；构建产物不包含代理逻辑，生产部署仍需网关反向代理；
- 错误：任何非法输入在插件激活时以 `PROXY_INVALID` 失败；
- 退出：卸载插件后 Vite 扩展与代理配置随会话移除。

## 3. 与 Umi 4 的差异

Umi 的 `proxy` 直接透传 http-proxy 配置（含 rewrite 函数、headers 等）；cormi 只接受可序列化的安全子集，并由 Vite 承担实现。

| 方面 | Umi 4 | cormi F5s |
| --- | --- | --- |
| 配置位置 | config.proxy | proxyPlugin 选项 |
| 实现 | webpack-dev-server/http-proxy | Vite proxy |
| 预览 | 视服务 | 支持 |
| rewrite/headers | 支持函数/对象 | 未提供 |
| 生产部署 | 需网关 | 需网关 |

## 4. 限制

- 不支持 `rewrite` 函数、自定义 headers、代理事件或 WebSocket 之外的协议扩展；
- 不读取环境变量自动生成目标；配置值需在 Node 配置求值时可序列化；
- 预览代理只在 `cormi preview` 中存在，静态托管产物本身没有代理；
- 不处理鉴权、Cookie 重写、限流或 TLS 客户端证书；
- 目标凭据被拒绝，避免把秘密写进配置；
- 与 Mock 同时匹配时，Vite 中间件顺序决定结果；应用应避免同一路径同时启用 Mock 与代理。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/proxy.test.ts`（校验、插件装卸、本地上游在 dev 与 preview 的转发与 `changeOrigin`） | 3/3 |
| `pnpm check` | 538/538，0 失败/取消/跳过（F5r 为 535，新增 3 项） |
| `pnpm test:browser` | 51/51，0 失败/取消/跳过（无新增浏览器用例） |
| `pnpm test:package` | 320 阶段通过（完整套件；static-export consumer 新增代理公共类型断言，无新增阶段） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5s-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U18 后续：req/res 兼容层与统一代理配置入口；
- U32：SSR；U25 externals/runtimePublicPath 受 Vite chunk 限制未交付；
- U16 Antd/dayjs 联动；U17 UI adapter；F6 多 builder 与微前端。
