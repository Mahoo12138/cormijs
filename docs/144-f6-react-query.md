# F6-1：可选 React Query 适配

日期：2026-10-22。本切片新增可选包 `@cormijs/plugin-react-query`：通过 Cordis runtime 贡献挂载 `QueryClientProvider`，应用继续直接使用 `@tanstack/react-query` 的 `useQuery`/`useMutation`。不封装 hooks，不替换 cormi 的 request 客户端。

## 1. 使用方式

```bash
pnpm add @tanstack/react-query @cormijs/plugin-react-query
```

```ts
import { defineConfig } from 'cormi';
import preset from '@cormijs/preset-react-vite';
import { reactQueryPlugin } from '@cormijs/plugin-react-query';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'react-query', plugin: reactQueryPlugin, options: {
      id: 'application:react-query',
      defaults: { staleTime: 60_000, retry: 0, refetchOnWindowFocus: false },
    } },
  ],
});
```

```tsx
import { useQuery } from '@tanstack/react-query';

function Page() {
  const { data } = useQuery({ queryKey: ['greeting'], queryFn: async () => (await fetch('/api/greeting')).json() });
  return <p>{data?.message}</p>;
}
```

## 2. 契约与语义

- `reactQueryPlugin`（`cormi:react-query`，`inject: ['react']`）把 runtime 贡献 `{module: '@cormijs/plugin-react-query/runtime', exportName: 'reactQueryRuntime'}` 注册到 `ctx.react.runtime`，stage 20；插件通过 `ctx.effect` 注册/撤回。
- runtime Provider 每次应用挂载创建一个 `QueryClient`，默认值来自插件选项；应用通过 `@tanstack/react-query` 的 hooks 使用同一个 client，共享缓存/去重/失效。
- `defaults` 支持 `staleTime`/`gcTime`（0–86400000ms）、`retry`（false 或 0–10）、`refetchOnWindowFocus`（boolean），其余键或非法值以 `REACT_QUERY_INVALID` 失败。
- QueryClient 随 React 树销毁；Provider 不主动清空缓存，也不把查询结果写入 cormi request 缓存。
- 应用仍可自行创建 QueryClient/Provider；本插件是可选的默认组合，不改变 `useRequest`、分页或缓存语义。
- 包入口是 Node 配置模块，`runtime` 子路径导入 `@tanstack/react-query`；未安装 React Query 的消费者不会因可选 peer 失败。

## 3. 边界

- 不提供 query key 生成、请求客户端桥接、全局 mutation 状态、devtools 或持久化插件。
- 不提供 SSR dehydration/hydration；SSR 应用需自行在服务端预取并传递 dehydrated state。
- 只映射四个 `defaults` 字段；query/mutation 级选项由应用直接传给库。
- 多个应用挂载各自拥有 QueryClient；不共享跨应用缓存。
- React Query 版本 `>=5`，peer 与 API 兼容性由应用负责；未验证 v4。
- 未提供 dva/valtio 适配、qiankun/Module Federation 或 MFSU；这些仍是 F6 后续。

## 4. 验证

验证环境：`@tanstack/react-query` 5.104.5、React 19.3.1、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/react-query.test.ts` | runtime 贡献/撤回、非法 defaults |
| `tests/browser/react-query.test.ts` | dev/typecheck/build/preview：两个同 key observer 共享一次请求，refetch 更新两者 |
| 安装包 `react-query` consumer | 离线安装、typecheck、公共类型、dev/build/preview 浏览器验收 |
| `pnpm check` | 571/571 |
| `pnpm test:browser` | 56/56 |
| `pnpm test:package` | 359 阶段（新增 react-query consumer） |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/f6-react-query-validation.json)。

## 5. 下一步

- F6 剩余：qiankun/Module Federation、dva/valtio 适配、多 builder/MFSU；
- U17 图表 SSR/ProLayout locale、U09 热替换、U16 请求 locale、SSR 生产化、U33 sitemap lastmod/压缩。
