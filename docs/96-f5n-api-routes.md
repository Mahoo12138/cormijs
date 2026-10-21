# cormi F5n：生产 API 路由

日期：2026-10-21。本切片交付 U35 的第一个完整形态：`apiRoutePlugin` 把 `src/api/**` 的默认导出处理器注册为 HTTP 路由。开发期由 Vite 中间件直接调用；构建期用 esbuild 把处理器编译进输出目录；预览服务从编译产物提供服务。它与 `mockPlugin`（开发期 Mock）职责分离，不是 Mock 的生产开关。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { apiRoutePlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'api', plugin: apiRoutePlugin, options: { id: 'application:api', prefix: '/api' } }],
});
```

```ts
// src/api/health.ts → GET/POST /api/health
export default () => Response.json({ ok: true });
```

```ts
// src/api/users/[id].ts → GET /api/users/42
export default (request: Request, { params }: { params: Record<string, string> }) =>
  Response.json({ id: params.id, q: new URL(request.url).searchParams.get('q') });
```

```ts
// src/api/index.ts → /api
export default () => Response.json({ root: true });
```

处理器接收标准 Fetch `Request`，返回标准 `Response`；Node 请求体、查询参数与请求头都被转换后传入。`params` 是 `[name]` 段的解码值。

## 2. 契约与语义

- 插件：`cormi:api`，原生 Cordis 插件，`inject: ['vite']`；每个实例通过 `ctx.vite.add` 注册一个原生 Vite 插件，卸载时撤销；
- 选项：`id`（Vite 扩展 id）、`directory`（默认 `src/api`，项目内相对路径）、`prefix`（默认 `/api`，必须是 `/` 以外的绝对 URL 路径且不能以 `/` 结尾）；其他字段或非法 id/路径以 `API_INVALID` 失败；
- 文件映射：`<directory>/<path>.ts`（也接受 `.tsx/.js/.mjs`）映射到 `<prefix>/<path>`；`index` 映射到目录本身；`[name]` 捕获一个 URL 段，段数必须一致；静态段优先于动态段；下划线开头的文件/目录、`*.test.*`、`*.spec.*`、`*.d.*` 被忽略；
- 冲突：两个文件映射到同一 URL 形状（如 `users/[id].ts` 与 `users/[uid].ts`）以 `API_ROUTE_CONFLICT` 失败；非法段名以 `API_ROUTE_INVALID` 失败；
- 扫描：只读取项目内真实文件，跳过符号链接；最多 128 个文件、单文件 512 KiB；目录不存在表示没有路由；
- 开发：中间件在 Vite 内部中间件之前注册，处理器通过 `ssrLoadModule` 从源码加载；未匹配的 `<prefix>/*` 返回 JSON 404，`<prefix>` 之外的路径继续交给 Vite；新增/删除路由文件需要重启开发服务，处理器文件修改由 Vite 模块图管理；
- 构建：`closeBundle` 仅在真实构建时执行（开发/预览关闭 Vite 也会触发该钩子，已用 `config.command` 区分）；每个处理器用 esbuild 打包相对导入、外置裸包与 Node 内置模块，写入 `dist/.cormi/api/handlers/<n>.mjs`，并生成 `manifest.json`；编译失败以 `API_BUILD_FAILED` 失败并保留源文件信息；
- 预览：读取输出目录的 manifest 并动态导入处理器；`/.cormi/*` 一律 404，manifest 缺失以 `API_MANIFEST_MISSING` 使预览启动失败（要求用启用本插件的构建产物）；处理器路径做包含性校验；
- 错误：处理器抛错返回 `500 { error: 'API_HANDLER_FAILED' }`，细节只写服务端日志，不进入响应；未匹配路由返回 `404 { error: 'API_ROUTE_NOT_FOUND' }`；请求体超过 1 MiB 返回 413，响应超过 8 MiB 返回 500（均为缓冲后处理）；
- 方法：不做方法分派，处理器收到原始 `method`；HEAD 不写响应体；CORS、Cookie 签名、鉴权与流式响应由处理器或前置代理负责；
- 退出：插件卸载后 Vite 扩展消失；开发/预览会话关闭时中间件随服务器释放，无独立进程或端口。

## 3. 与 Umi 4 的差异

Umi 的 `apiRoute` 使用 Express 风格 `(req, res)` 处理器与约定的文件路由，在内置服务中运行；cormi 采用 Fetch `Request`/`Response`，只绑定现有 Vite 开发与预览服务，不另起生产服务器命令。

| 方面 | Umi 4 | cormi F5n |
| --- | --- | --- |
| 处理器签名 | Express `req/res` | Fetch `Request/Response` |
| 开发服务 | 内置服务 | Vite 中间件 |
| 生产运行 | Umi 服务 | `cormi preview` 读取编译产物 |
| 路由表 | 文件约定 | 文件约定 + `[param]` |
| 方法分派 | 框架/中间件 | 处理器自行判断 |
| 中间件链 | 支持 | 未提供 |

## 4. 限制

- 只在 `cormi dev` 与 `cormi preview` 中运行；没有独立的生产 Node 服务或部署编排；
- 新增/删除路由文件要重启开发服务；不支持热更新路由表；
- 不支持 catch-all、可选段、正则约束、方法命名导出或中间件链；
- 请求/响应整体缓冲，不支持流式上传/下载、WebSocket 与服务器推送；
- `prefix` 从服务器根计算，不叠加 `app.base`（反向代理可直接转发 `/api`）；
- 处理器依赖项目安装的包；预览进程需要能解析这些依赖；
- 没有内置鉴权、限流、CORS 或请求日志聚合。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/api-routes.test.ts`（映射/冲突/匹配、插件挂载/卸载/非法选项、dev 与 build+preview 的 JSON/动态参数/POST/404/500/`apiary` 边界） | 4/4 |
| `tests/browser/static-export.test.ts`（dev 与 preview 中 `/api/ping`） | 1/1 |
| `pnpm check` | 529/529，0 失败/取消/跳过（F5m 为 525，新增 4 项） |
| `pnpm test:browser` | 49/49，0 失败/取消/跳过 |
| `pnpm test:package` | 310 阶段通过（完整套件；static-export consumer 新增 API 路由 public types 与 dev/preview 断言） |

独立包消费断言：安装后的 `static-export` consumer 在 `types.mts` 中导入 `apiRoutePlugin`、`resolveApiRoutes`、`matchApiRoute` 与相关类型，并以 `@ts-expect-error` 校验非法 prefix；dev 与静态 preview 页面请求 `/api/ping` 均返回 `{ pong: true }`，页面与静态导出行为不变。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5n-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U35 后续：独立生产服务、中间件链、请求/响应流与更完整的路由语法；
- U32/U34：SSR、MPA；U25 externals/runtimePublicPath；
- U17 UI adapter；F6 多 builder 与微前端。
