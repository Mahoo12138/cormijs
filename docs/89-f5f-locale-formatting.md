# cormi F5f：数字/日期格式化与复数消息

日期：2026-10-20。本切片补齐 U16 的格式化部分：`useIntl()` 新增 `formatNumber`、`formatDate` 与复数感知的 `tp`，全部基于平台 `Intl`（NumberFormat/DateTimeFormat/PluralRules），不引入 react-intl 或 ICU 解析器。消息仍来自 `app.tsx` 的 `locale.messages` 或 F4h 的目录约定。

## 1. 使用方式

```ts
import { useIntl } from '@cormijs/runtime';

const { formatNumber, formatDate, tp } = useIntl();
formatNumber(1234.5);                                     // en: "1,234.5"；de: "1.234,5"
formatNumber(0.5, { style: 'percent' });                  // en: "50%"
formatDate(Date.UTC(2024, 0, 2), { timeZone: 'UTC', dateStyle: 'short' }); // en: "1/2/24"
tp('items', 5);                                           // items_other → "5 items"
```

```jsonc
// 消息表
{ "items_one": "{count} item", "items_other": "{count} items" }
```

`tp` 根据当前语言用 `Intl.PluralRules` 选择 `${key}_${category}`，缺失时回退 `${key}_other`、`${key}`，再按 fallback 语言重试；`{count}` 与自定义值都会插值。

## 2. 契约与语义

- 纯函数：`formatNumberFor(locale, value, options?)`、`formatDateFor(locale, value, options?)`、`selectPluralKey(messages, locales, key, category)` 从 `@cormijs/runtime` 导出，Provider 的 `IntlApi` 只是把当前语言绑定到它们；
- 校验：`formatNumber` 只接受有限数字，`formatDate` 接受 `Date | number | string` 且必须能解析成有效日期，`tp` 的 count 必须是有限数字；违规抛 `TypeError('LOCALE_INVALID: …')`（与既有 locale 错误的风格一致）；
- 复数类别：由 `Intl.PluralRules(locale)` 决定（en: one/other；zh: other；ru/ar 等多类别同样按平台规则），cormi 不解析 ICU `{count, plural, …}` 语法；
- 消息优先级：`${key}_${category}` → `${key}_other` → `${key}`，先当前语言后 fallback 语言；都没有时返回 key 本身（与 `t` 一致），`peek` 仍是“未命中返回 undefined”的读取口；
- 时区/货币/单位等选项原样透传给 `Intl`，cormi 不维护自己的格式选项白名单；
- 不改变既有 API：`t` 的 `{name}` 插值、`FormattedMessage`、切换与持久化保持原样。

## 3. 与 Umi 4 的差异

Umi 的 locale 插件基于 `react-intl` 3.12.1（`packages/plugins/src/locale.ts:68,244` 与 `packages/plugins/package.json:53`），导出 `formatMessage`、`FormattedNumber`、`FormattedDate`、`FormattedPlural` 等 ICU 能力。cormi 不引入 react-intl：只提供平台 `Intl` 的薄封装与 `_one/_other` 后缀约定，没有 ICU 语法、富文本消息（`FormattedHTMLMessage`）、相对时间与 `IntlProvider` 组合。

| 方面 | Umi 4 / react-intl | cormi F5f |
| --- | --- | --- |
| 复数 | ICU `{count, plural, …}` | `_one`/`_other` 后缀 + PluralRules |
| 数字/日期 | `Formatted*` 组件与 API | `formatNumber`/`formatDate` |
| 相对时间/富文本 | 支持 | 未交付 |
| 依赖 | react-intl | 平台 Intl |

## 4. 限制

- 不支持 ICU 复数/选择语法、`FormattedRelativeTime`、`FormattedList`、富文本消息与插值格式化（数字/日期作为消息参数时按字符串插入）；
- `tp` 的类别由运行时语言决定，切换语言后使用同一条消息表；没有按语言编译消息的构建期优化；
- 不生成 locale key 的联合类型：`t`/`tp` 的 key 仍是 `string`；
- `Intl` 的能力取决于运行环境（Node 22 与 Edge 155 具备完整数据）；不提供 polyfill；
- 格式化不做缓存，高频渲染时可自行 memo。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。本切片未新增示例工程与独立包消费阶段，而是加强既有 locale 用例的断言（同一 stage 数），并用新增的纯函数单元测试覆盖格式化与复数回退。

| 检查 | 结果 |
| --- | --- |
| `tests/locale-formatting.test.ts`（`selectPluralKey` 回退链、数字/日期本地化、非法输入） | 3/3 |
| `tests/browser/locale.test.ts`（dev、typecheck、build、preview，断言加强） | 1/1 |
| `pnpm check` | 511/511，0 失败/取消/跳过（F5e 为 508，新增 3 项；约 134 秒） |
| `pnpm test:browser` | 46/46，0 失败/取消/跳过（未新增用例；约 509 秒） |
| `pnpm test:package` | 286 阶段通过（沿用既有 locale 消费阶段并加强断言，未新增阶段） |

浏览器断言：en 下 `tp('items',1)` 为 `1 item`、`tp('items',5)` 为 `5 items`、`formatNumber(1234.5)` 为 `1,234.5`、`formatDate(..., {timeZone:'UTC', dateStyle:'short'})` 为 `1/2/24`；切到 zh 后同一组调用得到 `5 项`、`1,234.5`、`2024/1/2`（zh 只有 `_other`，验证回退），刷新后语言与格式化结果保持；无控制台错误与开发覆盖层。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5f-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U16 剩余：ICU 复数/相对时间/富文本、locale key 类型生成、Antd/dayjs 语言联动；
- F5h 已交付 pageview 分析，见 [F5h pageview 分析](90-f5h-analytics.md)；U32/U34/U35：SSR、MPA、生产 API 路由；U33 剩余：prerender 与 404.html；
- F4 剩余：U28 工程命令、U25 externals/runtimePublicPath。
