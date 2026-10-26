# F6-6：qiankun host 适配

日期：2026-10-25。本切片在 `@cormijs/plugin-qiankun/host` 提供 `QiankunMicroApp`：在 React 路由/布局中创建一个容器，用 qiankun `loadMicroApp` 加载单个子应用，并在组件卸载时 unmount。它不要求子应用使用 cormi。

## 1. 使用方式

```tsx
import { QiankunMicroApp } from '@cormijs/plugin-qiankun/host';

export default function Page() {
  return <QiankunMicroApp
    name="CormiMicroApp"
    entry="./micro/qiankun.html"
    props={{ user: 'demo' }}
    fallback={<p role="status">Sub app unavailable</p>}
  />;
}
```

安装：`pnpm add qiankun @cormijs/plugin-qiankun`。相对 entry 以当前页面 URL 解析；也可以传绝对 URL。

## 2. 契约与语义

- 组件渲染一个带 `data-qiankun-host` 的容器 div；effect 中调用 `loadMicroApp({name,entry,container,props}, {sandbox:true,singular:false})`。
- `mountPromise` 失败时渲染 `fallback` 或 `role="alert"` 错误文本；容器本身保留。
- 组件卸载/`name`/`entry` 变化时调用 `app.unmount()`，忽略卸载异常；重新挂载会创建新的 loadMicroApp。
- `props` 在加载时读取一次；后续 props 变化不会自动转发（需要 update 时应重建组件/使用 qiankun update）。
- `entry` 支持绝对 URL 与相对当前页面的路径；host 与子应用同源时最简单；跨域需子应用/服务器 CORS。
- 与 F6-5 的 `qiankun.js`/`qiankun.html` 可组合：`entry="./micro/qiankun.html"` 指向构建产物即可。

## 3. 边界

- 组件本身不是 qiankun 主应用插件：不调用全局 `registerMicroApps`/`start`，不处理函数式 activeRule、菜单/面包屑或全局生命周期；路由/菜单集成由 [F6-9](157-f6-qiankun-host-routes.md) 提供。
- 一个组件只加载一个子应用；不支持预加载策略、并行/多实例调度或 keep-alive。
- 不提供沙箱/样式隔离配置、props 双向通信、global state 或应用间事件总线。
- 未验证 SSR；`qiankun`/`loadMicroApp` 只在浏览器 effect 中执行，模块本身是客户端子路径。
- 未验证真实 qiankun 主应用框架、微应用嵌套或生产 CDN；测试使用同源静态 fake entry。
- qiankun 作为可选 peer，由 host 应用安装；未安装时导入 `./host` 会失败，不影响只使用 Node 构建插件的应用。

## 4. 验证

验证环境：`qiankun@2.10.16`、React 19.3.1、同源 fake entry、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/browser/qiankun-host.test.ts` | dev/typecheck/build/preview：mount 显示子应用、unmount 清理、remount；无开发覆盖层 |
| 安装包 `qiankun-host` consumer | 离线安装（含 qiankun）、typecheck、公共类型、dev/build/preview 浏览器验收 |
| `pnpm check` | 573/573 |
| `pnpm test:browser` | 61/61 |
| `pnpm test:package` | 83 阶段（`CORMI_PACKAGE_ONLY=qiankun-host`；全量 359 因宿主磁盘未重跑） |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/f6-qiankun-host-validation.json)。

## 5. 下一步

- F6 剩余：qiankun 全局 `registerMicroApps`/函数式 activeRule、Module Federation SSR、多 builder/MFSU、dva 自动发现/immer；
- U33 按语言拆分、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
