# cormi F5p：视口可见预取

日期：2026-10-21。本切片补齐 U31 的可见性触发：`usePrefetchOnVisible(id)` 观察一个元素，首次进入视口后加载对应路由模块。它与手动 `usePrefetch()`、意图 `usePrefetchOnIntent()` 共用同一注册表与在途 Promise，不重复加载。

## 1. 使用方式

```tsx
import { usePrefetchOnVisible } from '@cormijs/runtime';

function GuideLink() {
  const visible = usePrefetchOnVisible('config:guide', { rootMargin: '200px' });
  return <Link ref={visible} to="/guide">Guide</Link>;
}
```

```tsx
// 更细的控制
const visible = usePrefetchOnVisible('config:guide', { rootMargin: '0px', threshold: 0.5, delayMs: 100 });
```

`usePrefetchOnVisible` 返回 ref 回调，可直接传给任意 DOM 元素或路由 `Link`。

## 2. 契约与语义

- 观察参数：`rootMargin`（默认 `200px`，≤64 字符且无换行）、`threshold`（0–1，默认 0.01）、`delayMs`（0–5000，默认 0）；越界/非法类型抛 `PREFETCH_INVALID`；
- 触发：元素首次与视口相交后延迟 `delayMs` 调用注册表预取，并立即断开观察；同一 `id` 的重复调用复用在途 Promise；
- 生命周期：ref 变化或组件卸载时断开观察、清除定时器；React 18/19 的 ref 回调与 effect 清理顺序已覆盖；
- 环境：没有 `IntersectionObserver`（如 SSR/旧环境）时返回的 ref 是空操作，不抛错；
- 注册表：`id` 必须在启用 `routePrefetchPlugin` 的生成入口中存在；不存在的 `id` 返回 `false`，不发起请求；
- 范围：只预取路由模块代码，不预取 client loader 数据；
- 退出：无全局观察器；每个 hook 实例只观察自己的元素，卸载后释放。

## 3. 与 Umi 4 的差异

Umi 的 `routePrefetchOnLoad` 在应用加载后统一预取；cormi 保持显式 Hook，不默认扫描视口或全局注入观察器。

| 方面 | Umi 4 | cormi F5p |
| --- | --- | --- |
| 触发 | 配置开启后自动 | 元素级 Hook |
| 默认行为 | 可能全量预取 | 不启用即不观察 |
| 数据预取 | 视配置 | 仅模块 |
| 取消/释放 | 框架管理 | ref/卸载自动 |

## 4. 限制

- 只观察单个元素；没有全局“所有链接进入视口”的自动策略；
- 不预取 loader 数据、图片或其他资源；
- 没有轮询/超时回退；`IntersectionObserver` 缺失时静默跳过；
- 不支持自定义 `IntersectionObserver` root（固定视口）；
- 模块预取失败不重试；导航时仍按正常加载流程处理。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/browser/prefetch.test.ts`（新增：首屏下方元素未预取，滚入视口后加载 Guide 模块并正常导航） | 4/4（文件内） |
| `pnpm check` | 532/532，0 失败/取消/跳过（F5o 为 532，本切片无新增 Node 用例） |
| `pnpm test:browser` | 50/50，0 失败/取消/跳过（F5o 为 49，新增视口用例） |
| `pnpm test:package` | 310 阶段通过（完整套件；prefetch consumer 的公共类型新增 `usePrefetchOnVisible`/`PrefetchVisibleOptions` 断言） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5p-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U31 剩余：数据预取与 SSR 侧预取；
- U32/U34：SSR、MPA；U25 externals/runtimePublicPath；
- U16 Antd/dayjs 联动；U17 UI adapter；F6 多 builder 与微前端。
