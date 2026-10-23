# U12-9：GET 缓存持久化

日期：2026-10-22。本切片为请求客户端增加可选 Web Storage 持久化：`cacheTime` 内的 GET 缓存可在刷新后继续命中，标签失效与 LRU 淘汰同步更新存储。

## 1. 使用方式

```ts
export default defineApp({
  request: {
    baseURL: '/api',
    cacheLimit: 20,
    cachePersist: 'session',            // 或 'local'
    cachePersistKey: 'demo:request-cache',
  },
});
```

也可直接使用 `createRequestClient`：

```ts
const client = createRequestClient({ baseURL: '/api', cachePersist: 'session' });
await client.get('/config', { cacheTime: 60_000, cacheTags: ['config'] });
client.invalidateCache(['config']); // 同时清理 sessionStorage 中的条目
```

## 2. 契约与语义

- `cachePersist` 取 `'session'`（sessionStorage）或 `'local'`（localStorage）；不设置则只保存在内存。
- `cachePersistKey` 默认 `cormi:request-cache`，1–128 字符、不含控制字符；未启用 `cachePersist` 时设置它会在客户端创建时以 `REQUEST_INVALID` 失败。
- 只有同时满足 `GET`、`cacheTime > 0`、非 `cacheBust` 的成功响应会写入缓存；键仍包含完整 URL 与排序后的请求头。
- 持久化格式为版本化 JSON `{version:1, entries:[{key,expires,value,tags}]}`；加载时过滤过期、非法键/标签/时间戳与版本不符的数据，损坏数据静默忽略。
- `cacheLimit` 同时约束加载与新增；加载按存储顺序保留最近条目，超过上限淘汰最旧。命中时的内存 LRU 重排不立即写回，存储顺序在下一次写入/失效时更新。
- `invalidateCache(tags?)` 删除内存条目后立即重写存储；无删除时不写。
- 仅浏览器生效；SSR 或存储被策略禁用时按普通内存缓存运行，不抛错。写入遇到配额/隐私限制时静默放弃，内存缓存仍有效。
- 响应数据必须是 JSON 可序列化值；解析后的 JSON/纯文本可直接持久化，自定义对象不会保留原型或类型。

## 3. 边界

- 不加密、不签名；Web Storage 可被同源脚本读取，**不要持久化敏感响应**。跨标签页失效见 [U12-12](141-u12-cross-tab-cache.md)，不复制数据。
- 不持久化非 GET、`cacheBust`、失败响应或在途请求；也不持久化去重任务本身。
- 没有容量估算/压缩；单个存储载荷超过 5 MB 时加载直接忽略，写入仅依赖浏览器配额。
- 切换 `cachePersistKey` 或关闭持久化不会删除旧键；需要应用自行清理。
- 过期条目在加载时过滤，但不会主动从存储中删除，直到下一次缓存写入/失效覆盖。
- 不改变 `useRequest`、分页、标签失效与 LRU 的既有语义。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/request.test.ts` | 非法 `cachePersist`/`cachePersistKey` 组合 |
| `tests/browser/request.test.ts` | dev/build/preview：首次请求后刷新仍命中 sessionStorage；`invalidateCache` 后重新请求 |
| 安装包 `request` consumer | 公共类型包含 `cachePersist`/`cachePersistKey`，既有 dev/preview 验收保持 |
| `pnpm check` | 570/570 |
| `pnpm test:browser` | 54/54 |
| `pnpm test:package` | 344 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u12-9-cache-persistence-validation.json)。

## 5. 下一步

- U12 剩余：自定义节流键/跨组件共享（扩展项）；
- U17 图表/主题编辑器、F6、U09 热替换、U16 请求 locale、SSR 生产化、U33 sitemap lastmod/压缩。
