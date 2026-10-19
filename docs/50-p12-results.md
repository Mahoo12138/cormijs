# cormi P12：应用创建收敛与独立静态交付

日期：2026-10-19。接续 P11 `2aaca05e29d851ed836bb975dc285e38a7a19a23`。本轮将已实现能力串成新应用用户流程，修正创建器默认模板的类型、环境/Mock 和命令入口，新增独立应用端到端验收与 [应用开发指南](49-application-guide.md)。没有增加框架包、Admin 业务、插件市场或生产服务器；core、runtime、launcher、Vite provider 和依赖版本未修改。

最终 macOS arm64 **352 项 Node、19 项框架浏览器测试通过，0 失败、0 取消、0 跳过**；13 个真实框架 tgz 的既有独立消费者72阶段通过，默认插件作者54阶段通过，新增应用完整链路执行两轮、每轮37阶段满足预期。相对 P11 新增4项Node和1项浏览器测试；流程阶段包含安装、命令、HTTP和预期非零步骤，不等于新增单元测试。原始命令、源码/归档/报告哈希见 [机器证据](../artifacts/p12-validation.json)。

## 1. 先复现新建应用的问题

新增的三项创建契约在原版模板上全部失败，保存在 `.cache/p12-template-red.log`：真实 cormi typecheck 不能解析 CSS Modules/SVG 导入；默认 tsconfig 仍 skipLibCheck=true 且未将生成目录列入 include；react-api 在 build 目标也登记并初始化 devApi provider。错误不靠放宽类型或隐藏诊断解决。

修正后，模板提供独立 `src/assets.d.ts` 的 CSS Modules、SVG/PNG 类型，默认保持 strict=true、skipLibCheck=false，并显式纳入 `.cormi`。ImportMetaEnv 的公开前缀/可选字符串类型已经存在于生成的 routes.d.ts，本轮直接复用，没有新建第二套全局环境声明或添加 Vite 到公共类型入口。

类型测试保留负向断言：未声明的公开变量不能当成必然存在的字符串，环境值不能当成数字，私有键不能从公共环境读取，readonly 属性不能写入。资产模块声明不证明文件实际存在；真实构建与浏览器资源字节检查另行执行。

## 2. 默认配置与请求代码的变化

生成应用增加明确的 `prepare:app`、`config:app`、`diagnose` 脚本。prepare:app 是用户显式生成，不是 install/postinstall 钩子。config:app 避免误调用 pnpm 自己的 config 内建命令。已有 dev/build/preview/typecheck/inspect 保持。

react-api 的 provider 只在 `command === 'dev'` 启用；生产页面禁用演示 Mock 按钮。模板配置的 base 同时用于 API prefix，客户端用 import.meta.env.BASE_URL 拼接自己的 API URL，消除模板写死根 /api 的做法。静态导入 mock.ts 仍可能执行可信模块顶层代码；关闭 provider 不等于所有配置模块从未求值。

请求按 unknown 校验 JSON 的 message 字段，保留 loading/error/success，失败后可重试。每个页面拥有自己的 AbortController，卸载时取消请求；迟到结果不能覆盖新页面或新请求。不增加通用请求客户端、全局状态层或另一个生命周期。

新的真实浏览器用例不是只看 AbortError：第一个 HTTP 200 返回错误数据形状，页面显示 Invalid API response；第二次请求成功；第三次 handler 等待取消，客户端通过 Link 卸载页面后，服务端记录 cancelled:3；返回页面后第四次请求正常。整个流程只有一代 worker、客户端导航没有整页重载，控制台与 pageerror 为空。完整浏览器集执行后又定向复测一次。

## 3. 从真正的创建器包开始

`pnpm test:application` 打出13个真实框架归档，在仓库外安装创建器，再使用已安装 bin 创建 react-api 应用。没有直接调用 workspace 中的 createProject 来冒充分发可用性。

新应用显式添加 @cormijs/plugin-react 依赖，用原生 defineReactFeature/clientModule 贡献一个页面、runtime 公开值、CSS Modules 和 SVG；另有约定式布局与 users/[id].tsx。这个小功能只验证框架装配，不扩张 Admin，也不把业务插件硬编码进 preset。

首次安装后，移动整个应用和原 kit，删除应用自己的 node_modules，按未变的锁文件重新安装。每轮应用重装前后各169处安装链接均限制在自己的安装树内。后续命令只从应用自己的 cormi 包执行。两个最终应用的13份归档中，各55份框架源码与当前 packages 内容逐字一致。

## 4. 同一应用的根/子路径完整流程

