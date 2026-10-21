# U12-5：useRequest debounce

日期：2026-10-22。本切片为 `useRequest` 增加 `debounceWait`：连续 `run`/`refresh` 在窗口内合并为一次请求；轮询通过内部执行器绕过防抖，保持固定节奏。分页/缓存等既有能力不变。

## 1. 使用方式

```tsx
const { data, loading, run } = useRequest(
  (client, signal) => client.get('/api/search', { signal, params: { q } }),
  { manual: true, debounceWait: 300 },
);
<button onClick={() => void run()}>Search</button>
```

## 2. 契约与语义

- **范围**：`debounceWait` 为 0–60000ms 整数，0 表示关闭。作用于手动 `run`/`refresh`、初始自动请求与 `refreshDeps` 触发的重新执行。
- **合并**：窗口内新的调用清除旧计时器；被清除调用的 Promise 立即以 `undefined` 解析，只有最后一次调用在窗口结束后执行 service。
- **结果**：防抖调用的 Promise 在真正请求完成后解析为数据（失败为 undefined）；调用方可以 `await run()`，但中间被合并的调用不会发出请求。
- **轮询**：`pollingInterval` 的 tick 直接调用内部执行器，不经过防抖；防抖不会拉长轮询周期。重试仍作用于每次实际请求。
- **取消/卸载**：`cancel()` 与卸载会清除待执行计时器并解析其 Promise；在途请求仍按既有逻辑中止。
- **错误**：不会因被合并而调用 onError；只有实际执行的最终失败才写入 error/onError。
- **校验**：非法 `debounceWait` 以 `REQUEST_INVALID` 失败。

## 3. 边界

- 不提供 `debounceLeading`、`maxWait`、基于依赖值的自动防抖或 throttle。
- 防抖只是客户端延迟，不合并已经在途的请求；每次实际执行仍会中止上一请求。
- 被合并调用的 Promise 解析为 undefined，不暴露“被丢弃”的错误。
- 轮询与防抖同时配置时，轮询不受防抖影响（文档化的差异）。
- 没有服务端去重；缓存/去重见 U12-3/U12-4。

## 4. 与 ahooks/Umi 的差异

| 方面 | ahooks useRequest | cormi U12-5 |
| --- | --- | --- |
| debounce | 插件 | 内置 debounceWait |
| leading/maxWait | 支持 | 未提供 |
| 轮询交互 | 插件配置 | 轮询绕过防抖 |
| throttle | 插件 | 未提供 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | 快速两次 `run()` 只发一次请求（debounceWait=120），既有重试/轮询/分页/缓存用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u12-5-debounce-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u12-5-debounce-validation.json)。

## 6. 下一步

- U12 剩余：throttle、游标分页、缓存持久化；
- U17 ProLayout/图表、F6、U33 每页关闭/并发/增量、U16 请求 locale、SSR 生产化。
