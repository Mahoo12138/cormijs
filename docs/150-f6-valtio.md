# F6-2：valtio 适配

日期：2026-10-25。本切片新增 `@cormijs/valtio`，按 Umi `@umijs/valtio` 的形态显式再导出 valtio 的 proxy/snapshot API。它不需要 Provider、Cordis 插件或生命周期，应用可直接在组件树外修改状态。

## 1. 使用方式

```tsx
import { proxy, useSnapshot } from '@cormijs/valtio';

const store = proxy({ count: 0 });

function Counter() {
  const snapshot = useSnapshot(store);
  return <p>{snapshot.count}</p>;
}

<button onClick={() => { store.count++; }}>Increment</button>
```

安装：`pnpm add @cormijs/valtio`（包内已依赖 `valtio@2.3.2`）。

## 2. 契约与语义

- 导出 `proxy`、`ref`、`snapshot`、`subscribe`、`useSnapshot` 以及 `valtio/utils` 的 `proxyWithDevtools`、`proxyMap`、`proxySet`、`subscribeKey`、`useProxy`、`watch`。
- 组件通过 `useSnapshot` 订阅 proxy；在 React 外修改 proxy 会触发订阅组件重渲染。没有 Provider 或全局单例。
- 这是纯再导出包：没有 Cordis 插件、服务注入、资源所有权或卸载清理；应用也可直接依赖 `valtio`。
- cormi 的 `modelPlugin`/`useModel` 与 valtio 是两套状态方案；本包不把它们合并，也不把 proxy 自动注册为 model。

## 3. 边界

- 未提供 Umi 1.11 中已被 valtio 2 移除的 `derive`/`proxyWithComputed`/`proxyWithHistory`/`underive`；需要旧工具时请使用对应 valtio 版本或自行实现。
- 不提供 SSR dehydration/hydration、持久化、devtools UI 或跨 tab 同步；这些属于 valtio 应用方案。
- 不做 cormi model/request 的桥接，不替代 `useModel`、React Query 或 request 缓存。
- valtio 2 的 React 类型/版本由应用与包依赖决定；本包只声明 react 可选 peer。
- 未验证 valtio 1.x；与 Umi 的 1.11 导出面存在上游版本差异。

## 4. 验证

验证环境：`valtio@2.3.2`、React 19.3.1、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/browser/valtio.test.ts` | dev/typecheck/build/preview：两个 `useSnapshot` observer 在 React 外 `store.count++` 后同步更新，reset 恢复 |
| 安装包 `valtio` consumer | 离线安装、typecheck、公共类型、dev/build/preview 浏览器验收 |
| `pnpm check` | 572/572 |
| `pnpm test:browser` | 57/57 |
| `pnpm test:package` | 83 阶段（`CORMI_PACKAGE_ONLY=valtio`；宿主磁盘不足，全量基线 359） |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/f6-valtio-adapter-validation.json)。

## 5. 下一步

- F6 剩余：dva 适配、qiankun/Module Federation、多 builder/MFSU；
- U33 按语言拆分、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
