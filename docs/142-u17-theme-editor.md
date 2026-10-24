# U17-4：ProLayout 主题编辑器

日期：2026-10-22。本切片在 `ProLayoutShell` 上接入 ProLayout `SettingDrawer`，并提供 `useProLayoutSettings` 让应用读取/修改布局主题设置；设置可持久化到 localStorage。主题编辑器控制 ProLayout 设置（布局、导航主题、主色等），不是任意 Antd token 的完整编辑器。

## 1. 使用方式

```tsx
import { Outlet } from 'react-router';
import { ProLayoutShell } from '@cormijs/plugin-antd/pro-layout';
import { useIntl } from '@cormijs/runtime';

export default function Layout() {
  const { t } = useIntl();
  return (
    <ProLayoutShell
      title={t('app.title')}
      settingDrawer
      settingsStorageKey="demo:pro-layout-settings"
    >
      <Outlet />
    </ProLayoutShell>
  );
}
```

```tsx
// 任意布局子组件
import { useProLayoutSettings } from '@cormijs/plugin-antd/pro-layout';

function ThemeToggle() {
  const { settings, update, reset } = useProLayoutSettings();
  return (
    <button onClick={() => update({ navTheme: settings.navTheme === 'realDark' ? 'light' : 'realDark' })}>
      Toggle theme
    </button>
  );
}
```

## 2. 契约与语义

- `settings` 支持 `layout`（side/top/mix）、`navTheme`（light/realDark）、`colorPrimary`、`fixedHeader`、`fixSiderbar`、`siderWidth`、`contentWidth`（Fluid/Fixed）；其他键忽略，已知键的非法值抛 `PRO_LAYOUT_SETTINGS_INVALID`。
- 默认值来自 `ProLayoutShell` 的 `layout`/`fixedHeader`/`siderWidth`，其余为 `navTheme: light`、`fixSiderbar: true`、`contentWidth: Fluid`；`settings` prop 只作为初始值，后续变更不会回写。
- `settingDrawer: true` 渲染 ProLayout 自带的设置抽屉；抽屉的首次挂载回调来自上游同步默认值，外壳会忽略这一次回调，避免覆盖已持久化设置。
- `settingsStorageKey` 设置后，挂载时从 localStorage 读取（≤64 KiB、损坏数据忽略），修改/重置时写回；没有 key 时仅内存保存。读取在 effect 中完成，避免 SSR/hydration 首帧不一致。
- `navTheme: realDark` 同时传给 ProLayout 的 `navTheme` 与 Sider `theme`，使导航区域进入暗色；`colorPrimary` 由 ProLayout 内部 ConfigProvider 作用于布局内容（包括 Antd 组件）。
- `useProLayoutSettings` 必须在 `ProLayoutShell` 内使用；`update` 合并已知键并持久化，`reset` 恢复初始值并删除存储键。
- 设置状态是组件内 React 状态，不新增 Cordis 服务；菜单折叠仍由 menuPlugin 独立管理。

## 3. 边界

- 只编辑 ProLayout 设置；不提供 Antd token 全量编辑、主题 JSON 导入/导出、服务端保存或用户级主题。
- 不替换 `antdPlugin` 的静态 `theme` 选项；应用级暗色算法仍由 U17-1 配置。`colorPrimary` 只通过 ProLayout 的 ConfigProvider 覆盖其子树。
- ProLayout 7.22.7 对 antd 6 使用 SettingDrawer 时会输出 `Drawer width`、`List`、`Alert message` 的弃用警告；这是上游兼容问题，浏览器测试过滤这些已知警告，不能视为无警告。
- 未验证 SSR 下的 SettingDrawer/hydration；设置读取只发生在浏览器 effect。
- 设置持久化键按 origin 共享，不做跨标签页同步；清除 localStorage 会丢失设置。
- SettingDrawer 文案跟随 ProLayout 内置 locale；U17-7 将活动 cormi locale 映射到五个内置 locale，自定义语言仍受上游限制。

## 4. 验证

验证环境：antd 6.6.7、`@ant-design/pro-layout` 7.22.7、`@ant-design/icons` 6.3.4、React 19.3.1、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/browser/pro-layout.test.ts` | 初始浅色/主色；`update` 后导航进入暗色且主色变化；localStorage 写入后 reload 恢复；设置抽屉 handle 存在且可打开/关闭；既有菜单/locale/折叠用例保持 |
| 安装包 `pro-layout` consumer | typecheck 覆盖 SettingDrawer/`useProLayoutSettings` 使用，dev/build/preview 验收 |
| `pnpm check` | 570/570 |
| `pnpm test:browser` | 54/54 |
| `pnpm test:package` | 344 阶段 |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u17-4-theme-editor-validation.json)。

## 5. 下一步

- U17 图表集成（应用侧图表库 + 浏览器/安装包验证）；
- U17 ProLayout 内置文案 locale、自定义 locale 对象、SSR；
- F6 微前端/状态库适配、U09 热替换、U16 请求 locale、SSR 生产化。
