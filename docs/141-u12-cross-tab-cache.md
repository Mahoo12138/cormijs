# U12-12：跨标签页缓存失效

日期：2026-10-22。本切片为持久化缓存增加跨标签页失效：一个标签页执行 `invalidateCache` 实际删除条目后，其他同源标签页通过 `storage` 事件清空本地内存缓存，避免继续使用已失效数据。

## 1. 使用方式

```ts
export default defineApp({
  request: {
    baseURL: '/api',
    cachePersist: 'local',          // 跨标签页需要 localStorage；sessionStorage 每标签页独立
    cachePersistKey: 'demo:request-cache',
  },
});

// 任意标签页
client.invalidateCache(['config']);
```

## 2. 契约与语义

- 仅在 `cachePersist` 启用时监听 `storage` 事件；`sessionStorage` 不跨标签页，因此实际跨标签页场景应使用 `local`。
- 持久化载荷增加 `epoch` 计数。`invalidateCache` **实际删除至少一个条目**时 `epoch++` 并写回存储；其他标签页收到同一 storage key 的事件后，发现 epoch 变化即清空自己的内存缓存。
- 接收端不清空持久化载荷、不回写存储，因此不会形成事件回环；后续请求按正常流程重新取数并写缓存。
- 其他标签页的普通缓存写入（epoch 不变）不会同步数据，避免覆盖本页更新的响应；跨标签页只传播失效，不做数据复制。
- 其他标签页调用 `storage.clear()`/`removeItem(key)` 时清空本地缓存并重置 epoch；载荷损坏/版本不符时同样保守清空。
- `RequestProvider` 在挂载时 `activate()`、卸载时 `dispose()`；StrictMode 的 effect 重放会重新挂载监听。直接使用 `createRequestClient` 的长生命周期客户端默认已激活，需要自行在销毁时调用 `dispose()`。
- 未删除任何条目的 `invalidateCache` 不写存储、不广播；如果本页没有匹配条目，其他标签页可能保留自己的条目。
- 只支持同源；不处理 `BroadcastChannel`、跨源 iframe 或 Service Worker。

## 3. 边界

- 跨标签页失效是**保守清空**：不按 tag 精确同步，接收端会丢弃全部内存缓存条目。
- 不做数据同步、冲突合并或最后写入胜出；不同标签页仍可有不同的在途响应。
- 事件时机取决于浏览器 `storage` 事件调度；后台标签页可能延迟处理。
- 不传播 `cacheBust`、普通写入或过期删除；只有 `invalidateCache` 的实际删除会递增 epoch。
- 持久化本身仍要求 JSON 数据、无加密，且不要存放敏感响应。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | 标签页 A 写入 `localStorage` 缓存；标签页 B 读取后不请求；B 执行 `invalidateCache` 后 A 重新请求并得到新数据 |
| 安装包 `request` consumer | 公共类型包含 `activate`/`dispose` 与持久化选项 |
| `pnpm check` | 570/570 |
| `pnpm test:browser` | 54/54 |
| `pnpm test:package` | 344 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u12-12-cross-tab-cache-validation.json)。

## 5. 下一步

- U12 已覆盖路线列出的请求能力；可扩展自定义节流键/跨组件共享，但不作为当前阻断项；
- U17 图表/主题编辑器、F6、U09 热替换、U16 请求 locale、SSR 生产化、U33 sitemap lastmod/压缩。
