# cormi F4i：菜单折叠状态与目录化菜单标题

日期：2026-10-20。本切片补齐 U15 的两项易用性缺口：`menuPlugin` 提供折叠状态（`useMenuCollapse`，可选 `localStorage` 持久化），菜单与面包屑标题支持 `meta.locale` 消息 key（配合 F4h 的消息目录或 `app.tsx` 的 locale 配置）。不包含 ProLayout/Antd 等 UI adapter，也不做路由级 layout 插槽。

## 1. 使用方式

```ts
import { localePlugin, menuPlugin } from '@cormijs/plugin-react';

plugins: [
  { id: 'locale', plugin: localePlugin, options: { id: 'app:locale', directory: 'src/locales' } },
  { id: 'menu', plugin: menuPlugin, options: { id: 'app:menu', collapse: { storageKey: 'app:menu:collapsed', defaultCollapsed: false } } },
]
```

```ts
// src/locales/en.json    { "menu.team": "Team" }
// src/locales/zh-CN.json { "menu.team": "团队" }
```

```tsx
// 应用外壳
import { useMenu, useMenuCollapse } from '@cormijs/runtime';
const { collapsed, setCollapsed, toggle } = useMenuCollapse();
// 菜单项：{ item.title } 已按当前语言解析，item.locale 保留原始 key
```

## 2. 契约与语义

- 提供者：`cormi:menu`（`inject: ['react']`，runtime stage 20，位于 initialState/access 之内层）；`collapse` 通过 RuntimeContribution 的 `options` 传给 `MenuProvider`，不新增 app 配置 key；
- 折叠状态：`useMenuCollapse()` 返回 `{ collapsed, setCollapsed, toggle }`；初始值优先读 `localStorage[storageKey]`（`'true'`/`'false'`），否则用 `defaultCollapsed`，最后为 `false`；写入为尽力而为，隐私模式或无 `window` 时不报错；未启用插件时 `useMenuCollapse` 抛 `MENU_MISSING`，`setCollapsed` 非布尔值抛 `MENU_INVALID`；
- 标题解析顺序：`meta.locale` 在当前语言（含 fallback 表）命中 → 使用消息文本；否则 `meta.title` → `meta.name`；没有 locale provider 或未命中 key 时绝不显示原始 key；`MenuItem.locale` 保留原始 key 供外壳自定义渲染；
- 选项校验：`collapse` 只接受 `storageKey`（非空、≤128、无控制字符）与 `defaultCollapsed`（布尔），未知 key 或非对象值以 `MENU_INVALID` 在插件激活阶段失败；
- locale 读取：`IntlApi` 新增 `peek(key)`（未命中返回 `undefined`，不做 key-as-text 回退），菜单与面包屑只用它，避免把未翻译的 key 当标题；
- 退出：卸载 `menuPlugin` 后 Provider 贡献与折叠状态一起消失，生成入口不再出现 `menuRuntime`/`"collapse"`。

## 3. 与 Umi 4 的差异

Umi 的 layout 插件（`packages/plugins/src/layout.ts`）直接产出一个 `<ProLayout>` 外壳：`:150` 与 `:261` 引入并渲染 ProLayout，`:272` 把 plugin-locale 的 `formatMessage` 交给它，`:273` 用 `menu={{ locale: userConfig.locale }}` 决定菜单取 key 的语言，`:366-369` 还导出 `childrenRender` 等外壳插槽。也就是说 Umi 的折叠与标题解析是 ProLayout 组件行为；cormi 不引入 ProLayout，只交付与 UI 无关的状态与解析原语（外壳组件与样式由应用实现），也不提供 `childrenRender` 类插槽。本切片不声称已复刻 ProLayout 的折叠持久化细节，只提供自身的等价能力。

| 方面 | Umi 4 layout | cormi F4i |
| --- | --- | --- |
| 菜单数据来源 | 路由 + plugin 配置 | `useMenu()` 路由树派生 |
| 标题多语言 | `locale` key + formatMessage | `meta.locale` + `IntlApi.peek` |
| 折叠 | ProLayout 组件内部状态 | `useMenuCollapse` + 可配置 storageKey |
| UI 组件 | 依赖 Ant Design Pro | 无 UI 依赖，外壳自行渲染 |

## 4. 限制

- 折叠状态是单一布尔值，不支持多侧栏、断点记忆或动画协调；
- `toggle` 不写入 `localStorage` 之外的存储，也不跨标签页同步（无 `storage` 事件监听）；
- 菜单标题只在 locale 变化时重算，消息文本不支持富文本或 React 节点；
- 不提供 `menuRender`/插槽、图标字段与徽章字段；ProLayout/Antd adapter 仍属 U17 待办；
- 折叠状态不参与访问控制，隐藏菜单项仍须用 `meta.hideInMenu`/`access`。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。开发过程中真实暴露两处问题：包消费脚本与菜单测试的变量/断言未同步（生成串形状是 `options:{"collapse":…}` 而非紧凑形式）、菜单 fixture 未创建 `src/locales` 目录且遗漏 `localePlugin` 导入；均在冻结验证前修复，本切片未新增示例工程，而是加强既有菜单 fixture、浏览器用例与包消费断言。

| 检查 | 结果 |
| --- | --- |
| `tests/menu.test.ts`（provider 贡献与撤回、collapse 选项进入生成串、非法选项拒绝） | 4/4（F4h 为 2 项，新增 2 项） |
| `tests/browser/menu.test.ts`（dev、typecheck、build、preview） | 1/1（加强：折叠切换 + 刷新后保持 + 目录化标题） |
| `pnpm check` | 494/494，0 失败/取消/跳过（F4h 为 492，新增 2 项；约 107 秒） |
| `pnpm test:browser` | 40/40，0 失败/取消/跳过（约 424 秒） |
| `pnpm test:package` | 237 阶段通过（沿用既有 menu 消费阶段并加强断言，未新增阶段） |

菜单浏览器与独立包消费验收断言：菜单项显示 `Team from catalog`（来自 `src/locales/en.json` 的 `menu.team`）而不是 `meta.title`、面包屑同样使用目录标题、`useMenuCollapse` 初始为 false、点击折叠后为 true、`page.reload()` 后仍为 true（localStorage 持久化生效）、再次点击回到 false、访问过滤与选中项断言全部保持、无控制台错误与开发覆盖层。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4i-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U15/U17：可选 ProLayout/Antd UI adapter（外壳组件、图标、徽章）；
- F4 后续：微生成器（U27，需先扩展 CLI 的多参数命令解析）、工程命令（U28）、输出与资源策略（U25）；
- F5：client loader 与预取（U13/U31）、SSR（U32）、静态导出（U33）。
