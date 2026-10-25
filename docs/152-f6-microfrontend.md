# F6-4：qiankun 子应用生命周期

日期：2026-10-25。本切片在 `@cormijs/runtime/microfrontend` 提供 `createMicroApp(application)`：把 cormi application 包装成 qiankun 兼容的 `bootstrap`/`mount`/`unmount`/`update`，负责容器内挂载、重复挂载保护与 remount。不包含 qiankun 主应用注册、构建入口或沙箱。

## 1. 使用方式

```ts
// 子应用提供的 application 对象：routes/runtime/appConfig 与普通 cormi 应用一致
import { createMicroApp } from '@cormijs/runtime/microfrontend';

export const microApp = createMicroApp({
  routes,
  history: 'memory',
  base: '/sub/',
}, { mountId: 'micro-root' });

export const { bootstrap, mount, unmount, update } = microApp;
```

qiankun 调用 `mount({ container })` 时，适配器解析容器、在容器内查找或创建 `#micro-root`，再调用 `mountApplication`。应用需要自行把生命周期导出接入 qiankun 子应用入口（UMD/HTML entry 构建不在本切片）。

## 2. 契约与语义

- `createMicroApp(application, options)` 校验 application.routes、`mountId`（字母开头的 1–64 位标识符）与 `base`（绝对路径且以 `/` 结尾）。
- `bootstrap()` 为幂等空操作；`mount(props)` 接受 `container: Element | selector`，缺失/非法容器抛 `MICRO_APP_INVALID`。
- 首次 mount 在容器内创建挂载元素；已存在同 id 元素时复用。已挂载时再次 mount 抛 `MICRO_APP_INVALID`，并发 mount 共享同一个 Promise。
- `unmount()` 等待在途 mount/失败后 dispose；只删除适配器创建的挂载元素，复用的元素保留。卸载后可再次 mount。
- `update()` 是兼容性空操作；qiankun 的 props/global state 不转发给 application。
- `base` 默认取 application.base，可被 options 覆盖；history `memory`/`browser` 由 application 原样传递。

## 3. 边界

- 不提供 qiankun 主应用的 microApps 注册、activeRule、sandbox、样式隔离、子应用间通信或 `props` 注入。
- 不生成 UMD/HTML 子应用入口，也不修改 Vite build；本适配只负责 runtime 生命周期。
- 一个 lifecycle 实例同时只允许一个挂载；多实例需创建多个 `createMicroApp`。
- 不处理 qiankun 的 CSS/全局副作用清理、路由 base 自动推导或 host 路由同步。
- 未处理 qiankun 1.x/2.x 生命周期差异或 `update` 的真实 props；未验证真实 qiankun host。
- `mountApplication` 仍拥有 Router/React root；适配器只持有一个 handle，dispose 后释放。

## 4. 验证

验证环境：React 19.3.1、Playwright/Edge、macOS arm64，memory history。

| 检查 | 结果 |
| --- | --- |
| `tests/browser/microfrontend.test.ts` | dev/typecheck/build/preview：mount 渲染、重复 mount 报错、update 空操作、unmount 清理、remount |
| 安装包 `microfrontend` consumer | 离线安装、typecheck、公共类型、dev/build/preview 浏览器验收 |
| `pnpm check` | 573/573 |
| `pnpm test:browser` | 59/59 |
| `pnpm test:package` | 83 阶段（`CORMI_PACKAGE_ONLY=microfrontend`；宿主磁盘不足，全量基线 359） |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/f6-microfrontend-validation.json)。

## 5. 下一步

- F6 剩余：qiankun host/UMD 入口、Module Federation、多 builder/MFSU、dva 自动发现/immer；
- U33 按语言拆分、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
