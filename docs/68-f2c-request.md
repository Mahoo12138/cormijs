# cormi F2c：请求客户端与 useRequest

日期：2026-10-20。本切片交付 F2 的请求基础：显式启用的 `requestPlugin` 注册 `request` app-config key 和每挂载请求客户端；`useRequest` 支持自动/手动执行、loading/error/data、refresh、cancel、HTTP 错误与竞态保护。拦截器、统一错误协议、重试、轮询、分页和 Umi 全量 useRequest API 尚未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, requestPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'request', plugin: requestPlugin, options: { id: 'application:request' } },
  ],
  app: { base: '/request/' },
});
```

```tsx
// src/app.tsx
import { defineApp } from '@cormijs/runtime';

export default defineApp({
  request: {
    baseURL: '/api',
    headers: { 'x-application': 'cormi' },
    timeout: 5000,
  },
});
```

```tsx
// 页面
import { useRequest } from '@cormijs/runtime';

const { data, loading, error, run, refresh, cancel } = useRequest(
  (client, signal) => client.get<{ message: string }>('/hello', { signal, params: { q: 'one' } }),
  { manual: false },
);
```

`requestPlugin` 是普通原生 Cordis 插件：`inject: ['react']`，登记一个 `request` app-config key 和 runtime Provider；二者随 `ctx.effect` 撤回。未启用插件时，`useRequest`/`useRequestClient` 会明确失败，而不是回退到全局 fetch 单例。

## 2. 请求客户端

`createRequestClient(config)` 也可独立用于测试或非 React 代码：

| 配置 | 行为 |
| --- | --- |
| `baseURL` | 内部相对路径拼接；绝对 URL/协议相对 URL 原样使用 |
| `headers` | 默认头；单次请求头覆盖同名默认头 |
| `timeout` | 正数毫秒；通过 `AbortSignal.timeout` 与请求 signal 合并 |

单次请求支持 `params`（对象/数组序列化，跳过 `undefined`/`null`）、`headers`、`signal`、`method`、`body`。普通对象 body 自动 JSON 序列化并设置 `content-type`；字符串、FormData、URLSearchParams、Blob、ArrayBuffer 原样传递。

客户端暴露 `request/get/post/put/delete`。非 2xx 响应抛出 `RequestError`，包含 `status` 和已解析的 `data`；204 返回 undefined；JSON 响应按 content-type 解析，其余按文本返回。

## 3. useRequest 语义

- `manual: false`（默认）在挂载时自动执行一次；`manual: true` 仅由 `run()`/`refresh()` 触发；
- `loading` 在每次执行开始时为 true，完成/失败/取消后为 false；
- 成功写入 `data`，清除 `error`；失败写入 `error`，保留之前的 `data`；
- `cancel()` 中止当前请求并把 loading 置为 false，不写入 error；
- 再次执行会中止上一次请求；generation token 保证旧响应不能覆盖新响应；
- 卸载时中止在途请求并忽略迟到结果；
- `onSuccess`/`onError` 可选；取消不触发 `onError`；
- service 每次执行读取最新的函数引用，但自动执行只在挂载或 `manual` 改变时触发，不因 service 闭包变化自动重跑。

Provider 位于 Router 外、模型 Provider 外；模型 Hook 与路由组件都可以使用请求 Hook。请求 client 每个 `mountApplication` 独立创建，不使用模块级单例。

## 4. 与 Umi 4 的差异

参考 Umi 4.7.25 的 `packages/plugins/src/request.ts`、Max request 与 ahooks useRequest 集成：

| 方面 | Umi | cormi F2c |
| --- | --- | --- |
| 传输 | axios 与 useRequest 生态 | 浏览器 fetch 适配 |
| 拦截器/统一错误 | 支持 | 尚未交付 |
| dataField/错误协议 | 支持 | 尚未交付 |
| 自动/手动、取消、refresh | 支持 | 支持 |
| 重试/轮询/防抖/分页 | 支持 | 尚未交付 |
| 并发竞态 | 库内策略 | generation + abort，最后执行生效 |
| 请求配置 | runtime request config | app.tsx 的 request key，插件登记 |

本切片不承诺 Umi request/useRequest 的 API 或行为二进制兼容。

## 5. 限制

- 只提供 fetch 客户端；没有 axios 适配、拦截器链、统一错误协议或 dataField；
- 没有重试、轮询、debounce/throttle、分页/加载更多、依赖刷新等高级策略；
- 自动请求不使用 `service` 闭包变化作为依赖；
- 错误不自动重试；页面通过 `refresh` 或业务策略重试；
- 请求客户端不做 Node/SSR 传输或 cookie 策略抽象；
- `request` key 在运行前必须由插件登记；多个 request 插件贡献会因 key/hook 冲突失败。

## 6. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/request.test.ts`（client、params/body/headers、错误、超时、取消、插件卸载） | 2/2 |
| `tests/browser/request.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 462/462，0 失败/取消/跳过（F2b 为 460，新增 2 项；约 108 秒） |
| `pnpm test:browser` | 29/29，0 失败/取消/跳过（F2b 为 28，新增 request 用例；约 304 秒） |
| `pnpm test:package` | 157 阶段满足预期（F2b 为 149，新增 8 个 request 阶段） |
| `examples/request` prepare + typecheck | 退出 0 |

浏览器验收覆盖：自动请求与 refresh、baseURL/默认 header/params、手动请求、取消、HTTP 500 错误、连续执行时仅最后一次结果生效；开发与生产 preview 一致。独立打包消费覆盖请求插件公开类型、client/useRequest 类型、开发、构建与静态预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f2c-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 7. 下一步

- F2 基础链路已具备：初始状态 → 共享模型 → 请求；下一步补齐 access（U14）与 layout/menu（U15），进入 F3；
- request 后续能力：拦截器、统一错误协议、dataField、重试/轮询/分页；
- U10 后续：`@@initialState` 模型集成与首屏阻塞策略。
