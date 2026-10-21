# U16-1：UI locale 归一化与资源解析

日期：2026-10-22。本切片补齐 locale 与 Antd/dayjs 官方资源的连接层：统一 locale 标签、生成回退链、按应用提供的资源表选择官方 locale 对象或加载函数，并在语言切换时重新渲染。cormi 不内置 antd/dayjs，也不复制其 locale 数据。

## 1. 使用方式

```tsx
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { useLocaleResource } from '@cormijs/runtime';

const antdLocales = { en_US: enUS, zh_CN: zhCN };
const dayjsLoaders = {
  'zh-cn': () => import('dayjs/locale/zh-cn'),
  en: () => import('dayjs/locale/en'),
};

export function UiLocale({ children }) {
  const antd = useLocaleResource(antdLocales);
  const dayjsLoader = useLocaleResource(dayjsLoaders);
  useEffect(() => {
    if (!dayjsLoader.resource) return;
    void dayjsLoader.resource().then(() => dayjs.locale(dayjsLoader.key));
  }, [dayjsLoader.key, dayjsLoader.resource]);
  return <ConfigProvider locale={antd.resource}>{children}</ConfigProvider>;
}
```

`UiLocale` 放在应用 `rootContainer` 或根布局中；语言切换由 `LocaleProvider` 触发，两个 `useLocaleResource` 自动更新。`useLocaleResource` 还返回 `direction`（见 [U16-2](124-u16-rtl.md)），可传给 `ConfigProvider` 的 `direction`。

## 2. 契约与语义

- **归一化**：`normalizeLocaleTag(input)` 接受 `en_us.UTF-8`、`zh-hant-tw`、`es-419` 等写法，输出 `en-US`、`zh-Hant-TW`、`es-419`；去掉 `@modifier` 与编码后缀；语言小写、Script 首字母大写、REGION 大写。非法/空标签返回 undefined。
- **回退链**：`localeCandidates(locale)` 依次给出完整标签、语言-Script（存在时）、语言，例如 `zh-Hant-TW → zh-Hant-TW, zh-Hant, zh`；`en-US → en-US, en`。`dayjsLocaleCandidates` 返回其小写形式（`zh-CN → zh-cn, zh`）。
- **资源解析**：`resolveLocaleResource(locale, resources)` 将资源键同样归一化（`zh_CN` 与 `zh-CN` 等价）后沿回退链匹配，返回 `{ locale, value }`；键重复时先出现的生效，非法键跳过。
- **Hook**：`useLocaleResource(resources, fallback='en')` 读取当前 locale（无 Provider 时用 fallback），返回 `{ locale, key?, resource? }`；locale 变化时重新计算并触发渲染。
- **校验**：resources 不是对象时抛 `LOCALE_RESOURCE_INVALID`。
- **不做转换**：资源内容由应用提供；cormi 不校验 Antd locale 的字段或 dayjs 模块是否存在。

## 3. 边界

- 不随包分发 antd、dayjs 或它们的 locale 模块；未安装依赖时不会自动加载。
- 不处理 `zh-Hant → zh-TW` 这类“Script 到 Region”的官方映射；dayjs 候选是纯大小写转换，应用可在自己的资源表中提供别名。
- 不做 RTL、主题、日期库全局默认、SSR 语言协商或按请求 locale 注水。
- `useLocaleResource` 每次渲染比较 resources 引用；资源表应在模块级定义，避免每次渲染新建对象。
- 只覆盖 Antd/dayjs 类资源选择，不包含 ProLayout/Antd 组件封装（U17）。

## 4. 与 Umi 的差异

| 方面 | Umi 4 | cormi U16-1 |
| --- | --- | --- |
| Antd locale | 插件内置映射 | 应用提供资源表，cormi 解析 |
| dayjs locale | 插件内置映射 | 应用提供加载函数 |
| 语言切换 | locale 插件联动 | LocaleProvider + useLocaleResource |
| 数据内置 | 是 | 否 |
| RTL/主题 | 生态方案 | 未提供 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/ui-locale.test.ts` | 标签归一化、回退链、dayjs 候选、资源键等价、重复键、非法输入 |
| `tests/browser/locale.test.ts` | `useLocaleResource` 随中英切换更新，reload 后保持；既有格式化/订阅用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u16-ui-locale-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u16-ui-locale-validation.json)。

## 6. 下一步

- U17 官方 Antd/ProLayout 集成包与主题/图标/图表；
- U16 剩余：按请求 locale、RTL 与官方 Script→Region 别名表。
