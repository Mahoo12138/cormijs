# F6-5：qiankun UMD/HTML 入口

日期：2026-10-25。本切片让子应用在正常构建产物旁生成 `qiankun.js`（UMD）与 `qiankun.html`；UMD 暴露 F6-4 的 bootstrap/mount/unmount/update，dev 仍保持普通自动挂载。主应用注册仍由 qiankun host 负责。

## 1. 使用方式

```ts
import { qiankunPlugin } from '@cormijs/plugin-qiankun';
export default defineConfig({
  plugins: [{ id: 'qiankun', plugin: qiankunPlugin, options: { name: 'CormiMicroApp', mountId: 'root' } }],
  app: { base: '/sub/' },
});
```

构建后：

```text
dist/index.html       # 普通应用
dist/assets/*
dist/qiankun.js       # UMD，window.CormiMicroApp
dist/qiankun.html     # 加载 qiankun.js
dist/qiankun.css      # 如应用有 CSS
```

主应用按 qiankun 常规方式注册：

```ts
registerMicroApps([{ name: 'CormiMicroApp', entry: '//localhost:8000/qiankun.html', container: '#sub', activeRule: '/sub' }]);
```

## 2. 契约与语义

- `qiankunPlugin`（`cormi:qiankun`，`inject: ['vite']`）校验 id/UMD 全局名/mountId，并在主构建 `closeBundle` 后额外执行一次 Vite library build。
- 生成的 `.cormi/qiankun.ts` 先设置 `globalThis.__CORMI_MICRO_APP__ = true`，再动态导入生成的 `cormiApplication`，因此普通入口不会自动挂载到 `#root`；dev 模式不设置该标记，行为不变。
- UMD 内含 React/router/应用代码（`inlineDynamicImports`），全局名为 `name`，导出四个 lifecycle；`qiankun.html` 引用同目录 UMD，存在 CSS 时附带 `qiankun.css`。
- UMD 的 base 使用应用 `app.base`；宿主 activeRule 应与该 base 匹配。mount 的容器与 mountId 由 F6-4 适配器处理。
- `qiankun.html` 只加载脚本，不包含普通 index.html 的 head/meta；SEO/head 不适用于微前端容器。
- 清理：构建结束删除临时 `.cormi/qiankun.ts`；失败以 `QIANKUN_BUILD_FAILED` 结束，不伪造成功产物。

## 3. 边界

- 不提供 qiankun 主应用插件/注册 API、activeRule 与菜单集成；host 仍调用 qiankun 自身 `registerMicroApps`/`loadMicroApp`。
- 不生成 Module Federation、single-spa 或 webpack 产物；仅 Vite UMD。
- UMD 打包应用依赖，不共享宿主 React；不做 externals、沙箱样式隔离或 CSS 去重。
- 不处理 publicPath、CDN、跨域/CORS 或 qiankun 的 props/global state；跨域 entry 需宿主配置。
- 未验证真实 qiankun host；浏览器测试直接加载 UMD 并调用 lifecycle。UMD base 测试通过 `history.replaceState` 对齐。
- 安装包 consumer 已加入 `qiankun` 阶段；离线 store 补齐 Babel/rollup 平台包后通过（`CORMI_PACKAGE_ONLY=qiankun`）。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/browser/qiankun.test.ts` | dev 正常自动挂载；build 生成 qiankun.js/html；preview 加载 UMD、mount/render/increment/unmount |
| 安装包 `qiankun` consumer | 离线安装、typecheck、公共类型、dev/build/preview UMD 生命周期验收（83 阶段子集） |
| `pnpm check` | 573/573 |
| `pnpm test:browser` | 60/60 |
| `pnpm test:package` | 83 阶段（`CORMI_PACKAGE_ONLY=qiankun`；全量 359 因宿主磁盘未重跑） |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/f6-qiankun-umd-validation.json)。

## 5. 下一步

- F6 剩余：qiankun host 注册/菜单集成、Module Federation、多 builder/MFSU、dva 自动发现/immer；
- 全量安装包矩阵仍受宿主磁盘限制；
- U33 按语言拆分、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
