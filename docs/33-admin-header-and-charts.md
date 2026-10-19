# cormi：Admin Header 可访问交互与图表生命周期

阶段 P5d。固定上游仍为 Material Kit React `69e780a40c455d664b2e13c525faf1d492a072a7`，在 [模块台账](admin/00-module-ledger.md) 中分别归入 AM03、AM04。本文描述实现和验收方法，实际运行结果另见 [P5d 记录](34-p5d-results.md)。

## 1. 忠实迁移和上游修复是两种产物

迁移器新增显式 `--header-fixes`。未提供时仍保留原 Header 行为，适合原版对照；提供时才应用七个文件的可访问交互修正。`migration.json` 将 `headerFixes`、`headerEdits` 与既有 `assetEdits` 分开记录，前后源码哈希保留。不会悄悄改变历史基线或将原版缺陷算作 cormi 引入的退化。

这些修改属于模板的 React/MUI 组件，不进入 core、Cordis 服务或默认 preset。测试所用框架包、React/MUI/图表依赖和声明兼容补丁维持原锁定版本；没有为了获得测试通过去升级图表库、关闭 StrictMode、删除图表或添加全局事件拦截器。

## 2. AM03 的具体交互契约

通知“全部已读”会移除其自身按钮。修正以局部 ref 在移除前将焦点交给稳定的 Notifications 标题，随后更新未读状态；标题可程序聚焦但不增加普通 Tab 停靠点。此时 Escape 应直接关闭弹层、将焦点还给通知触发器。重开后保持零未读与五条通知，重复关闭、背景点击和弹层中的 Tab/Shift+Tab 单独验收。未读计数增加 status 语义，触发器与 dialog 建立名称、展开状态和关联。

语言、工作区、账号使用原来的 MenuList，补充 `autoFocusItem`，使键盘打开后焦点落在选中或首个菜单项。Home、End、方向键、Enter、Escape 以及退出后归还触发器均由真实键盘事件验证，不由测试代替产品先手动聚焦正确菜单项。原版分支仍明确记录手动聚焦的测量步骤，不能与改进版通过混用。

搜索保持原“关闭输入层”的演示行为，没有新增搜索 API。Escape 取消、Enter/按钮提交都可关闭，退出动画完成后仅为这些键盘/提交操作归还触发器焦点；点击外部输入框关闭时不抢回焦点。没有用全局 document keydown、固定延迟或每次渲染的 effect 抢焦点。表单事件显式使用 React 的事件类型，不关闭 strict。

移动导航增加触发器名称和 dialog 标识；在抽屉内打开工作区菜单时，第一次 Escape 只关内层菜单，第二次关闭导航；键盘进入 Blog 后抽屉消失且触发器仍可继续使用。菜单导航没有新建第二套 Router，所有地址继续遵守 `/admin/`。

上述设计参考 [W3C modal dialog 模式](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) 和 [MUI Menu API](https://mui.com/material-ui/api/menu/)，具体实现基于本地锁定源码。自动化验证键盘、焦点与 DOM 语义，不等同于 VoiceOver/NVDA 实机、完整 WCAG 审计或所有辅助技术兼容。

语言仍只切换旗帜，工作区只切换本地展示，Search/View all/Logout 的原占位语义不因焦点修正变成真实国际化、多租户、搜索或认证。

## 3. AM04 的图表观察不能猜测内部注册表

模板包含四个折线 sparkline、一张饼图、两张柱形图和一张雷达图。测试先核对八个实际图表的系列名称、数值与可见状态，再以真实鼠标移动检查 tooltip 的分类和数值。Website visits 是单系列 tooltip，Conversion rates 才配置 shared tooltip；不能强行要求两张图拥有同一种提示语义。饼图自定义图例和雷达图自定义图例属于展示组件，不宣称都可交互切换。

ApexCharts 4.5.0 只将显式配置 id 的图表放进 `_chartInstances`，这套模板使用匿名实例。仅看该数组为零不能推出图表不存在，更不能作为“没有泄漏”的证明。验证器使用 Chromium DevTools Protocol 的只读观察，从当前 window resize 的绑定监听器取得实际 Apex 实例；与八个 DOM canvas 身份逐一比对。读取后释放调试对象，不向应用注入图表 id 或修改其内部注册逻辑。这是锁定版本下的测试观察工具，不是 cormi 公共 API。

图例操作可能给库内部 series 添加 hidden/zIndex 字段。数据比较只保留系列名、数值、显隐、分类及标签，不将库的临时排序字段混作业务数据退化；显隐本身仍要求恢复。真实鼠标使用已绘制 SVG 的位置，饼图文本设置 pointer-events 穿透时让事件正常到达下方扇形，不使用 force 绕过遮挡。

尺寸验收覆盖 1440、900、390 像素再回到 1440，核对图表非零尺寸、容器边界和相同数据。路由生命周期验收以 SPA 导航执行三次 Dashboard→Users→Dashboard：离开后图表 DOM/tooltip 和绑定的图表 resize 监听器归零，非图表监听器按各自页面在重复访问中维持基线，返回后八个图表的数据与监听器数量恢复且页面文档未重载。该有限样本不代表长期堆内存、所有 ResizeObserver/计时器或完整无泄漏证明。

## 4. 可复现入口

```sh
node --import tsx scripts/admin/migrate.ts \
  --kit /absolute/path/to/verified-kit \
  --out /absolute/path/to/new-admin \
  --base /admin/ --port 3041 --header-fixes
```

目标必须不存在。未加 `--header-fixes` 创建忠实基线；`--port` 仅改变新副本的配置，不清理占用端口或已有项目锁。原参考 checkout 与旧试用项目不用于故障写入或覆盖。

```sh
node --import tsx scripts/admin/verify.ts \
  --app /absolute/path/to/installed-admin --kind cormi \
  --command dev --base /admin/ --suite header-fixed \
  --out /absolute/path/to/new-evidence
```

suite 可选 `modules`（原七组完整行为）、`business`（原六组非 Header 行为）、`header-original`、`header-fixed`、`charts`；preview 对已构建产物执行同组契约。`business` 是为保留原 Header 缺陷断言而明确拆出的范围，不删除旧七组或将修正后的行为硬说成与原缺陷相同。

实现入口：[可选修正](../scripts/admin/header-fixes.ts)、[迁移器](../scripts/admin/migrate.ts)、[Header 契约](../scripts/admin/header-contracts.ts)、[图表契约](../scripts/admin/chart-contracts.ts)、[驱动](../scripts/admin/verify.ts)、[修正保护测试](../tests/admin-header.test.ts)。每轮结论以结果文件为准，不将这些测试代码本身当作执行证据。
