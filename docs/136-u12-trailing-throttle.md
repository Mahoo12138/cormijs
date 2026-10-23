# U12-8：useRequest 尾调用节流

日期：2026-10-22。本切片补齐 `useRequest` 的 throttle 边沿：`throttleLeading`/`throttleTrailing` 可选择前沿、尾调用或两者；默认仍是前沿执行、丢弃后续调用，保持既有行为。

## 1. 使用方式

```tsx
const { run } = useRequest(service, {
  manual: true,
  throttleWait: 500,
  throttleTrailing: true,
});

// 只用尾调用：窗口内的调用合并到窗口结束时执行一次
const trailingOnly = useRequest(service, {
  manual: true,
  throttleWait: 500,
  throttleLeading: false,
  throttleTrailing: true,
});
```

## 2. 契约与语义

- `throttleWait` 为 0–60000ms 整数；0 关闭。`throttleLeading` 默认 `true`，`throttleTrailing` 默认 `false`。
- **前沿**：窗口第一次调用立即执行；窗口内的后续调用按尾调用设置处理。
- **尾调用**：窗口内被节流的调用合并为一次执行，发生在窗口结束（距窗口起点 `throttleWait`）；所有排队调用的 Promise 以这次执行的结果解析（失败为 `undefined`）。没有排队调用则不执行尾调用。
- **仅尾调用**：`throttleLeading: false` 必须同时 `throttleTrailing: true`；窗口第一次调用也会排到窗口结束，窗口内后续调用继续合并。
- 非法组合（尾调用/仅尾调用缺少 `throttleWait`、仅关前沿但不启用尾调用）抛 `REQUEST_INVALID`。
- `cancel()` 与卸载会清除尾调用计时器，排队 Promise 以 `undefined` 解析；轮询 tick 仍绕过节流。
- 每次实际执行沿用既有竞态保护：新的执行会 abort 在途请求，因此慢的前沿请求可能被尾调用取代；`onSuccess`/`onError` 只对最终生效的执行触发。
- 与 `debounceWait` 互斥；缓存、重试、分页等既有语义不变。

## 3. 边界

- 不提供 `maxWait`、按参数区分节流键或跨组件共享节流器；不同 hook 实例各自计时。
- 尾调用只在窗口结束时执行一次；没有“每个被丢弃调用都补发”的语义。
- 被合并的调用不单独触发 `onSuccess`/`onError`，只共享最终执行结果。
- 节流是客户端行为，不合并服务端请求；SSR 不执行尾调用。
- 既有前沿默认不变，因此与 ahooks 默认 `trailing: true` 仍有差异；需要尾调用时显式开启。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | 前沿两次调用只发一次；窗口内第二次调用在窗口结束补发一次；`throttleLeading:false` 时首次调用也排到窗口结束且两次调用合并为一次；既有防抖/重试/轮询/分页/缓存用例保持 |
| `pnpm check` | 569/569 |
| `pnpm test:browser` | 54/54 |
| `pnpm test:package` | 344 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u12-8-trailing-throttle-validation.json)。

## 5. 下一步

- U12 剩余：缓存持久化、maxWait/自定义节流键；
- U17 图表/主题编辑器、F6、U16 请求 locale、U33 sitemap index、SSR 生产化。
