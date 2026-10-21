# cormi F5l：ICU 消息子集

日期：2026-10-21。本切片补齐 U16 的消息语法部分：`@cormijs/runtime` 内置零依赖的 ICU MessageFormat 子集，`useIntl().t`、`tp` 与 `FormattedMessage` 在传入值时按 ICU 规则格式化。不引入 formatjs/react-intl，也不改变消息目录的扁平 JSON 约定与编译流程。

## 1. 使用方式

```jsonc
// src/locales/en.json
{
  "guests": "{count, plural, offset:1 =0 {no guests} =1 {just you} other {you and # others}}",
  "reply": "{gender, select, female {She replied} male {He replied} other {They replied}}",
  "total": "Total {amount, number} ({fee, number, percent} fee)",
  "day": "Updated {when, date, short}"
}
```

```tsx
const { t, tp } = useIntl();
t('guests', { count: 3 });                  // you and 2 others
t('guests', { count: 0 });                  // no guests
t('reply', { gender: 'female' });           // She replied
t('total', { amount: 1234.5, fee: 0.25 });  // Total 1,234.5 (25% fee)
tp('items', 2);                             // 既有 _one/_other 复数选择，同样支持 ICU 文本
```

纯函数入口：`formatIcu(message, values, locale)`，从 `@cormijs/runtime` 导出，供非 React 场景或测试使用。

## 2. 契约与语义

- 语法范围：
  - 简单参数 `{name}`；
  - `{n, number}`、`{n, number, integer}`、`{n, number, percent}`；`date`/`time` 支持 `short`/`medium`/`long`/`full` 样式；
  - `plural`、`selectordinal`、`select`，选项体可嵌套任意上述节点；
  - `plural`/`selectordinal` 支持 `offset:N`（非负整数）与 `#`；`select` 必须提供 `other`；
  - 单引号字面量：`''` 表示 `'`，`'{...}'`、`'#'` 等按 ICU 规则原样输出，被引用的 `#` 不受计数替换。
- 选择规则：显式 `=N` 匹配**原始值**；`offset` 只在选择复数类别与替换 `#` 时扣除（与 FormatJS 10.7.18 `formatters.js` 的实现一致）。示例中 `count=2` 且 `offset:1` 命中 `=2`（若有），否则按类别 `one`；`#` 为 1。
- 值类型：`string | number`；日期参数接受时间戳或可被 `new Date()` 解析的字符串。数字/日期格式化与复数类别均使用当前语言的 `Intl`。
- 缺值与错误：简单参数缺失时保留字面量 `{name}`（与 F3a 的 `t` 行为兼容）；格式化参数或选择参数缺失、语法错误、`select` 缺 `other`、非法 offset 均抛 `TypeError`，code 为 `LOCALE_INVALID`。
- 解析时机：`t(key)` 不传值时不解析，原样返回目录文本（避免存量消息中的花括号被误判）；传入值时才解析。`tp` 总会格式化，因为 `count` 一定存在。
- 缓存：解析结果不跨调用缓存；`Intl.NumberFormat`/`DateTimeFormat` 按 locale 与选项在模块内缓存，`Intl.PluralRules` 每次按需构造。
- 退出：`formatIcu` 是纯函数；Provider 卸载后无监听器或定时器，模块级 `Intl` 格式化器缓存随模块存续。

## 3. 与 Umi 4 的差异

Umi 的 locale 基于 react-intl（formatjs），除 ICU 解析外还提供消息编译、`<Formatted*>` 组件族、富文本标签与 locale 数据。cormi 只实现格式化所需的子集，消息仍是普通 JSON。

| 方面 | Umi 4 | cormi F5l |
| --- | --- | --- |
| 依赖 | react-intl / formatjs | 零依赖内置解析器 |
| ICU 范围 | 完整（含 rich text、骨架、货币等） | 子集：参数/数字/日期/复数/选择/嵌套/引号 |
| 消息编译 | 构建期编译与校验 | 运行时解析，不校验目录 |
| 组件 | `FormattedMessage` 等 | 仅 `FormattedMessage`（复用 `t`） |
| API | `intl.formatMessage` | `formatIcu` 纯函数 + `useIntl` |

## 4. 限制

- 不支持 rich text/XML 标签（如 `<bold>…</bold>`）、`number` 骨架（`::currency/USD`）、货币代码、时区选项与相对时间；
- 不生成消息 AST、不做编译期校验或消息提取；
- 日期/时间格式依赖宿主 `Intl` 与本地时区，`date`/`time` 不能指定 `timeZone`；
- `number`/`date` 参数若无法转换为有效数字/日期，交给 `Intl` 处理（可能输出 `NaN` 或抛 `RangeError`），框架不额外包装；
- 引号规则覆盖 `{`、`}`、`#`、`'` 的常见用法，不承诺与 ICU 的所有边界行为逐字节一致；
- `t(key)` 不传值时不做解析，因此同一 key 在传值前后可能对非法语法表现不同（前者原样返回，后者抛错）。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/icu.test.ts`（插值、plural/selectordinal、offset、select、嵌套、格式化、引号、非法输入） | 7/7 |
| `tests/browser/locale.test.ts`（dev/build/preview 中的 ICU 复数、精确匹配、select、数字/百分比与 `FormattedMessage`） | 1/1 |
| `pnpm check` | 524/524，0 失败/取消/跳过（F5k 为 517，新增 7 项；约 113 秒） |
| `pnpm test:browser` | 49/49，0 失败/取消/跳过（约 535 秒） |
| `pnpm test:package` | 310 阶段通过（完整套件；locale consumer 的公共类型新增 `formatIcu` 断言，页面新增 ICU 断言） |

独立包消费断言：安装后的 `locale` consumer 在 `types.mts` 中使用 `formatIcu` 的公开签名并以 `@ts-expect-error` 校验布尔值被拒绝；dev、build 与静态 preview 的页面均渲染 ICU 复数/offset/select/数字结果，语言切换后断言中文消息与格式化。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5l-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U16 剩余：相对时间、富文本消息与 Antd/dayjs 语言联动；
- U32/U34/U35：SSR、MPA、生产 API 路由；U25 externals/runtimePublicPath；
- U17 UI adapter；F6 多 builder 与微前端。
