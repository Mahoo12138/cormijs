# U12-6：useRequest throttle

日期：2026-10-22。本切片为 `useRequest` 增加 `throttleWait`：窗口内首次 `run`/`refresh` 立即执行，后续调用被丢弃；轮询绕过节流。与 `debounceWait` 互斥。

## 1. 使用方式

```tsx
const { run } = useRequest(service, { manual: true, throttleWait: 500 });
```

## 2. 契约与语义

- `throttleWait` 为 0–60000ms 整数；0 关闭。与 `debounceWait > 0` 同时设置时 `REQUEST_INVALID`。
- 前沿节流：距上次实际调用不足窗口的 `run`/`refresh` 立即以 `undefined` 解析，不排队、不补偿尾调用。
- 窗口从实际执行开始计时；被丢弃的调用不更新计时。`cancel()` 重置窗口；卸载清理。
- 自动初始请求与 `refreshDeps` 同样经过节流；轮询 tick 直接调用内部执行器，不受节流影响。
- 重试/缓存/分页等既有语义不变。

## 3. 边界

- 只有 leading，不支持 trailing、maxWait 或按参数区分节流键。
- 被丢弃调用不会触发 onSuccess/onError。
- 节流是客户端行为，不合并已在途请求或服务端请求。
- 与防抖互斥，避免未定义的组合语义。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | 同一窗口内两次 run 只发一次；窗口后再次运行成功；既有防抖/重试/轮询/分页/缓存用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u12-6-throttle-validation.json |

## 5. 下一步

- U12 剩余：trailing throttle、游标分页、缓存持久化；
- U17 ProLayout/图表、F6、U16 请求 locale、U33 并发/robots、SSR 生产化。
