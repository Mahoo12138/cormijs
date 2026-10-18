# Admin 业务模块：原版语义与迁移契约

回到 [议题台账](00-module-ledger.md)。本文件是逐模块源码研究与验收契约，原版/迁移版实际执行情况由独立结果记录，不因存在这些段落就视为已验收。下列源码路径均相对固定上游 `.cache/admin-upstream-material-kit`，不以在线默认分支替代。

## AM04 Dashboard：图表不是一张图片

来源：`src/sections/overview/view/overview-analytics-view.tsx`、其导入的 `analytics-*.tsx`、`src/components/chart`。必须保留四个带 sparkline 的统计卡、访问量/来源、转化、主题等图表以及新闻、时间线、任务区；不能用静态图片或 div 占位替代图表来避开第三方集成问题。

首组基线逐项检查真实 chart 实例、图例切换后的 series 折叠、任务复选框改变并还原、页面深刷新和窄视口。后续单独补充各类 tooltip、图表容器尺寸变化、标签/颜色/数字格式、滚动后的图表位置及页面销毁后的事件清理。图例点击成功不能推广成所有图表交互通过。

迁移设计：保留图表组件和动态 import，不把 ApexCharts 塞进 core；保持 MUI ThemeProvider 内的变量和颜色生成，检查依赖真实许可证。原版产物已出现大于500kB的 chunk 提示；它是基线告警，不是通过调高告警阈值即可消失的性能问题。完整迁移需记录与基线同条件的变化，不比较不同依赖/模式下的单次耗时。

## AM05 Users：筛选、排序、分页和选择必须组合验证

来源：`src/sections/user/view/user-view.tsx`、`utils.ts`、`user-table-head.tsx`、`user-table-row.tsx`、`user-table-toolbar.tsx`、`table-no-data.tsx`。本地 `_users` 有24条数据；默认每页5条、按name升序。过滤改变后重置page，渲染先过滤/排序再分页。行选中保存在组件state的ID数组中。

首组基线不是只检查输入框能输入：先翻第二页，搜索第一页存在的名字，核对确实只剩一个匹配行且返回首页；改成完全不存在的名字，看空结果和行数；清除后恢复5行，切换Name排序并核对顺序改变；选中/取消、菜单Delete、New user，以及改成每页10行分别验证。

已从源码和原版DOM确认的上游问题：TablePagination仍以 `_users.length` 为count，过滤为空时依然显示 `1–5 of 24`；表头全选也针对所有24条原始数据，而不是当前可见筛选集。它们需要独立语义判断，不能默认为迁移造成，也不能悄悄修掉后声称忠实保留。首组组合用例另检查“只显示一个筛选结果时全选仍选24条”。

上游New user没有onClick；行菜单Edit/Delete只关闭菜单；批量Delete与工具栏Filter图标没有实际业务处理。迁移时保留这些UI不等于实现创建/更新/删除。需要新增真实CRUD时另开增强议题，明确状态、错误和API契约。

后续对照门槛包括跨页选择、筛选后取消选择、排序后已选ID正确、最后一页切换rowsPerPage、重复空筛选、键盘焦点、普通组件HMR保留筛选及selected。需要明确哪些行为遵循上游，哪些修复获准改变；不会通过删除工具栏或只截图表格来关闭议题。

## AM06 Products：控件状态与数据操作分开

来源：`src/sections/product/view/products-view.tsx`、`product-filters.tsx`、`product-sort.tsx`、`product-item.tsx`、`product-cart-widget.tsx`。视图直接 `_products.map`；sortBy和filters只改变控件state，未用于选择或排序商品。Pagination没有数据onChange；CartIcon固定totalItems=8。卡片名称不是实际商品详情链接。

首组对照记录24张商品卡的名称序列；选择Price: Low-High后检查按钮文案改变但原序列不变；打开过滤抽屉，改变Women和Above $75，关闭后核对控件操作未改变商品集；切第2页仍为同一集合。明确保留这个原版占位语义，不把它报告成真实排序、筛选、分页或购物车完成。

正式模块验收另覆盖多选性别、分类/价格单选、颜色/评分、Reset恢复默认值、Escape与遮罩关闭、Drawer滚动与焦点、价格与划线价格式、Sale/New标记、图片尺寸与色点溢出。`canReset` 的数组引用比较可能使“值还原但引用不同”仍显示可重置，需要对照试验后定性；此处只记录待验证疑点，不直接宣告缺陷。

迁移应保持组件状态与主题，不加入全局假数据替换掩盖行为缺口。真正接入过滤/购物车应是独立增强而非暗中扩大原版功能。

## AM07 Blog：自动补全不等于搜索业务

来源：`src/sections/blog/view/blog-view.tsx`、`post-search.tsx`、`post-sort.tsx`和帖子卡片组件。Autocomplete使用posts作为options；选中后填充输入框，没有列表筛选或详情跳转。sortBy只改变Latest/Popular/Oldest文案，cards仍映射原posts。New post与底部Pagination没有业务处理。

首组对照检查23张原版帖子卡，输入Whiteboard得到真实候选，选中后输入变化而卡片集合不变；切Oldest仍保持原列表；New post不弹出创建流程。搜索候选响应与内容筛选必须分开记录，不用菜单能打开充当排序正确。

后续覆盖没有匹配候选、清除、键盘方向/Enter/Escape、长标题截断、不同首屏卡片排版、作者头像/日期/阅读评论数和窄屏重排。详情页、编辑器、真实搜索与服务端分页不在上游已实现能力中；新增时单独跟踪。

## AM08 Sign in：页面不构成认证系统

来源：`src/sections/auth/sign-in-view.tsx`、`src/layouts/auth`和Header账号菜单。密码显示/隐藏有state；Sign in直接router.push('/')，没有服务端请求、凭据校验或认证状态。任意示例输入也会导航回Dashboard。

首组对照使用明确虚构的邮箱/密码，核对显隐、点击后的真实URL、Dashboard内容和正常前后导航。原默认演示值不是测试账号，不能称为登录鉴权通过。账号菜单Logout也没有handler，不能称为会话注销。

后续检查键盘提交与按钮行为是否一致、浏览器自动填充、错误提示是否上游根本不存在、密码切换焦点、AuthLayout尺寸与资源路径、/admin/基址下返回目标。真正的匿名拦截、token、过期会话、403及RBAC作为独立安全/业务增强；不把前端可见性当作服务端授权。

## AM09 404和运行异常是不同的议题

来源：`src/pages/page-not-found.tsx`、相关视图、`src/routes/sections.tsx`与`src/routes/components/error-boundary.tsx`。普通404由明确的404和splat页面处理；运行异常通过根errorElement处理，显示错误种类/内容及来源。迁移不能只保留404就删除错误边界。

首组仅确认显式404、未知路径命中原Page404、Go to home返回Dashboard。完整对照还需页面渲染抛错、lazy模块求值失败、子级边界抛错上浮、边界中useRouteError获取正确对象、修复后恢复和生产错误内容的披露策略。

当前cormi路由IR没有等价的自定义errorElement接入，这是已识别的框架缺口，不能用通用“could not be loaded”替换原行为并宣称一致。应先设计可序列化模块引用、确保错误组件在被捕获的lazy失败前可用，再执行独立回归；不在本台账中提前写实现完成。
