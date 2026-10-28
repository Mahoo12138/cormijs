# Mock、API 与代理

三者的职责不同：

| 能力 | 运行阶段 | 用途 |
| --- | --- | --- |
| Mock | 仅开发 | 用文件模拟接口，支持热重载 |
| API 路由 | 开发 + 预览 | 用 Fetch 处理器提供真实 HTTP 接口 |
| 代理 | 开发 + 预览 | 把路径前缀转发到真实后端 |

构建产物本身不包含 Mock 或代理。API 路由会在构建时编译到 `dist/.cormi/api`。

## 开发期 Mock

```ts
import { mockPlugin } from '@cormijs/plugin-dev-api'
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite'

plugins: [
  { id: 'dev-api', plugin: devApiVitePlugin },
  { id: 'mock', plugin: mockPlugin, options: { intervalMs: 200 } },
]
```

```ts
// mock/users.ts
export default {
  'GET /api/users': { body: { users: ['Ada'] } },

  'POST /api/echo': request => ({
    status: 201,
    body: {
      method: request.method,
      query: Object.fromEntries(request.query),
      body: request.body,
    },
  }),
}
```

- key 格式是 `METHOD /path`，方法支持 `GET`、`HEAD`、`POST`、`PUT`、`PATCH`、`DELETE`、`OPTIONS`。
- 路径可以带 `/api` 前缀，也可以只写 `/users`；注册时会去掉配置的 prefix。
- 值可以是 `{ status?, headers?, body? }`，或返回该对象的函数。
- 函数参数是 `MockRequest`：`{ method, path, query, body, signal }`。
- 默认扫描 `mock/**`，可用 `dir` 或 `files` 覆盖。
- 默认 prefix 为 `/api`，可用 `prefix` 覆盖。
- 默认每 200ms 检查文件变化，可配置 50–5000ms。

开发期文件变化会重新编译并替换规则；新文件无效时保留上一组规则，不终止开发服务器。生产预览不提供 Mock。

Mock 是可执行的开发代码，拥有 Node 能力，**不是安全沙箱**。

## API 路由

```ts
import { apiRoutePlugin } from '@cormijs/plugin-react-vite'

plugins: [{
  id: 'api',
  plugin: apiRoutePlugin,
  options: { id: 'application:api', prefix: '/api' },
}]
```

```ts
// src/api/health.ts → /api/health
export default () => Response.json({ ok: true })
```

```ts
// src/api/users/[id].ts → /api/users/42
import type { ApiHandlerContext } from '@cormijs/plugin-react-vite'

export default (request: Request, { params }: ApiHandlerContext) =>
  Response.json({
    id: params.id,
    q: new URL(request.url).searchParams.get('q'),
  })
```

```ts
// src/api/index.ts → /api
export default () => Response.json({ root: true })
```

规则：

- `src/api/<path>.ts` 映射到 `<prefix>/<path>`；`index` 映射到目录本身。
- `[name]` 捕获一个 URL 段；静态段优先于动态段。
- 支持 `.ts`、`.tsx`、`.js`、`.mjs`。
- 下划线开头的文件/目录、`*.test.*`、`*.spec.*`、`*.d.*` 被忽略。
- 两个文件映射到同一 URL 形状会以 `API_ROUTE_CONFLICT` 失败。
- 处理器接收标准 Fetch `Request`，返回标准 `Response`；method 由处理器自行判断。
- `HEAD` 不写响应体。
- 未匹配的 `<prefix>/*` 返回 JSON 404。
- 处理器抛错返回 `500 { error: 'API_HANDLER_FAILED' }`，堆栈只写服务端日志。
- 请求体上限 1 MiB，响应上限 8 MiB。
- 开发与预览都可用；新增/删除路由文件需要重启开发服务，修改处理器由 Vite 模块图处理。

`prefix` 从服务器根计算，不叠加 `app.base`。部署时可以单独把 `/api` 转发给后端或 Node 服务。

## 代理

```ts
import { proxyPlugin } from '@cormijs/plugin-react-vite'

plugins: [{
  id: 'proxy',
  plugin: proxyPlugin,
  options: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/ws': { target: 'https://backend.example.test', ws: true },
    },
  },
}]
```

- 1–32 个前缀；前缀必须以 `/` 开头，不能是 `//`，不能包含 `..`、反斜杠或 NUL。
- 目标必须是 http(s) URL，不能内嵌凭据。
- 支持 `changeOrigin`、`secure`、`ws`。
- 插件条目覆盖 Vite 现有同名前缀，其他配置保留。
- 开发与预览都生效；构建产物不包含代理，生产部署仍需网关。

不支持 `rewrite` 函数、自定义 headers 或代理事件。

## 生成器

```sh
cormi generate api health
cormi generate mock health
```

分别生成 `src/api/health.ts` 和 `mock/health.ts` 骨架，不会注册路由、安装依赖或修改配置。

## 典型组合

```ts
plugins: [
  { id: 'dev-api', plugin: devApiVitePlugin },
  { id: 'mock', plugin: mockPlugin, options: { prefix: '/api' } },
  { id: 'api', plugin: apiRoutePlugin, options: { prefix: '/api' } },
  { id: 'proxy', plugin: proxyPlugin, options: { proxy: { '/backend': 'http://127.0.0.1:8080' } } },
]
```

- 开发时页面请求 `/api/*`，优先命中 Mock。
- 需要真实接口时移除 Mock 或改用 `/backend/*` 代理。
- 同一路径同时启用 Mock 与代理会由中间件顺序决定，应用应避免这种重叠。

## 限制

- Mock 没有 `req/res` 写入式响应、录制回放或安全隔离。
- API 路由没有中间件链、catch-all、可选段、方法命名导出或流式上传/下载。
- API 路由只存在于 `cormi dev` 与 `cormi preview`；没有独立生产 Node 服务。
- 代理不支持 rewrite/headers；生产环境需要自己配置网关。
- 三者都不是后端鉴权方案；鉴权、限流、CORS 需要在处理器或网关中实现。

下一步：[构建与部署](/guide/build)。
