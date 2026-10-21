# cormi F5h：路由级 pageview 分析事件

日期：2026-10-20。本切片交付 U38 的一项通用能力：`analyticsPlugin` 在每次路由变化时发送一个 page-view 事件——设置 `measurementId` 时维护 GA4 的 `dataLayer`/`gtag` 队列并发送 `page_view`，同时可用 `dispatch` 让宿主以 `cormi:pageview` CustomEvent 接收。插件不注入第三方脚本，也不处理 Cookie 同意。

## 1. 使用方式

```ts
// cormi.config.ts
import { analyticsPlugin } from '@cormijs/plugin-react';

plugins: [{
  id: 'analytics', plugin: analyticsPlugin,
  options: { id: 'app:analytics', measurementId: 'G-XXXXXXX', dispatch: true },
}]
```

```ts
// 宿主侧（无需依赖 GA）
window.addEventListener('cormi:pageview', event => {
  const { path, search, title, referrer } = (event as CustomEvent).detail;
});
```

GA4 脚本仍由应用自己引入（例如 `htmlPlugin` 的 `headScripts`），插件只负责队列与事件。

## 2. 契约与语义

- 提供者：`cormi:analytics`（`inject: ['react']`），RuntimeContribution 形式注册 `analyticsRuntime`（stage 50，位于最内层）；
- 触发：运行时在每次路由变化（含首屏）调用 `onRouteChange`；首屏事件在组件挂载前发出，宿主如需在 UI 中展示应在模块作用域接收；
- GA4：`measurementId` 匹配 `^G-[A-Z0-9]{4,32}$` 时初始化 `window.dataLayer` 与 `gtag`（只初始化一次），发送 `gtag('config', id, { send_page_view: false })` 与随后的 `event → page_view`；`page_path` 使用**含 base 的实际 URL 路径**（GA 语义），`page_location` 为完整 URL，`page_referrer` 为上一个实际路径；
- 通用事件：`dispatch: true` 时发出 `cormi:pageview`，detail 为 `{ path, search, hash, title, referrer }`，其中 `path` 为**去掉 router basename 的应用路径**（与 `useLocation().pathname` 一致）；
- 校验：未知键、非法 id、非法 `measurementId`/`eventName`（小写 GA4 名称，≤40）与非法 `dispatch` 以 `ANALYTICS_INVALID` 在插件激活阶段失败；
- 退出：卸载插件后不再发送任何事件（`setup` 的清理函数移除状态）。

## 3. 与 Umi 4 的差异

Umi 的 analytics 插件（`packages/plugins/src/analytics.ts`）内置 GA 脚本注入（`gtag/js?id=...`）、`ga('send','pageview')` 与 gtag `config`，并依赖 Umi 的路由事件；它面向唯一供应商。cormi 的插件不发脚本、不绑定供应商：GA4 只是其中一种输出，宿主也可以只消费 CustomEvent；没有 `ga` 旧版协议、`plugin.config` 形式或内置 consent 管理。

| 方面 | Umi 4 | cormi F5h |
| --- | --- | --- |
| 脚本注入 | 内置 GA 脚本 | 应用自行引入 |
| 供应商 | Google Analytics | GA4 或任意宿主 |
| 事件 | pageview（GA） | `page_view`（gtag）+ `cormi:pageview` |
| Cookie 同意 | 无 | 无（明确不在本切片） |

## 4. 限制

- 不做 Cookie 同意、匿名化、采样或 GDPR/CCPA 处理；上线前需由应用补 consent 逻辑；
- 只发送 page-view，不自动采集自定义事件、异常或页面停留时间；
- `page_path` 含 base、`cormi:pageview` 的 `path` 不含 base——两者语义不同，接入时需注意；
- 首屏事件早于 React 挂载，宿主若在 Provider 里监听会漏掉第一条；
- 不校验 `gtag` 是否为真实 GA 脚本（存在第三方同名函数时会写入其队列）。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。机器磁盘仅剩约 3 GiB 时，完整 `pnpm test:package` 在 `output-install` 阶段因 `ERR_PNPM_ENOSPC` 失败（261 阶段）；为此给包验收增加了按消费者过滤的 `CORMI_PACKAGE_ONLY`（逗号分隔，未设置时行为不变），并用 `CORMI_PACKAGE_ONLY=analytics` 跑通分析 consumer 的 83 个阶段。**完整套件（含其它 consumer）仍待在 ≥5 GiB 空闲时重跑**；本切片的独立安装结论仅覆盖分析 consumer。

| 检查 | 结果 |
| --- | --- |
| `tests/browser/analytics.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 511/511，0 失败/取消/跳过（未新增 Node 用例；约 118 秒） |
| `pnpm test:browser` | 48/48，0 失败/取消/跳过（F5g 为 47，新增 1 项；约 529 秒） |
| `pnpm test:package`（子集 `CORMI_PACKAGE_ONLY=analytics`） | 83 阶段通过（核心打包阶段 + analytics consumer）；完整套件仍待重跑 |
| 示例 / 公开类型 | 无新增示例；分析 consumer 的 `types.mts` 公开类型断言在子集运行中通过 |

浏览器验收断言：首屏发出 `page_view`（`page_path` 为含 base 的 `/analytics/`）并完成 `gtag('config','G-TEST1234',{send_page_view:false})` 入队；导航到 guide 后再发一条 `page_view`，`page_path` 为 `/analytics/guide`、`page_referrer` 为 `/analytics/`；宿主收到两条 `cormi:pageview`，detail 的 `path` 为不含 base 的 `/` 与 `/guide`；dev 与静态 preview 结果一致、无控制台错误与开发覆盖层。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5h-validation.json)（其中 package 结果标记为子集运行及其阶段数）。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U38 剩余：其他官方插件（moment2dayjs、confetti 等）逐项核对；
- U32/U34/U35：SSR、MPA、生产 API 路由；F4 剩余：U28 工程命令、U25 externals/runtimePublicPath；
- U13 约定式 loader 识别、U16 ICU 与 locale key 类型、U17 UI adapter。
