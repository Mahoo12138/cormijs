# U12-4：缓存容量与按标签失效

日期：2026-10-22。本切片在 U12-3 GET 缓存上增加容量上限、命中 LRU 更新、缓存标签与 `invalidateCache`。缓存仍是每客户端实例的内存缓存。

## 1. 使用方式

```ts
// src/app.tsx
export default defineApp({ request: { baseURL: '/api', cacheLimit: 100 } });

// 请求
await client.get('/api/user', { cacheTime: 60_000, cacheTags: ['user', 'profile'] });
const removed = client.invalidateCache(['user']); // 删除含 user 标签的缓存
client.invalidateCache();                         // 清空全部
```

## 2. 契约与语义

- **cacheLimit**：`RequestConfig.cacheLimit` 为 1–10000 的整数，默认 100。写入新条目时先清理过期条目，再按插入顺序淘汰最旧条目直到低于上限。
- **LRU**：缓存命中会把条目移动到 Map 末尾，使容量淘汰按最近使用而非仅写入时间。
- **cacheTags**：请求选项，最多 16 个，每个 1–64 位 `[A-Za-z0-9:._-]`；只作为缓存元数据，不参与缓存键。重复标签保留。
- **invalidateCache(tags?)**：无参数或空数组清空全部缓存并返回删除数量；给定标签时删除任一标签匹配的条目。只影响已完成缓存，不取消在途请求，也不阻止其在完成后写入。
- **校验**：非法 `cacheLimit`/`cacheTags` 以 `REQUEST_INVALID` 失败；`invalidateCache` 的非字符串标签同样失败。
- **sitemap/SSR 无关**：这是浏览器请求客户端能力，服务端渲染不共享缓存。

## 3. 边界

- 没有 TTL 后台清理；过期条目在写入或同键访问时清理。
- 标签没有层级/通配符；`user` 不会匹配 `user:1`。
- 没有持久化、跨标签页或跨挂载共享；`RequestProvider` 重建即清空。
- 在途请求完成后仍可能重新写入刚被失效的键；需要严格顺序时先取消请求。
- 无缓存命中统计或调试接口。

## 4. 与 Umi/ahooks 的差异

| 方面 | Umi/ahooks | cormi U12-4 |
| --- | --- | --- |
| 容量 | 生态方案 | cacheLimit + LRU |
| 失效 | 生态方案/手动 | invalidateCache(tags) |
| 过期清理 | 定时/访问 | 访问/写入时清理 |
| 持久化 | 生态方案 | 未提供 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | 标签缓存命中、invalidateCache 后重新请求、cacheLimit=1 淘汰最旧、既有缓存/分页/轮询用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u12-4-cache-tags-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u12-4-cache-tags-validation.json)。

## 6. 下一步

- U17 Antd/ProLayout、U12 防抖节流/游标分页；
- U16 请求 locale/RTL 样式、U33 每页关闭/并发/增量、SSR 生产化与 F6。
