# cormi F3a：locale、useIntl 与 FormattedMessage

日期：2026-10-20。本切片交付 F3 的第一部分：显式启用的 `localePlugin` 为应用配置登记 `locale`，浏览器 Provider 提供当前语言、切换、持久化、回退和消息格式化 Hook。消息文件自动发现、Antd/ProLayout 语言联动、复数/日期/数字格式化和 SSR 尚未交付。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, localePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'locale', plugin: localePlugin, options: { id: 'application:locale' } },
  ],
  app: { base: '/locale/' },
});
```

```tsx
// src/app.tsx
import { defineApp } from '@cormijs/runtime';

export default defineApp({
  locale: {
    default: 'zh',
    fallback: 'en',
    storageKey: 'demo:locale',
    messages: {
      en: { title: 'Locale demo', greeting: 'Hello, {name}', switch: '切换到中文' },
      zh: { title: '语言演示', greeting: '你好，{name}', switch: 'Switch to English' },
    },
  },
});
```

```tsx
import { FormattedMessage, useIntl } from '@cormijs/runtime';

const { locale, setLocale, t } = useIntl();
<button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>{t('switch')}</button>
<p>{t('greeting', { name: 'Ada' })}</p>
<FormattedMessage id="greeting" values={{ name: 'Grace' }} />
```

`localePlugin` 是普通原生 Cordis 插件：`inject: ['react']`，登记一个 `locale` app-config key 和 runtime Provider，均随 `ctx.effect` 撤回。未启用插件时 `useIntl`/`FormattedMessage` 明确失败。

## 2. 语义

| 配置 | 规则 |
| --- | --- |
| `default` | 默认语言；缺省为 fallback 或 `en` |
| `fallback` | 消息缺失时的回退语言；若提供，必须有对应消息表 |
| `messages` | `语言 -> { key: string }`；值必须是字符串 |
| `storageKey` | localStorage key，默认 `cormi:locale` |

初始化顺序：

1. 读取 localStorage；仅当该语言存在消息表（或没有消息表）时采用；
2. 否则使用 `default`；
3. `setLocale(next)` 校验非空；有消息表时必须是已知语言，否则抛出 `LOCALE_UNKNOWN`；
4. 切换成功后尽力写入 localStorage，存储失败不阻塞应用；
5. Provider 每个挂载独立；刷新页面从持久化恢复。

`t(key, values?)` 按当前语言、fallback、key 本身依次查找；`{name}` 占位符用 values 替换，缺失的占位符保持原样。`FormattedMessage` 在消息缺失且提供 `defaultMessage` 时显示默认文案。

Provider 位于 Router 外、模型 Provider 外；模型与路由组件都能使用 `useIntl`。语言切换会触发 Provider 下的整棵应用树重新渲染。

## 3. 与 Umi 4 的差异

参考 Umi 4.7.25 的 `packages/plugins/src/locale.ts` 与 locale 文档：

| 方面 | Umi | cormi F3a |
| --- | --- | --- |
| 消息来源 | 约定目录自动发现 | app.tsx 的 locale.messages |
| 启用方式 | locale 插件/配置 | 显式 localePlugin |
| 切换与持久化 | 支持 | 支持，localStorage 可配置 |
| 回退 | 支持 | 支持 default/fallback |
| 格式化 | useIntl/FormattedMessage，含更多能力 | t + 简单占位符 + FormattedMessage |
| Antd/UI 语言联动 | 官方集成 | 尚未交付 |
| 复数/日期/数字 | 支持 | 尚未交付 |
| SSR/hydration locale | 支持 | 尚未交付 |

本切片不承诺 Umi locale API 或消息目录的二进制兼容。

## 4. 限制

- 只接受内联 `messages`，不扫描 `src/locales/*` 或 Umi 消息目录；
- 不做复数、日期、数字、时区等 Intl 格式化；
- 不自动同步 Antd/ProLayout 等 UI 库语言；
- 不支持 SSR/hydration 或服务端语言协商；
- 消息表必须是字符串值；切换未知语言会明确失败；
- localStorage 持久化是 best-effort，不提供跨标签同步；
- `locale` key 运行前必须由插件登记；多个 locale 插件贡献会因 key/hook 冲突失败。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/locale.test.ts`（贡献、key、非法选项、卸载） | 2/2 |
| `tests/browser/locale.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 464/464，0 失败/取消/跳过（F2c 为 462，新增 2 项；约 111 秒） |
| `pnpm test:browser` | 30/30，0 失败/取消/跳过（F2c 为 29，新增 locale 用例；约 316 秒） |
| `pnpm test:package` | 165 阶段满足预期（F2c 为 157，新增 8 个 locale 阶段） |
| `examples/locale` prepare + typecheck | 退出 0 |

浏览器验收覆盖：默认语言、消息插值、FormattedMessage、缺失 key 的 fallback、切换到中文、刷新后从 localStorage 恢复、再切回英文；开发与生产 preview 一致。独立打包消费覆盖 locale 插件公开类型、IntlApi/useIntl/FormattedMessage、开发、构建与静态预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f3a-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- F3b：access.ts/useAccess/Access 与路由访问控制，基础 Hook/组件已由 [F3b](70-f3b-access.md) 交付；
- F3c：layout/menu/面包屑与 UI adapter；
- locale 后续：消息目录、复数/日期/数字格式、UI 库语言联动与 SSR。
