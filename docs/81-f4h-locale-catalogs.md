# cormi F4h：消息目录约定（`src/locales/<locale>.json`）

日期：2026-10-20。本切片补齐 U16 的消息文件部分：`localePlugin` 增加可选 `directory`，在 Node 侧读取项目内的 `<locale>.json` 目录并以内联 JSON 写入生成入口，浏览器端不再自己 fetch 语言文件。复数/日期/数字格式化、按语言拆分的懒加载与 UI 库语言联动仍未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { localePlugin, appRuntimePlugin } from '@cormijs/plugin-react';

plugins: [
  { id: 'app-runtime', plugin: appRuntimePlugin },
  { id: 'locale', plugin: localePlugin, options: { id: 'application:locale', directory: 'src/locales' } },
]
```

```json
// src/locales/en.json    { "greeting": "Hello {name}" }
// src/locales/zh-CN.json { "title": "目录标题", "greeting": "你好 {name}" }
```

```tsx
// src/app.tsx —— 同名 key 仍以配置为准
export default defineApp({ locale: { default: 'en', messages: { en: { title: 'Configured title' } } } });
```

```tsx
import { FormattedMessage, useIntl } from '@cormijs/runtime';
const { t, setLocale, locale } = useIntl();
// t('greeting', { name: 'Ada' })、<FormattedMessage id="greeting" values={{ name: 'Ada' }} />、setLocale('zh-CN')
```

示例：`pnpm cormi dev --root examples/locale-catalog`，默认监听 `/locale-catalog/`。

## 2. 契约与语义

- 提供者：`cormi:locale` 插件通过新增的 `ctx.react.locale-catalog` OrderedHooks 贡献 `LocaleCatalogSource`（`{ id, directory? }`），`inject: ['react']`；不设置 `directory` 时该来源不读取任何文件；
- Node 侧读取：`readLocaleCatalogs(root, sources)` 按来源顺序合并目录；目录缺失即不启用；每个目录 ≤32 个 `*.json`，文件名必须是 locale code（`^[a-zA-Z]{2,3}([-_][A-Za-z0-9]{2,4})*$`），单文件 ≤64 KiB，内容必须是 key→string 的扁平对象（key ≤128、value ≤2048、每表 ≤512 key），非 UTF-8 JSON 或形状不符以 `LOCALE_INVALID` 失败；
- 合并：同一 locale 的多个来源合并不同 key，重复 key 抛 `LOCALE_CONFLICT`；生成入口把结果作为 JSON 字面量交给运行时 `applyLocaleCatalogs(config, catalogs)`，`app.tsx` 的 `locale.messages` 逐 key 覆盖目录值；
- 生成与类型：`.cormi/app.tsx` 内 `appConfig:applyLocaleCatalogs(resolveAppConfig(applicationConfig,[...]), [{"locale":"en",...}])`，目录内容随构建内联，浏览器不发额外请求；
- 开发循环：目录内文件名列表与文件内容进入 `repairSignature` 观测集，新增/删除/修改 `<locale>.json` 会触发生成更新；
- 观测：`.cormi/inspect.jsonc` 的 `summary.localeCatalogs` 记录每个 locale 的 key 数量（不复制文案内容），hooks 快照含 `locale-catalog-hook`；
- 退出：卸载插件后 provider 贡献与目录内联一起撤回。

## 3. 与 Umi 4 的差异

Umi 的 locale 插件位于 `packages/plugins/src/locale.ts`：`localeFolder: 'locales'`（`:100`）自动发现消息目录，`baseNavigator`（`:20,42`）按浏览器语言选择，检测到 antd 时注入其语言包（`:36-45,87`），并配合 `moment2dayjs`（`:114`）。cormi 只提供消息表本身：语言切换与持久化沿用 F3a 的 `useIntl`/`localStorage`，UI 库语言与浏览器语言探测交给可选 adapter。

| 方面 | Umi 4 | cormi F4h |
| --- | --- | --- |
| 启用 | 配置存在即启用 | 显式 localePlugin 实例 |
| 目录 | `src/locales` 固定自动发现 | `options.directory` 显式开启 |
| 文件类型 | `.ts`/`.js`/`.json` | 仅 `.json`（TS 文件可继续用 app 配置） |
| 交付形式 | 运行时按需加载 | 构建期内联进生成入口 |
| key 冲突 | 未定义显式规则 | 同 locale 重复 key 直接失败 |

## 4. 限制

- 不做复数、插值格式化（仅 `{name}` 简单替换）、日期/数字/货币格式化；
- 不做按语言代码分割或运行时懒加载：目录内容全部内联，超大文案集应改用应用自己的加载策略；
- 不生成 locale key 的联合类型，`t()` 的参数仍是 `string`；
- 不联动 Antd/dayjs 等第三方语言包，也不写入 `<html lang>`；
- 单一 locale 表上限 512 key、目录上限 32 文件、单文件 64 KiB，超出即失败而不是截断。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。开发阶段暴露一处真实缺陷：目录内联误用了 `jsonData()`（返回结构化值而非源码字面量），生成的入口语法非法并被既有的 esbuild 校验拦下（`Expected "]" but found "Object"`），改为 `JSON.stringify` 后重测；工作区类型检查还暴露了包消费脚本中的变量重名，均在冻结验证前修复。

| 检查 | 结果 |
| --- | --- |
| `tests/locale-catalog.test.ts`（来源校验、目录缺失、locale code/JSON/形状拒绝、合并与冲突、生成内联与撤回） | 3/3 |
| `tests/browser/locale-catalog.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 492/492，0 失败/取消/跳过（F4g 为 489，新增 3 项；约 106 秒） |
| `pnpm test:browser` | 40/40，0 失败/取消/跳过（F4g 为 39，新增 1 项；约 421 秒） |
| `pnpm test:package` | 237 阶段通过（F4g 为 229，新增 8 个 locale-catalog 阶段） |
| `examples/locale-catalog` prepare + typecheck | 退出 0 |

浏览器与独立包消费验收断言：en 下 `title` 取 `app.tsx` 的 “Configured title”、`greeting`/`fromCatalog` 取目录、切换到 `zh-CN` 后三项均来自 `src/locales/zh-CN.json`（含中文插值 “你好 Ada”）、切回 en 后配置值仍然优先、语言选择经 `localStorage` 持久化、无控制台错误与开发覆盖层。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4h-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U16 剩余：消息格式化（复数/日期/数字）、locale key 类型、UI 库语言联动；
- F3 剩余：菜单折叠 helper 与 ProLayout/Antd adapter（U15/U17）；
- F4 后续：微生成器（U27）、工程命令（U28）、输出与资源策略（U25）；
- F5：client loader 与预取（U13/U31）、SSR（U32）、静态导出（U33）。
