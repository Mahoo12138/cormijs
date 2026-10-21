# cormi F5x：`<Helmet>` 组件级 head

日期：2026-10-21。本切片补齐 U21 的组件 API：页面可渲染 `<Helmet>` 声明本页的标题、meta、link 与 JSON-LD，运行时把它与路由 `meta.head` 合并；组件卸载或导航后条目移除。仍由 `headPlugin` 管理受管节点。

## 1. 使用方式

```tsx
import { Helmet } from '@cormijs/runtime';

export default function Home() {
  return <main>
    <Helmet
      title="Helmet home"
      metas={[{ name: 'description', content: 'helmet description' }]}
      links={[{ rel: 'alternate', href: '/home-alt' }]}
      jsonLd={{ '@type': 'WebPage', name: 'Helmet home' }}
    />
    <h1>Home</h1>
  </main>;
}
```

同时启用 `headPlugin`（不启用时 `<Helmet>` 没有上下文，渲染为无操作）。

## 2. 契约与语义

- 合并：先取当前匹配链的路由 `meta.head`，再按 `<Helmet>` 挂载顺序追加；标题与 JSON-LD 取最后一个声明，meta 按 name/property 替换，link 按 rel+href 去重；
- 校验：使用与路由 head 相同的 `normalizeHead`；非法 title/meta/link/JSON-LD 抛 `HEAD_INVALID`；
- 生效：挂载、更新与卸载都会重新应用合并结果；路由导航时路由 head 更新，已挂载 Helmet 条目继续参与合并；
- 受管节点：所有输出仍带 `data-cormi-head`，导航/卸载时由 head 插件统一移除与恢复标题；
- 初始：Provider 在首个路由事件前用当前地址 seed 路由 head，避免 Helmet 首帧覆盖后标题回退；
- 多实例：多个 Helmet 条目按挂载先后合并；重新渲染会以新条目替换旧条目；
- 退出：Provider 随 runtime 插件卸载；条目在组件卸载时移除；无全局单例。

## 3. 与 Umi 4 的差异

Umi 常用 `react-helmet-async` 的 children 标签 API；cormi 提供对象 props 版本，并与路由 `meta.head` 共用同一条合并/受管节点管线。

| 方面 | Umi 4 | cormi F5x |
| --- | --- | --- |
| API | `<Helmet><title>…</title></Helmet>` | props：title/metas/links/jsonLd |
| 依赖 | react-helmet-async | 内置 runtime |
| 与路由 head | 组件自行合并 | 路由→组件顺序合并 |
| 卸载恢复 | 组件库 | headPlugin 受管节点 |
| SSR 收集 | 支持 | 待 U32 |

## 4. 限制

- 不使用 children 标签语法，也不支持任意 raw HTML/meta 属性；
- 同一时刻的多个 Helmet 以挂载顺序合并，不做嵌套作用域或优先级配置；
- 依赖 `headPlugin` 的 Provider；不启用时组件无效果；
- 不支持异步 head（如数据到达后由非组件逻辑更新；可将数据放入组件状态后重新渲染）；
- SSR 头部收集尚未实现。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/route-head.test.ts`（合并顺序、标题/JSON-LD 覆盖、meta/link 去重） | 5/5 |
| `tests/browser/route-head.test.ts`（Home 使用 Helmet；导航到 Guide 后条目移除；返回后恢复；JSON-LD 切换） | 1/1 |
| `pnpm check` | 542/542，0 失败/取消/跳过（F5w 为 541，新增 1 项） |
| `pnpm test:browser` | 51/51，0 失败/取消/跳过（无新增文件） |
| `pnpm test:package` | 320 阶段通过（完整套件；route-head consumer 的 typecheck 包含 Helmet/HeadProvider/headRuntime） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5x-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U21 后续：children 标签 API、SSR 头部收集与更多 head 属性；
- U32：SSR；U16 Antd/dayjs 联动；U17 UI adapter；
- U25 的 runtimePublicPath 受 Vite chunk 导入限制未交付；F6 多 builder 与微前端。
