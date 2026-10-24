# U17-7：ProLayout/Antd 内置文案 locale

日期：2026-10-24。ProLayout 的文案通过 `window.g_locale`（或 `navigator.language`）选择，而不是通过 `locale` prop。本切片把 cormi 的活动 UI locale 映射到 ProLayout 的五个内置 locale，并同步 `SettingDrawer` 的文案；同时暴露 `formatMessage` 供应用覆盖 ProLayout 主文案。

## 1. 使用方式

```tsx
<ProLayoutShell title={t('app.title')} settingDrawer>
  <Outlet />
</ProLayoutShell>
```

默认会跟随 `localePlugin` 的活动 locale；需要关闭全局 `g_locale` 副作用时：

```tsx
const { peek } = useIntl();
<ProLayoutShell syncLocale={false} formatMessage={({ id, defaultMessage }) => peek(id) ?? defaultMessage ?? id}>
  <Outlet />
</ProLayoutShell>
```

## 2. 契约与语义

- `useLocaleOptional()` 读取活动 locale；按语言候选映射：
  - `zh`/`zh-CN`/`zh-Hans` → `zh-CN`
  - `zh-TW`/`zh-Hant` → `zh-TW`
  - `en`/`en-US` → `en-US`
  - `it`/`it-IT` → `it-IT`
  - `ko`/`ko-KR` → `ko-KR`
  - 其他 → `en-US`
- `syncLocale` 默认 `true`：在 effect 中设置 `window.g_locale` 并派发 `languagechange`，ProLayout 主文案与 SettingDrawer 随 cormi locale 更新；卸载或 locale 变化时恢复之前的 `g_locale`。
- `syncLocale={false}` 时不写全局；可配合 `formatMessage` 覆盖 ProLayout 主文案（SettingDrawer 仍读取其内置 locale）。
- `formatMessage` 只影响 ProLayout 的 `formatMessage` 调用；SettingDrawer 使用自己的 `gLocaleObject()`，不受该 prop 影响。
- locale 读取发生在 effect，SSR 首帧使用 ProLayout 的服务端默认文案；hydration 后再切换，避免写入浏览器全局。

## 3. 边界

- 只覆盖 ProLayout 内置的五个 locale；没有 cormi 消息目录到 ProLayout 文案的自动翻译。自定义语言或完整自定义文案需要 `formatMessage`（仅主文案）或等待上游支持。
- `window.g_locale` 是 ProLayout/Umi 的全局约定，不是 cormi 服务；同页多个 ProLayout 实例会共享最后一次写入。`localStorage.umi_locale` 优先级更高，若宿主已写入该键，桥接不会生效，需要清除或保持同值。
- 不写 `umi_locale`，不修改 `navigator.language`；`syncLocale={false}` 可完全关闭。
- SettingDrawer 文案受上游 antd 6 弃用警告影响（U17-4 已记录）。
- 未验证 SSR 下 SettingDrawer 首屏文案与 hydration 一致性；浏览器端仅验证 effect 后切换。
- 不处理 RTL 文案方向；`antdPlugin` 的 `direction` 仍负责布局方向。

## 4. 验证

验证环境：`@ant-design/pro-layout` 7.22.7、antd 6.6.7、React 19.3.1、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/browser/pro-layout.test.ts` | 初始 en 打开 SettingDrawer 显示 `Page style setting`；切换 zh 后显示 `整体风格设置`；主题/菜单/折叠断言保持 |
| 安装包 `pro-layout` consumer | 同一 locale 切换与 drawer 文案断言 |
| `pnpm check` | 572/572 |
| `pnpm test:browser` | 56/56 |
| `pnpm test:package` | 359 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u17-7-prolayout-locale-validation.json)。

## 5. 下一步

- U17 剩余：服务端图表内容、自定义 SettingDrawer 文案/更多 locale；
- F6 微前端/dva/valtio、U09 热替换、U16 请求 locale、SSR 生产化、U33 sitemap lastmod/压缩。
