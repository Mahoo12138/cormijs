# cormi：真实 Admin 的部署基址与状态热更新契约

阶段：P5c，接续 P5b 的 AM10/AM11。本文说明实现与验收方法；最终执行、版本、计数及未关闭范围见 [P5c 结果](32-p5c-results.md)。不将测试脚本存在等同于已经运行，不把框架通过推广为全部设备或托管平台支持。

## 1. 三种路径不能混成一次字符串替换

应用 `app.base` 决定部署前缀，生成的 Router 使用同一个 basename。浏览器构建器管理 HTML、模块导入、CSS 和字体引用；业务代码运行时拼接的 public 文件地址，需要明确使用这个前缀。React Router 的 Link、navigate 和当前位置属于路由语义，不能再次手动前缀，否则会出现 `/admin/admin/`。

只把 P5b 的 base 改为 `/admin/` 已实际复现图片与图标丢失。模板的字符串仍请求域名根 `/assets/...`，页面 DOM 可显示不等于资源正确。对应失败记录保留，问题归类为迁移适配，不声称这是 Vite 自动改写失效。

默认迁移脚本现在生成 `/admin/` 应用，`--base /` 可生成根路径对照副本。该脚本仅接受固定上游快照；支持的部署路径为 `/` 或以斜杠结尾、由 ASCII 字母、数字、下划线与连字符组成的路径段。此限制属于模板迁移工具，不是将整个框架限制到这几种字符，也不声称已经支持完整 CDN、运行时变址和相对 base 协议。

## 2. 局部资源工具，不扩张 core

