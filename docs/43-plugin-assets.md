# cormi：插件样式与静态资源交付

日期：2026-10-19。基于已有 P8 插件作者模板，P9 补齐 CSS、图片、字体从源码联调到独立插件 tgz 消费的交付。本文描述当前设计与边界，最终运行结果另见 [P9 记录](44-p9-results.md)。它不是独立资源服务器、插件市场或新的 Cordis 生命周期。

## 1. 资源属于插件，不属于消费者的 public

`create-cormi --template plugin-react` 的 Node 根入口仍通过原生 Cordis 子插件贡献页面、runtime 和开发 API。浏览器入口保持 `/client`、`/page`，不引入 Node 包。现在页面自带 `page.module.css`、嵌套 CSS token 与 SVG，作者不用另建复制脚本，也不需要让每个使用者把图片搬到 public。

普通 `pnpm build` 将 TypeScript 编译到 dist，并将支持的资源按照 src 下相对位置原字节复制到 dist。`pnpm pack:plugin` 则先建立独立源码快照，重新编译到本次临时目录，在该目录复制资源并打包；不会带入作者旧 dist 中的残留文件。source map 对应源码继续交付，`sideEffects: ["**/*.css"]` 随包保留。

```text
src/                         dist/
├── page.tsx                 ├── page.js / page.d.ts
├── page.module.css          ├── page.module.css
├── assets.d.ts              ├── assets.d.ts
└── assets/                  └── assets/
    ├── tokens.css               ├── tokens.css
    └── plugin-mark.svg          └── plugin-mark.svg
```

资源转换、CSS Modules 名称、图片内联或哈希文件名，以及应用 base 的处理，仍由所选构建后端完成。cormi core 不读取图片格式或携带 Vite 配置；没有给消费者安装额外资源镜像、缓存目录复制或目录别名来冒充分发可用性。

## 2. 作者采用的引用方式

页面采用显式静态导入，CSS 内采用相对 URL：

```tsx
import styles from './page.module.css';
import illustration from './assets/plugin-mark.svg';

export default function Page() {
  return <main className={styles.panel}>
    <img src={illustration} width={48} height={48} alt="插件资源" />
  </main>;
}
```

```css
@import './assets/tokens.css';
.panel { background-image: url('./assets/plugin-mark.svg'); }
```

模板声明 `*.module.css`、`*.svg` 和 `*.png` 的 TypeScript 类型；扩展其他静态导入类型时作者应提供相应声明。字体放在插件自己的 assets 目录，由 `@font-face` 的相对 `url()` 引用。默认模板不附带第三方字体；作者有责任选择和保留自己引入的字体、图片等资产的授权与声明。

**不将 `new URL('./asset', import.meta.url)` 当作任意依赖预构建下都可用的插件契约。** 本轮实测源码页面能显示，但安装到 node_modules 后相关代码被移入 Vite 的 deps 缓存，URL 随之指向错误目录，图片请求得到 HTML 200。模板因此改为显式静态导入，交给构建器识别并重写；并未全局关闭依赖优化、修改上游 Vite 或宣称任意第三方库内部的 new URL 已被自动修复。

## 3. 有限输入与输出所有权

源文件类型允许 TS/TSX/JS/JSX、普通 d.ts、CSS、SVG、PNG、JPG/JPEG、GIF、WebP、AVIF、ICO、WOFF/WOFF2、TTF/OTF。单个文件上限 1 MiB，全部源码与资源合计 8 MiB，最多 256 个文件、512 个遍历项、32 层目录。点文件、未知扩展、符号链接、硬链接与越界路径拒绝进入快照。Sass/Less 预处理器、WASM、JSON 等不属于此默认打包模板的资源白名单，不能把它描述成万能库构建器。

资源复制保存 `dist/.cormi-plugin-assets.json`，记录路径与 SHA-256。同内容不重写；资源从 src 删除或改名后，只删除仍与旧记录一致的受管输出。已被手工改写的旧资源、未知既有目标或与编译声明冲突的文件会明确拒绝，不自动接管。资源名、目录名含 Unicode 和空格可按原布局保留。

构建在启动 TypeScript 前检查 dist 及其已有子项，拒绝链接或非独立普通文件，避免编译器先写入不应写的目录、之后资源复制才报错。源码在编译前后重新比对，发现变化拒绝将这轮复制视为成功。打包继续使用私有新目录，不运行安装脚本或发布 npm。

**这不是整个插件 dist 的原子事务。** 普通库 build 仍可能在后续资源检查失败前已经写出 TypeScript 产物；资源文件逐个 rename、最后提交所有权清单，意外中断后应检查并保管不完整产物。它也不是和未来新启动的 CLI 原子互斥、敌对同用户文件系统的权限沙箱或任意资产授权审计。可信作者并发改动、第三方编译器配置仍需自行管理。

## 4. 验证的层次

Node 回归验证字节复制、输出删除范围、同内容 mtime、篡改拒绝、声明冲突、链接拒绝、字节/目录预算与编译前输出准入。静态扩展名检查不等于解析出整个 CSS 资源图，包级类型检查也不等于每个引用都已经能运行；应用构建与浏览器验收不能省略。

复核还覆盖删除源资源与手工改写旧输出同时发生时的整批资源保护、多个小文件累积超限，以及编译期间输入变化的拒收。消费者根路径和子路径分别执行dev与preview；最终证据不把根路径preview自动推广为根路径dev通过。

`pnpm test:plugin` 从真实创建器归档生成作者项目，实际安装自己的依赖，经过源码联调、CSS 导入热更新、组件状态保留、Node 更新和整体插件启停，再真实打包插件、移走作者与 kit、删除消费者依赖并冻结重装。在消费者的 `/customer/` 和 `/` 下检查 CSS Module、嵌套 CSS、图片解码、资源 MIME/字节及生产预览，不使用作者源码路径作为回退。

提供 `--font-root <已安装的 @fontsource-variable/dm-sans@5.2.5 目录>` 时，测试还将指定 WOFF2 与原 LICENSE 复制到本次临时作者目录，检查 src、dist、tgz、网络响应的字节相同、实际 FontFace 加载及 h1 使用该字体。没有提供时报告 `fontChecked: false`，不将它写成已运行字体验收。字体不进入框架模板或对话下载附件。

前端检查使用当前项目的 Playwright 和独立无头浏览器；没有读取个人浏览器资料。本轮没有为上述流程修改 Admin 模板业务，也不把测试页计数器当成后台产品功能。

## 5. 生态参考与后续边界

本轮继续核对固定 WebUI 的 [Entry 文件声明](../references/koishi-webui/packages/console/src/entry.ts) 与 [status 包 files 字段](../references/koishi-webui/plugins/status/package.json)。借鉴的是“开发入口和分发文件边界分开，扩展自身拥有客户端代码”的组织方式，不直接搬运其实现，也不向 React SPA 移植整套 Vue 控制台。版本与许可事实仍见 [生态参考](37-cordis-ecosystem.md)。

本切片不承诺 CSS 在插件卸载时由 Cordis 自动移除、任意第三方图片插件兼容、源包与所有消费构建器行为一致、公开 npm 可安装或 Windows 支持。真实资源加工交给后端，原生 Cordis 继续只管理插件与受管副作用。下一步由实际插件使用的配置重复、依赖注入与资源撤回问题驱动，不继续扩张 Admin 或新建插件市场。
