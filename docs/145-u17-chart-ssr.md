# U17-6：图表 SSR 边界与 ClientOnly

日期：2026-10-24。图表库依赖 DOM/Canvas，不能在服务端直接产出图形。本切片新增通用 `<ClientOnly>`：SSR 输出 fallback，hydration 后再渲染浏览器内容；图表按懒加载 + ClientOnly 组合，服务端不执行图表模块。

## 1. 使用方式

```tsx
import { lazy, Suspense } from 'react';
import { ClientOnly } from '@cormijs/runtime';

const Pie = lazy(() => import('@ant-design/plots').then(module => ({ default: module.Pie })));

export default function Page() {
  return (
    <ClientOnly fallback={<p>Loading chart</p>}>
      <Suspense fallback={<p>Loading chart</p>}>
        <Pie data={data} angleField="value" colorField="type" />
      </Suspense>
    </ClientOnly>
  );
}
```

`ssrPlugin` + `app.ssr: true` 时，服务端 HTML 只包含 fallback；浏览器 hydration 后 ClientOnly 放行 children，lazy 图表 chunk 加载完成后绘制。

## 2. 契约与语义

- `ClientOnly` 在服务端与客户端首帧都渲染 `fallback`，`useEffect` 挂载后才渲染 children；服务端/hydration 首帧一致，不产生 mismatch。
- `fallback` 默认 `null`；children 为空时也渲染 fallback。组件不新增 Provider/服务，Props 只有 `fallback`/`children`。
- 推荐把浏览器库本身放在 `lazy(() => import(...))` 中：ClientOnly 未放行时不会渲染 lazy 组件，服务端也就不会执行图表模块。仅把普通图表组件放进 ClientOnly 仍会在 SSR bundle 中导入该模块（但不渲染）。
- `Suspense` fallback 处理客户端 chunk 加载；与 ClientOnly 的 fallback 可复用同一占位。
- 图表数据、交互与主题仍在客户端；SSR 只保证页面可渲染与 hydration 正确，不在 HTML 中提供图表像素或数据文本。
- 未使用 ClientOnly 的图表页面仍可能失败或输出空内容；这是应用侧的浏览器依赖边界。

## 3. 边界

- 不提供服务端图表渲染、Canvas/SVG 序列化、图表 HTML/SEO 快照或图表数据预取。
- 不做自动浏览器 API 检测；应用需显式包裹依赖 DOM/Canvas/WebGL 的组件。
- fallback 必须稳定且与客户端首帧一致；不要在 fallback 中读取仅浏览器可用的数据。
- `ClientOnly` 会在 hydration 后多一次渲染；对首屏关键内容不应无条件使用。
- 不影响既有 SSR head/hydration/streaming 语义；图表内容不参与 SSR head。
- 未验证 WebGL/Worker 类图表、图表库自身 SSR 模式或跨 iframe 渲染。

## 4. 验证

验证环境：`@ant-design/plots` 2.6.8、React 19.3.1、SSR dev/preview、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/client-only.test.ts` | 服务端渲染 fallback、不渲染 children；空 fallback |
| `tests/browser/charts.test.ts` | SSR HTML 含 fallback 且无 canvas；hydration 后 canvas 出现、fallback 移除；dev/build/preview |
| 安装包 `charts` consumer | SSR 构建 + dev/build/preview 的同一断言 |
| `pnpm check` | 572/572 |
| `pnpm test:browser` | 56/56 |
| `pnpm test:package` | 359 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u17-6-chart-ssr-validation.json)。

## 5. 下一步

- U17 剩余：服务端图表内容、ProLayout 内置文案 locale、自定义 locale 对象；
- F6 微前端/dva/valtio、U09 热替换、U16 请求 locale、SSR 生产化、U33 sitemap lastmod/压缩。
