# cormi F5m：相对时间格式化

日期：2026-10-21。本切片补齐 U16 的相对时间能力：`useIntl().formatRelativeTime` 与纯函数 `formatRelativeTimeFor` 基于平台 `Intl.RelativeTimeFormat`，跟随当前语言与切换，供“2 天前”“昨天”“3 小时后”一类文案使用。不引入 dayjs 或 formatjs。

## 1. 使用方式

```tsx
const { formatRelativeTime } = useIntl();
formatRelativeTime(-2, 'day');                                  // en: 2 days ago；zh: 2天前
formatRelativeTime(-1, 'day', { numeric: 'auto' });             // en: yesterday；zh: 昨天
formatRelativeTime(3, 'hour');                                  // en: in 3 hours；zh: 3小时后
```

非 React 场景使用纯函数：

```ts
import { formatRelativeTimeFor } from '@cormijs/runtime';
formatRelativeTimeFor('de', -2, 'day'); // vor 2 Tagen
```

时间差由调用方计算（`Date.now() - updatedAt` 等），格式化不读取“当前时间”。

## 2. 契约与语义

- 以当前 locale（含切换后的值）构造 `Intl.RelativeTimeFormat`；`options` 原样透传（如 `numeric: 'auto'`、`style: 'short'`）；
- `value` 必须是有限数字；负数表示过去、正数表示将来；
- `unit` 必须是 `Intl.RelativeTimeFormatUnit` 的 16 个合法值之一（单复数形式均可），类型层与运行时都校验；
- 非法数字或 unit 抛 `TypeError`（`LOCALE_INVALID`）；平台 `Intl` 对非法 options 抛出的 `RangeError` 不包装；
- 不缓存格式化器：每次调用按 locale 与 options 构造，行为与 `formatNumber`/`formatDate` 一致；
- Provider 卸载后无监听器或定时器；语言切换后新调用使用新 locale；
- 不做自动刷新：跨分钟/跨天更新需要调用方按需重渲染。

## 3. 与 Umi 4 的差异

Umi 的 `useIntl()` 来自 react-intl，`formatRelativeTime` 由 formatjs 与 locale 数据实现；cormi 直接用宿主 `Intl.RelativeTimeFormat`，不携带 locale 数据或 polyfill。

| 方面 | Umi 4 | cormi F5m |
| --- | --- | --- |
| 实现 | react-intl / formatjs | 平台 `Intl` |
| 语言数据 | 随 react-intl 依赖 | 宿主 ICU 数据 |
| 自动刷新 | 无（同） | 无 |
| 纯函数入口 | `intl.formatRelativeTime` | `formatRelativeTimeFor` |

## 4. 限制

- 输出取决于宿主 ICU 数据，Node 与浏览器版本差异可能导致措辞不同；
- 只提供格式化，不提供“多久以前”的自动计时、阈值或日历日计算；
- 不支持自定义单位表、相对时间消息模板或时区参数；
- `numeric: 'auto'` 的可用措辞由平台决定（如中文“昨天”），不是框架维护的文案；
- 尚未与 `FormattedRelativeTime` 组件族或 UI 库联动。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/locale-formatting.test.ts`（en/de/zh、`numeric: auto`、非法数字与 unit） | 4/4 |
| `tests/browser/locale.test.ts`（dev/build/preview 中 en/zh 相对时间与切换） | 1/1 |
| `pnpm check` | 525/525，0 失败/取消/跳过（F5l 为 524，新增 1 项；约 114 秒） |
| `pnpm test:browser` | 49/49，0 失败/取消/跳过（约 523 秒） |
| `pnpm test:package` | 310 阶段通过（完整套件；locale consumer 的公共类型新增 `formatRelativeTimeFor` 断言） |

独立包消费断言：安装后的 `locale` consumer 在 `types.mts` 中使用 `formatRelativeTimeFor` 的公开签名，并以 `@ts-expect-error` 校验非法 unit 被拒绝；页面在 dev、build 与静态 preview 中渲染相对时间，语言切换后断言中文输出。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5m-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U16 剩余：富文本消息与 Antd/dayjs 语言联动；
- U32/U34/U35：SSR、MPA、生产 API 路由；U25 externals/runtimePublicPath；
- U17 UI adapter；F6 多 builder 与微前端。
