# U17-5：图表库集成验证

日期：2026-10-22。Umi 的图表能力来自应用侧图表库，而不是固定插件。本切片按同一原则用 `@ant-design/plots` 验证 cormi 应用的 dev/build/preview 与安装包消费，不新增图表框架、封装库或数据层。

## 1. 使用方式

```bash
pnpm add @ant-design/plots
```

```tsx
import { Pie } from '@ant-design/plots';

const data = [
  { type: 'A', value: 3 },
  { type: 'B', value: 5 },
  { type: 'C', value: 2 },
];

export default function Page() {
  return (
    <div style={{ height: 280 }}>
      <Pie data={data} angleField="value" colorField="type" height={280} />
    </div>
  );
}
```

图表库是应用的普通依赖，cormi 只提供路由、布局与构建；没有 `cormijs` 图表插件，也没有对 G2/Plot 配置的二次封装。

## 2. 契约与语义

- 图表组件在 React 路由页面内渲染，参与既有 Vite 构建、HMR、base 前缀与 preview/serve 静态资源处理。
- 图表库与 cormi 的集成点是普通 ESM 依赖；不存在 Cordis 插件、服务注入或退出生命周期。
- 图表容器需要有可计算的宽高；图表库自身的响应式/自适应行为不变。
- `pnpm typecheck` 覆盖应用侧的图表库类型；上游类型问题由应用的 `skipLibCheck`/依赖版本决定，不是 cormi 的运行时限制。
- Antd 主题（`antdPlugin`）不自动映射到图表库；需要主题联动时由应用给图表传入库自己的 `theme` 配置。

## 3. SSR 与边界

- 本切片只验证 SPA 的 dev/build/preview；没有验证图表 SSR/hydration。图表库通常依赖 DOM/Canvas，SSR 应用需要自行使用客户端渲染边界（例如 `lazy` + `Suspense` 或 `useEffect` 挂载）。
- 不提供 `ClientOnly`/图表包装组件，也不在服务端预取图表数据。
- 不包含图表类型选择器、主题编辑器联动、图表组件库或可视化 schema；这些属于应用/生态。
- 图表库体积、tree-shaking 与按需加载由应用和所选库决定；cormi 不做专门拆包。
- 未验证其他图表库；本切片只以 `@ant-design/plots` 2.6.8 作为可替换示例。
- 在 pnpm 隔离安装（`hoist=false`）下，`@ant-design/plots` 的传递依赖 `@antv/component` 会导入未声明的 `tslib`；安装包验收显式加入 `tslib@2.8.1`。这是上游元数据/应用依赖问题，不是 cormi 运行时要求。

## 4. 验证

验证环境：`@ant-design/plots` 2.6.8、React 19.3.1、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/browser/charts.test.ts` | dev/typecheck/build/preview 中 Pie 画出非零尺寸 canvas，无页面错误或开发覆盖层 |
| 安装包 `charts` consumer | 离线安装 `@ant-design/plots`、typecheck、dev/build/preview 浏览器验收 |
| `pnpm check` | 570/570 |
| `pnpm test:browser` | 55/55 |
| `pnpm test:package` | 351 阶段（新增 charts consumer） |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u17-5-charts-validation.json)。

## 5. 下一步

- U17 剩余：ProLayout 内置文案 locale、自定义 locale 对象、图表 SSR 边界；
- F6 微前端/状态库适配、U09 热替换、U16 请求 locale、SSR 生产化、U33 sitemap lastmod/压缩。
