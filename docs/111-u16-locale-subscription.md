# cormi U16 增量：locale 变更订阅

日期：2026-10-21。本切片为 Antd/dayjs 等外部 UI 库提供语言联动的机制：`useIntl().subscribe(listener)` 订阅成功切换，另在浏览器派发 `cormi:localechange` 事件。框架仍不引入这些 UI 库，联动逻辑由应用适配。

## 1. 使用方式

```tsx
const intl = useIntl();
useEffect(() => intl.subscribe(locale => dayjs.locale(locale)), [intl]);
```

```tsx
useEffect(() => {
  const handler = (event: Event) =>
    setAntdLocale((event as CustomEvent<{ locale: string; previous: string }>).detail.locale);
  window.addEventListener('cormi:localechange', handler);
  return () => window.removeEventListener('cormi:localechange', handler);
}, []);
```

## 2. 契约与语义

- `subscribe(listener)` 在每次 `setLocale` 成功后同步调用监听器，参数为新 locale；返回幂等取消函数；
- 事件：同一时刻在浏览器派发 `cormi:localechange`，`detail` 为 `{ locale, previous }`；SSR/无 window 环境不派发；
- 监听器异常被捕获并记录，不阻断其他监听器或状态更新；
- Provider 卸载时清空监听器；`subscribe` 注册在当前 Provider 实例内，不跨挂载共享；
- 不持久化、不初始化语言；仍由既有 `setLocale`/localStorage 行为负责；
- 不影响 `t/tp/format*` 的返回类型或语言解析。

## 3. 与 Umi 4 的差异

Umi 的 locale 通常配合 antd 的 ConfigProvider/dayjs 适配代码；cormi 只提供订阅与事件，应用决定如何更新外部库。

| 方面 | Umi 4 | cormi 本增量 |
| --- | --- | --- |
| 订阅机制 | 应用/库约定 | `subscribe` + DOM 事件 |
| Antd/dayjs 包 | 可选集成 | 不引入 |
| 持久化 | locale 插件 | 不变 |
| SSR 事件 | 无 | 无 |

## 4. 限制

- 不自动更新 dayjs/antd 语言包，应用需安装并映射 locale code；
- 不在初始挂载时回调（只响应切换）；
- 不提供全局单例；多个 Provider 实例各自通知；
- 监听器错误只记录日志，不做重试；
- DOM 事件的 detail 不包含消息目录或格式化函数。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/browser/locale.test.ts`（切换 en→zh→en；subscribe 与 DOM 事件在 dev/build/preview 中同步） | 1/1 |
| `pnpm check` | 548/548，0 失败/取消/跳过（本切片无新增 Node 用例） |
| `pnpm test:browser` | 52/52，0 失败/取消/跳过（无新增文件） |
| `pnpm test:package` | 328 阶段通过（locale consumer 新增 `subscribe` 公共类型断言） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/u16-locale-subscription-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U16 剩余：dayjs/Antd 官方映射配方与 UI locale 适配包；
- U32：serverLoader、流式渲染；U17 官方 UI 集成；F6 多 builder/微前端。