迁移应用新增 `src/utils/public-asset.ts`。它读取选定 Vite 后端的 `import.meta.env.BASE_URL`，将受限 `/assets/...` 路径置于当前部署前缀。HTML favicon 用 `%BASE_URL%favicon.ico`；原 CSS `@import` 的字体仍交给后端处理。官方说明见 [Vite public base](https://vite.dev/guide/build.html#public-base-path)。

资源工具拒绝域外 URL、空路径段、点路径、控制字符以及可能破坏 CSS 表达式的字符；它不是通用 URL 标准库，也不是服务端授权机制。原 `Link`、菜单路径、路由 Hook、SVG 渐变的 `url(#id)` 不作前缀处理。

[scripts/admin/assets.ts](../scripts/admin/assets.ts) 按 TypeScript AST 识别受审阅的字面量、模板字符串和 CSS-in-JS URL，保留其余源码字节与插值表达式。JSX 属性会转换为表达式属性。相同输入不重复包裹；新增未适配地址时复用已有且来源正确的 helper 导入，不生成第二个同名绑定。绑定检查使用 AST，覆盖变量、参数、解构与导入，也保守拒绝嵌套遮蔽；注释和普通说明文字不算声明。静态导入、动态 import、require/resolve 和 import type 的绝对模块引用明确拒绝，不能改成普通 public 文件地址。仅凭调用名 publicAsset 相同不能认定已适配，必须核对有效的非 type-only helper 导入。这仍是固定模板的受限迁移器，不是任意 JavaScript 工程的通用语义重构工具。

本轮定位到10个原文件内的26处资源表达式：本地 Mock 数据9处、Auth 背景1处、侧栏升级插图1处、通知图标4处、导航图标模板1处、工作区图标3处、Blog头像形状1处、404插图1处、Dashboard背景1处、统计卡图标4处。每处原行号、原表达式与变更种类保存在新应用的 migration.json；原100个public文件保持不变。

## 3. 应用基址只有一个权威来源

审查新增了一个具体框架回归：原生 Vite 插件通过 `config()` 返回另一个 base，而 cormi 的路由计划仍使用 app.base。此前 dev/build/preview 都接受了这种分裂状态，三个拒绝断言实际先失败。

现在 Vite provider 在配置解析完成时要求 `resolved.base === plan.base`，不一致报 `VITE_RESERVED_CONFIG`，提示使用应用配置或派生机制修改 app.base。填写相同 base 的插件仍允许使用。该检查与原有 root/outDir/cache 所有权检查并列，作用在 Vite 插件内，不向 core 注入 Vite 类型，也不禁止高级用户更换整个后端。

这不是对可信原生插件的安全沙箱。插件若在其他回调私自更改服务器或输出机密，不能依靠一个字段一致性断言保证隔离。检查只确保正常配置扩展流程不会静默拆分当前应用的基址。

## 4. 资源验收不能只数 HTTP 200

[deployment.ts](../scripts/admin/deployment.ts) 从独立安装的应用 CLI 启动 dev/preview，遍历 public 中所有文件，以部署前缀发起请求，验证无重定向、状态、MIME 与 SHA-256。生产模式还遍历产物中的 JS、CSS、WOFF/WOFF2；HTML fallback 即使返回200，也无法通过字节校验。

浏览器只允许当前 origin 和部署前缀内的请求；越界请求会被记录、阻断并使验收失败，不提供额外域名根映射。检查动态模块、开发 WebSocket 路径、真实加载字体、CSS背景/遮罩与图片解码。六类页面均直接访问和刷新，并在固定桌面与窄视口下检查。长页按真实视口逐区滚动，触发资源，再打开通知、语言和工作区弹层检查额外图标。所有同源链接必须保留前缀，Logo回首页、侧栏跳转和后退都执行，而非因找不到控件就跳过。

文件传输完整、当前浏览器能解码、某组交互正常，是三种不同证据。完整文件清单不证明所有像素和所有控件都已审阅；多个视口也不等于真实手机、Safari、CDN缓存、离线PWA或生产反向代理验收。SPA上线仍要将对应前缀的页面导航回退到该应用index，而资源404不能回退成HTML。当前验证没有部署线上服务。

## 5. 真实交互状态下的 Fast Refresh

[development.ts](../scripts/admin/development.ts) 操作原 UsersView：每页10条、降序、Billy筛选结果、选中一行，然后修改真正拥有状态的组件标题。连续修改和恢复两轮，要求名称序列、选中状态、排序、分页标签、过滤值与 `performance.timeOrigin` 保持一致。不能重新导航恢复状态，也不能修改一个与状态无关的外层测试组件来代替这个断言。

Products 的对应场景保留排序选项、第二页、Women和Above $75选项以及打开的过滤抽屉，再修改同一 ProductsView 的标题。两轮中选项、卡片序列、抽屉与文档身份保持一致；关闭抽屉后继续核对排序和页码。该模板的排序/过滤/分页仍只是演示state，没有因此实现真实商品数据处理。

文件修改仅在明确的新迁移副本进行；修改前保存内容与inode，写入和恢复前检查仍是同一文件且未被他人改动。不盲目覆盖外部修改，也不在只读上游目录实验。热更新后恢复原字节，再进行实际应用typecheck。

## 6. 构建失败与其他更新的边界

成功build后记录产物内每个文件，随后在受控Users源码中注入语法错误。build必须非零退出，旧发布目录中的每个文件都保持原字节；恢复源码后检查类型。该过程验证本次真实Admin负载，没有把fixture发布回滚实验冒充真实断电或线上零停机。

组件Hot Refresh不意味着配置也能保留状态。Node配置变化仍走worker重启；路由结构更新可以刷新页面。Admin专项配置错误保旧服务、修复切换、图表全部tooltip与销毁、Header键盘焦点仍按台账继续，不由本轮组件状态检查自动关闭。原Users分页总数、全选范围和通知焦点缺陷保持原事实，不在资源迁移中偷偷修复。

## 7. 入口与资料

创建：[migrate.ts](../scripts/admin/migrate.ts)。资源适配：[assets.ts](../scripts/admin/assets.ts)。受控进程与文件工具：[harness.ts](../scripts/admin/harness.ts)。框架回归：[Vite base](../tests/vite-base.test.ts)。迁移工具回归：[asset contracts](../tests/admin-assets.test.ts)、[绑定及模块引用复核](../tests/admin-assets-review.test.ts)。按模块查看 [当前台账](admin/00-module-ledger.md)。
