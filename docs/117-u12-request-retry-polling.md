# U12-1：useRequest 重试、轮询与 refreshDeps

日期：2026-10-22。本切片补齐 `useRequest` 的常用自动化能力：失败重试、成功后轮询与依赖刷新；保留既有自动/手动、loading/error、取消与竞态保护语义。分页/加载更多仍未交付。

## 1. 使用方式

```tsx
const { data, loading, error, refresh, cancel } = useRequest(
  (client, signal) => client.get('/api/todos', { signal, params: { page } }),
  {
    retry: 2,
    retryDelay: attempt => attempt * 200,
    pollingInterval: 5000,
    pollingWhenHidden: false,
    refreshDeps: [page],
  },
);
```

## 2. 契约与语义

- **重试**：`retry` 为首次失败后的额外尝试次数（0–10，默认 0）。每次失败按 `retryDelay` 等待后重试；`retryDelay` 可为固定毫秒（0–60000，默认 1000）或 `(attempt, error) => ms`，attempt 从 1 开始。中止、卸载或被新一次 `run` 取代时立即停止重试。`onError` 与 error 状态只在最终失败时写入。
- **轮询**：`pollingInterval`（100–3600000ms）在每次成功后启动下一次 `run`；`manual: true` 不轮询。请求失败会停止轮询，下一次手动/依赖刷新成功后重新开始。`pollingWhenHidden` 默认 false：文档隐藏时跳过该次 tick 但保留调度。
- **refreshDeps**：JSON 可序列化的依赖数组（≤16 项）；值变化时取消当前请求并重新执行。`manual: true` 时不因依赖变化自动执行。函数、Symbol 等不可序列化值不受支持。
- **取消**：`cancel()` 中止在途请求、重试等待与轮询计时；不写入 error。卸载同样清理。竞态仍由 generation 保证最后一次结果生效。
- **校验**：非法 retry/retryDelay/pollingInterval/pollingWhenHidden/refreshDeps 以 `REQUEST_INVALID` 失败；retryDelay 函数返回越界值也在运行时失败，并写入 error/onError。
- **状态**：成功时 `data` 更新、error 清空；最终失败时 data 清空、error 写入。重试期间保持 loading，不暴露尝试次数。

## 3. 边界

- 没有分页/加载更多、debounce/throttle、缓存/SWR、请求去重、后台标签页自动暂停全部定时器等能力。
- 轮询基于 `setTimeout` 串行调度，不保证严格周期；页面隐藏时按 `pollingWhenHidden` 跳过。
- `refreshDeps` 使用 JSON 序列化比较，不适合大对象或循环结构。
- 服务函数每次渲染更新，但运行中使用最新引用；依赖闭包变化不会自动触发请求，需用 `refreshDeps`。
- 轮询只针对自动请求；手动请求需要自行定时调用。

## 4. 与 Umi 的差异

| 方面 | Umi useRequest | cormi U12-1 |
| --- | --- | --- |
| 重试 | 插件生态 | 内置 retry/retryDelay |
| 轮询 | 插件生态 | 内置 pollingInterval |
| 依赖刷新 | refreshDeps | refreshDeps（JSON 比较） |
| 分页 | 插件生态 | 未提供 |
| 缓存/去重 | 插件生态 | 未提供 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | 两次失败后成功（共 3 次请求）、轮询多次执行、导航卸载后停止、refreshDeps 重新请求；原有取消/竞态/错误用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u12-request-retry-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u12-request-retry-validation.json)。

## 6. 下一步

- U12 剩余：分页/加载更多、缓存/去重、防抖节流；
- U16 UI locale 映射、U17 Antd/ProLayout、F6 微前端与状态库适配。
