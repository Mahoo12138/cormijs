# cormi F5q：多页应用（MPA）

日期：2026-10-21。本切片交付 U34 的目录约定形态：启用 `mpaPlugin` 后，`src/pages` 下的顶层目录各自成为一个独立 HTML 页面（`home.html`、`admin.html` 等），挂载自己的 React 入口，可由全局或页面级 layout 包装。MPA 页面不构造 SPA 路由与 Provider，构建、开发与预览都与既有单页应用共存。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { mpaPlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'mpa', plugin: mpaPlugin, options: { id: 'application:mpa', mountElementId: 'root', layout: 'src/GlobalMpaLayout.tsx' } }],
});
```

```tsx
// src/pages/home/index.tsx → /home.html
export default function Home() {
  return <main><h1>Home</h1></main>;
}
```

```jsonc
// src/pages/home/config.json（可选）
{ "title": "Home page", "mountElementId": "app", "layout": "src/HomeLayout.tsx" }
```

`layout` 为项目内相对源码文件，默认导出接收 `children` 的 React 组件；页面配置覆盖插件级 `layout`。

开发服务器访问 `/home.html`；构建输出 `dist/home.html`；`cormi preview` 直接提供该文件。`index` 保留给 SPA 的 `index.html`，不能作为 MPA 页面名。

## 2. 契约与语义

- 插件：`cormi:mpa`，`inject: ['vite', 'projectRoot']`；通过 `ctx.vite.add` 注册原生 Vite 插件；
- 布局：插件选项或 `config.json.layout` 指定项目内 `.tsx/.jsx/.ts/.js` 文件，默认导出 `({ children }) => ReactNode`；页面配置优先；布局必须是真实项目文件；
- 发现：仅扫描 `directory`（默认 `src/pages`）的直接子目录；每个目录取 `index.tsx` → `index.jsx` → `index.ts` → `index.js` 中优先级最高的文件；下划线/点开头目录、`node_modules` 与符号链接跳过；最多 32 个页面；
- 配置：可选 `config.json`（≤64 KiB，必须是对象），支持 `title`（默认目录名，≤512 字符、无换行）与 `mountElementId`（默认插件选项或 `root`）；非法值以 `MPA_INVALID` 失败；不从入口模块导出中求值配置；
- 名称：页面名必须匹配安全目录名（≤64 字符），`index` 与下划线开头名称被拒绝；入口 ≤1 MiB；
- 生成：每次 Vite 配置求值时重建 `.cormi/mpa`，为每个页面写 `<name>.html` 与 `<name>.tsx`；入口用 `createRoot` 挂载页面组件（有 layout 时包裹 `<Layout><Page /></Layout>`），找不到挂载点抛 `MPA_MOUNT_MISSING`；HTML 带 charset、viewport、转义后的 title 与 `data:` favicon；
- 构建：向 `build.rollupOptions.input` 加入 `index.html` 与每个生成的 HTML（会覆盖应用自定义 input）；`closeBundle` 只在真实构建时把 `dist/.cormi/mpa/<name>.html` 移动到 `dist/<name>.html` 并删除内部目录；目标文件已存在以 `MPA_OUTPUT_CONFLICT` 失败；
- 开发：中间件把 `/<name>.html`（含配置的 base 前缀）内部重写到 `/.cormi/mpa/<name>.html`，其余路径交给 Vite；
- 预览：使用移动后的 `dist/<name>.html`，没有额外中间件；
- 运行时：每个 MPA 页面是独立 React 根，不继承 SPA 的 router、locale/access/model Provider 或生成入口；layout 只接收 children，不注入 Provider；页面自行负责所需 Provider；
- 退出：卸载插件时删除 `.cormi/mpa`；开发/预览会话随 Vite 关闭释放；页面文件的新增/删除需要重启开发服务。

## 3. 与 Umi 4 的差异

Umi 的 MPA 同样把 `src/pages` 顶层目录作为入口，支持 `config.json`/入口导出配置、模板与 `layout`；cormi 第一版只支持 JSON 配置与独立 React 挂载，不接管模板与布局。

| 方面 | Umi 4 | cormi F5q |
| --- | --- | --- |
| 发现 | 顶层目录 index | 同 |
| 页面配置 | config.json / 入口导出 | 仅 config.json |
| 模板/布局 | 支持 | 未提供 |
| 应用 Wrapper | 支持 | 未提供（页面自行处理） |
| 构建 | webpack/其他 | Vite 多 HTML 输入 + 移动输出 |
| SPA 共存 | MPA 模式替换入口 | 与 SPA 共存，`index` 保留 |

## 4. 限制

- 不生成 Umi 式 `App`/Provider 包装；layout 是显式组件包装，不注入 SPA Provider；
- 只支持 `config.json`，不从入口模块导出读取配置；
- 不提供自定义 HTML 模板、每页 `template` 或 `MPA_FILTER`；layout 每个页面只支持一个，不能嵌套多个 layout 文件；
- 新增/删除页面目录需要重启开发服务；
- `index` 目录被保留，MPA 与 SPA 根页不能同名；
- 构建会覆盖应用的 `build.rollupOptions.input`（本插件接管多入口清单）；
- 不支持 SSR、资源内联策略或每页独立 publicPath；
- 页面入口的样式仍通过自身 import 进入，不做全局样式约定注入。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/mpa.test.ts`（映射/标题转义/挂载点、layout 包装与非法路径、插件装卸与选项） | 3/3 |
| `tests/browser/mpa.test.ts`（dev、typecheck、build、preview 中 home/admin 页面与页面级/全局 layout） | 1/1 |
| `pnpm check` | 535/535，0 失败/取消/跳过（F5p 为 532，新增 3 项） |
| `pnpm test:browser` | 51/51，0 失败/取消/跳过（F5p 为 50，新增 MPA 用例） |
| `pnpm test:package` | 318 阶段通过（完整套件；新增 `mpa` consumer 的安装、typecheck、公共类型、dev、build 与 preview 阶段） |

独立包消费断言：安装后的 `mpa` consumer 导入 `mpaPlugin`/`resolveMpaEntries`/`mpaEntrySource`/`mpaHtml` 与类型，以 `@ts-expect-error` 校验非法 `mountElementId`；dev 与 preview 中 Playwright 打开 `home.html`/`admin.html`，断言标题与页面内容；构建产物 `dist/home.html`、`dist/admin.html` 存在且内部临时 HTML 已移除。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5q-validation.json)；layout 增量见 [MPA layout 证据](../artifacts/f5q-mpa-layout-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U34 后续：自定义模板、布局/App 包装、页面级 Provider 与热更新；
- U32：SSR；U25 externals/runtimePublicPath；
- U16 Antd/dayjs 联动；U17 UI adapter；F6 多 builder 与微前端。