每一轮均执行 `/` 和 `/workbench/` 两组：生成、开发页面、环境标题、真实 Mock URL、插件页面/runtime/CSS/图片、类型检查、连续两次构建、config/diagnose/inspect 只读效果、类型失败、路由冲突与恢复、已有产物预览。

三种诊断保持生成目录和 dist 全部文件哈希不变。类型错误必须返回非零，约定页面与插件路由占用同一路径时 build 必须失败，旧 dist 全部字节保持；修复后 typecheck 恢复。开发配置和合成环境输入的 raw HTTP 访问返回403。根/子路径的实际 API URL 分别是 /api/hello 和 /workbench/api/hello，子路径时没有额外挂载根 API 以掩盖硬编码。

## 5. 只用站点文件运行，而不是再启动 preview

每组成功构建后，向独立 site 目录复制8份 HTML/JS/CSS/资产文件，排除点文件元数据。然后关闭 cormi 会话并把整个源应用移到另一个路径，确认原路径不存在；HTTP 测试主机只读取这份站点副本，不调用 cormi/Vite/config，不访问源应用或其 node_modules。浏览器包中当然仍包含已编译的客户端 runtime，这不等于需要运行 Node 开发工具链。

独立静态阶段验证首页计数、公开 staging 值、生产 Mock 按钮禁用、插件 runtime/计算样式/SVG解码、客户端 Link 导航、参数路由和深链接刷新。每份站点文件都核对 HTTP 状态、MIME、响应字节；缺失 JavaScript、API、.env、.cormi 及 .cormi-build.json 均返回真实404而不是首页HTML。测试主机自己另有Node契约，区分导航回退与非导航请求、HEAD及非GET/HEAD方法。

原 dist/.cormi-build.json 没有被删除，仍供未来受管替换核对所有权；不公开元数据是复制阶段的筛选，而不是破坏原构建记录。测试后源应用移回原位置，原产物哈希不变。两轮的两个base共四组静态交付都通过。

这里验证的是静态产物与可控HTTP规则，不是上线部署、NGINX执行、CDN缓存/TLS/鉴权或线上回滚。指南中的NGINX配置明确标为需要实际服务器核验的示例，引用官方root/try_files说明；没有把测试主机当成新增生产服务器发布。

## 6. 最终验证与复现

| 检查 | 结果 |
| --- | --- |
| pnpm check，包含框架/测试/脚本类型 | 352/352 Node |
| 新创建/静态规则定向重复 | 4/4 |
| pnpm test:browser | 19/19 |
| 新Mock请求浏览器定向重复 | 1/1 |
| pnpm test:package | 13个tgz，72阶段满足预期 |
| pnpm test:plugin，默认输入 | 54阶段满足预期，未执行可选字体分支 |
| pnpm test:application | 两轮各37阶段满足预期 |
| workspace冻结锁离线安装 | 通过，未升级依赖 |

完整最终目录 `.cache/p12-final-4be5f5d3a9`。9条顶层命令每条执行前后核对227份源码/测试/脚本/配置输入，全部退出0。初批 `.cache/p12-flow-d5fdc779a8` 也完成37阶段，但最终结果另从头运行，不依赖拼接旧日志。最后只补文档与证据，没有改变被测源码或断言。

实际打开了第二轮 `/workbench/` 的390×844静态截图，确认标题、导航、Count:1和禁用的生产Mock按钮可见；页面无横向溢出的断言同时通过。截图是这一个时刻的视觉证据，资源正确性依赖前述MIME/字节检查。默认样式沿用旧模板，没有做新的UI设计。

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm test:application --keep
```

--keep 会保留该次独立应用、kit与证据，实际路径见输出的application字段；默认成功后回收自己的临时应用。最终已保留的两份应用路径记录在机器证据中，属于临时验收工作区而非长期业务项目。正常创建长期应用请直接按 [应用指南](49-application-guide.md) 操作。

## 7. 当前收敛状态和下一步

本轮闭合了“新建应用→原生插件装配→环境/Mock→类型/构建→纯静态副本”的本地功能链路。真正的产品修改只在创建器及其生成模板，Node宿主、领域协议和已验证的资源/代际规则不因演示方便而扩张。Cordis、Umi、Koishi、WebUI、Satori参考checkout保持原提交且干净，已有Admin及旧试用应用未被修改或停止。

全部包仍private，消费者根Cordis声明补丁仍需要，未推送、公开发布或线上部署。Linux/Windows、其他浏览器、长期资源趋势、TypeScript项目引用和自动恢复中断发布不在本轮完成范围。下一步集中原P2可靠性门槛：连续启停、受控密集文件事件及失败混合，检查最终输入、端口/worker/监听资源回落；先建立可复现资源趋势基线，不再用新增演示功能替代稳定性证据。
