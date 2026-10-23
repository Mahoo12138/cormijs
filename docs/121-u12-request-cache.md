# U12-3：GET 缓存与并发去重

日期：2026-10-22。本切片为请求客户端增加按请求的短缓存：同一 GET 在 `cacheTime` 内复用结果，并发的相同请求共享一个 Promise；`cacheBust` 跳过读取且不写缓存。缓存按 `mountApplication` 的客户端实例隔离。

## 1. 使用方式

```ts
const user = await client.get<User>('/api/me', { cacheTime: 5000 });
const [a, b] = await Promise.all([
  client.get<Config>('/api/config', { cacheTime: 60_000 }),
  client.get<Config>('/api/config', { cacheTime: 60_000 }),
]);
const fresh = await client.get<User>('/api/me', { cacheTime: 5000, cacheBust: true });
```

## 2. 契约与语义

- **范围**：仅 `GET` 且 `cacheTime > 0` 时启用；默认 0 表示完全关闭，行为与之前一致。`cacheTime` 允许 0–3600000ms。
- **键**：`method + 最终 URL（含 params）+ 已合并请求头`；请求头排序后参与键，连接配置的 `baseURL`/默认 headers 一并纳入。`body` 不参与 GET。
- **命中**：未过期直接返回已解析数据（不重新 fetch、不触发 onSuccess，因为不经过 useRequest）。过期条目删除后重新请求。
- **并发**：同键在途请求共享同一个 Promise；任一调用方中止 signal 会中止共享请求并让所有等待者失败（不复制 fetch）。
- **cacheBust**：跳过读取、不写入缓存、也不参与在途去重；用于显式刷新。
- **失败**：HTTP 错误/解析错误不写缓存、不共享结果；在途条目结束后清理。
- **生命周期**：缓存与在途表属于 `createRequestClient` 实例（`RequestProvider` 每次挂载创建），卸载/重建 Provider 后清空；不跨应用挂载或标签页共享。
- **校验**：非法 `cacheTime`/`cacheBust` 以 `REQUEST_INVALID` 失败。
- **无失效 API**：没有按 URL/标签失效、SWR、后台刷新或 stale-while-revalidate；需要新数据时使用 `cacheBust` 或等待过期。

## 3. 边界

- 不缓存 POST/PUT/DELETE；不缓存流式响应或非文本响应。
- 缓存键包含 Authorization 等请求头，但缓存本身只在当前客户端内存中，不落盘。
- 响应对象只保留解析后的数据；`Response.headers`/状态码不暴露给缓存命中。
- 没有容量上限/LRU 淘汰；过期条目只在同键访问时清理。
- `useRequest` 的 `refresh` 不会自动 `cacheBust`；需要新数据时在 service 中传 `cacheBust: true`。
- 与 `usePagination` 无集成；分页请求默认不缓存。

## 4. 与 Umi/ahooks 的差异

| 方面 | Umi/ahooks | cormi U12-3 |
| --- | --- | --- |
| 缓存 | 插件/生态 | 内置按请求 cacheTime |
| 并发去重 | 插件/生态 | 内置 |
| 失效 | 生态方案 | 仅 cacheBust/过期 |
| 容量控制 | 生态方案 | 未提供 |
| 持久化 | 生态方案 | 可选 session/local Web Storage（U12-9） |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | 两个并发 GET 仅一次请求；重复 GET 命中缓存；cacheBust 重新请求；既有重试/轮询/分页/取消用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u12-3-cache-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u12-3-cache-validation.json)。

## 6. 下一步

- U12 剩余：maxWait、跨标签页失效；持久化见 [U12-9](138-u12-cache-persistence.md)；
- U17 Antd/ProLayout、U09 依赖排序、U33 自动路径发现、F6。
