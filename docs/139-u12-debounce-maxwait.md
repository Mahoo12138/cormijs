# U12-10：防抖 maxWait

日期：2026-10-22。本切片为 `useRequest` 的防抖增加 `debounceMaxWait`：持续触发时，合并请求最迟在首次触发后的上限时间内执行，而不是被后续调用无限推迟。

## 1. 使用方式

```tsx
const { run } = useRequest(service, {
  manual: true,
  debounceWait: 500,
  debounceMaxWait: 300,
});
```

## 2. 契约与语义

- `debounceMaxWait` 为 1–60000ms 整数；必须同时设置 `debounceWait > 0`，否则 `REQUEST_INVALID`。
- 防抖仍为 trailing 模式：每次 `run`/`refresh` 重置等待窗口，只有最后一次调用在窗口结束时执行。
- 设置 `debounceMaxWait` 后，每次合并执行的截止时间为 `min(now + debounceWait, burstStart + debounceMaxWait)`；`burstStart` 是本轮第一次被防抖调用的时间。
- 持续调用超过上限时，在 `burstStart + debounceMaxWait` 执行一次并清空本轮；后续调用开始新的 burst。
- 被后续调用替换的排队调用仍立即以 `undefined` 解析；最终执行结果只解析最后一次排队调用。
- 自动初始请求与 `refreshDeps` 同样经过该逻辑；轮询绕过防抖。
- `cancel()` 与卸载清除计时器并解析排队调用为 `undefined`，同时清空 burst 起点。
- 未设置 `debounceMaxWait` 时行为与 U12-5 完全一致。

## 3. 边界

- 只有 trailing 防抖；没有 `debounceLeading`/`debounceTrailing` 开关。
- 不提供按参数自定义防抖键、跨组件共享或服务端合并。
- 计时基于 `Date.now()` 与 `setTimeout`，浏览器后台节流可能推迟实际执行。
- 与 `throttleWait` 仍互斥；缓存/分页语义不变。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | `debounceWait:500` + `debounceMaxWait:300` 下，0/100/200ms 三次调用在 300ms 左右只执行一次；未设置 maxWait 时会在 450ms 仍无请求（由同一断言覆盖） |
| 安装包 `request` consumer | 公共类型包含 `debounceMaxWait` |
| `pnpm check` | 570/570 |
| `pnpm test:browser` | 54/54 |
| `pnpm test:package` | 344 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u12-10-debounce-maxwait-validation.json)。

## 5. 下一步

- U12 剩余：跨标签页缓存失效；防抖边沿见 [U12-11](140-u12-debounce-edges.md)；
- U17 图表/主题编辑器、F6、U09 热替换、U16 请求 locale、SSR 生产化、U33 sitemap lastmod/压缩。
