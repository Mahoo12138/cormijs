# U12-11：防抖 leading/trailing 边沿

日期：2026-10-22。本切片补齐防抖边沿：`debounceLeading` 控制 burst 第一次调用是否立即执行，`debounceTrailing` 控制窗口内是否补发一次；默认仍为 trailing-only。

## 1. 使用方式

```tsx
// 前沿 + 尾调用
useRequest(service, { manual: true, debounceWait: 200, debounceLeading: true, debounceTrailing: true });

// 仅前沿：窗口内后续调用丢弃
useRequest(service, { manual: true, debounceWait: 200, debounceLeading: true, debounceTrailing: false });

// 默认：仅尾调用
useRequest(service, { manual: true, debounceWait: 200 });
```

## 2. 契约与语义

- `debounceLeading` 默认 `false`，`debounceTrailing` 默认 `true`；两者都是布尔值，且必须配合 `debounceWait > 0`。
- 仅当 `debounceLeading: false` 且 `debounceTrailing: false` 时抛 `REQUEST_INVALID`；没有有效执行边沿的配置不允许。
- 一个 burst 从第一次调用开始；若 burst 内距上次调用不足 `debounceWait`，后续调用属于同一 burst。
- 仅前沿：burst 第一次调用立即执行；窗口内后续调用立即以 `undefined` 解析，不补发。
- 仅尾调用：第一次调用被推迟，窗口内后续调用重置等待；窗口结束执行最后一次。
- 前沿+尾调用：第一次立即执行；窗口内后续调用合并为窗口结束的一次尾执行；若没有后续调用则不产生尾执行。
- `debounceMaxWait` 仍以 burst 起点计时；到达上限时执行当前排队的尾调用并结束 burst。
- 新的执行沿用既有竞态保护：尾执行会 abort 在途的前沿请求；`onSuccess`/`onError` 只对最终生效的执行触发。
- `cancel()`/卸载清理计时器与 burst 时间戳；轮询绕过防抖。

## 3. 边界

- 不支持按参数区分防抖键或跨组件共享；每个 hook 实例独立计时。
- 仅前沿模式下没有尾执行，窗口内调用不会补发。
- 尾执行结果只解析最后一次排队调用；被替换的调用立即解析 `undefined`。
- 没有 debounce 的 `maxWait` 取消/刷新 API；计时受浏览器后台节流影响。
- 与 `throttleWait` 互斥。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/request.test.ts` | 前沿+尾调用：0/50ms 两次调用先执行 1 次、窗口结束再执行 1 次；仅前沿：两次同步调用只执行 1 次且 300ms 后无补发；默认 trailing 行为保持 |
| 安装包 `request` consumer | 公共类型包含 `debounceLeading`/`debounceTrailing` |
| `pnpm check` | 570/570 |
| `pnpm test:browser` | 54/54 |
| `pnpm test:package` | 344 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u12-11-debounce-edges-validation.json)。

## 5. 下一步

- U12 剩余：自定义节流键/跨组件共享（扩展项）；
- U17 图表/主题编辑器、F6、U09 热替换、U16 请求 locale、SSR 生产化、U33 sitemap lastmod/压缩。
