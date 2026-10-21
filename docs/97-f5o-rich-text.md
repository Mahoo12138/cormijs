# cormi F5o：ICU 富文本消息

日期：2026-10-21。本切片补齐 U16 的富文本部分：ICU 消息中的 `<tag>` 在显式提供标签渲染器时可由 `useIntl().rich()` 或 `FormattedMessage` 的 `tags` 渲染为 React 节点；`t()`/`tp()` 仍返回字符串，标签按原文保留。这样可以在消息目录中表达强调、链接等结构，而不允许消息注入 HTML。

## 1. 使用方式

```jsonc
// src/locales/en.json
{
  "notice": "<b>Hello {name}</b>, you have {count, plural, one {# message} other {# messages}}"
}
```

```tsx
const { rich } = useIntl();
const notice = rich(
  'notice',
  { name: 'Ada', count: 2 },
  { b: children => <strong>{children}</strong> },
);

<FormattedMessage
  id="notice"
  values={{ name: 'Ada', count: 2 }}
  tags={{ b: children => <b>{children}</b> }}
/>
```

纯函数入口（不与 React 绑定）：

```ts
import { formatIcuParts, richNodes } from '@cormijs/runtime';
const parts = formatIcuParts('<b>Hello {name}</b>', { name: 'Ada' }, 'en', ['b']);
// [{ tag: 'b', children: ['Hello ', 'Ada'] }]
```

## 2. 契约与语义

- 语法：`<name>…</name>`，标签名以字母开头、其余为字母或数字（≤32 个渲染器）；可嵌套，标签内可以使用任意已支持的 ICU 参数、复数/选择与 `#`；
- 触发条件：只有 `rich()`/`FormattedMessage` 的 `tags` 与 `formatIcuParts` 显式列出标签名时才解析标签；`t()`/`tp()`/`formatIcu()` 把 `<b>` 当普通文本；
- 严格性：消息中出现未列出的标签、关闭标签不匹配、标签未闭合，均抛 `LOCALE_INVALID`；`<` 后不构成合法标签（如 `<3`、`< b`）保持字面量；单引号引用中的标签保持字面量；
- 值：与 F5l 相同；缺失简单参数保留 `{name}`，缺失格式化/选择参数抛 `LOCALE_INVALID`；
- React 渲染：每个标签渲染器接收已渲染的子节点数组（`ReactNode[]`），可返回元素、字符串或数组；框架用带 key 的 `Fragment` 包裹每个标签结果，不解析 HTML、不执行消息中的脚本；
- 校验：`tags` 必须是普通对象，键符合上述名称规则、值必须为函数；非法表抛 `LOCALE_INVALID`；
- `FormattedMessage`：提供 `tags` 时走富文本路径；此时 `defaultMessage` 不生效（缺失 key 时显示 key），字符串模式行为不变；
- 退出：纯函数与 Provider 回调；卸载后无监听器或定时器。

## 3. 与 Umi 4 的差异

Umi/react-intl 的富文本同样以标签渲染器把消息片段映射为 React 节点；cormi 复用 F5l 的内置 ICU 子集与显式 `tags` 表，不引入 react-intl，也不把标签渲染器放进消息目录。

| 方面 | Umi 4 | cormi F5o |
| --- | --- | --- |
| 依赖 | react-intl | 内置 ICU 解析 |
| 标签来源 | 消息 + 组件 tags | 消息 + `rich`/`FormattedMessage` 的 tags |
| 未列出的标签 | 依实现而定 | `LOCALE_INVALID` |
| 字符串 API | `formatMessage` | `t`/`tp` 保留标签原文 |
| 自定义组件 | 支持 | 支持（渲染函数） |

## 4. 限制

- 只支持成对标签，不支持自闭合、属性或标签名中的 `-`/`.`；
- 标签不能跨越 ICU 选择分支边界；
- 只输出 React 节点，不生成 HTML 字符串；
- 富文本路径不支持 `defaultMessage` 回退；
- 标签渲染器由应用提供，框架不内置链接、强调或安全策略；
- 消息中的 `<script>` 等文本不会被执行，只会作为文本/未知标签错误处理。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/icu.test.ts`（既有 ICU 行为回归） | 7/7 |
| `tests/icu-rich.test.ts`（嵌套标签、复数内标签、字面量、未知/错配/未闭合） | 3/3 |
| `tests/browser/locale.test.ts`（dev/build/preview 中 `rich` 与 `FormattedMessage tags`、语言切换与 DOM 结构） | 1/1 |
| `pnpm check` | 532/532，0 失败/取消/跳过（F5n 为 529，新增 3 项） |
| `pnpm test:browser` | 49/49，0 失败/取消/跳过 |
| `pnpm test:package` | 310 阶段通过（完整套件；locale consumer 的公共类型新增 `formatIcuParts`/`RichTags`/`IntlApi.rich` 断言，页面新增富文本断言） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5o-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U16 剩余：Antd/dayjs 语言联动；
- U32/U34：SSR、MPA；U25 externals/runtimePublicPath；
- U17 UI adapter；F6 多 builder 与微前端。
