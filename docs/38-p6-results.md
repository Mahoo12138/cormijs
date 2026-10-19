# cormi P6：生态参考、作用域开发 API 与独立插件交付

日期：2026-10-19。基于 `765bcb4b6675a006c759fd0596fb6cb4f89042ee` 继续。用户要求同时引入 Koishi、Koishi WebUI 和 Satori 的源码参考，并充分利用 Cordis 生态扩展设计。本轮实际交付为本地参考仓库、来源与版本记录、可组合 DevApiService、独立 Node/client 测试插件包，以及真实应用请求与取消验收。Admin 只提供既有 Users 页面和依赖负载，没有增加后台业务或修正模板 UI。

最终完整重跑 **269 项 Node 测试、17 项框架浏览器测试，0 失败、0 取消、0 跳过**。独立框架包消费者为13个真实tgz、61个阶段；另外一个独立测试插件tgz进入Admin安装树，完成两轮请求链路与生产隔离验证。原始输出与输入哈希见 [机器证据](../artifacts/p6-validation.json)，公开接口与来源分析见 [生态设计](37-cordis-ecosystem.md)。

## 1. 源码已在本地，而不是仅添加链接

所有路径相对于 `/Users/mahoo/Projects/cormijs`。

| 本地路径 | 上游仓库 | 固定提交 |
| --- | --- | --- |
| references/koishi | koishijs/koishi | 97d5c395750cec37b772e0b94dc63c427e3bb868 |
| references/koishi-webui | koishijs/webui | 1dc5c0e1c76a207c2ec48697d4b56364cfe28dce |
| references/satori | satorijs/satori | db22bb3c22f8ee9f6d9d9ecf04fd58b70006956f |

三者是独立、干净的浅克隆；没有完整历史、没有安装依赖或执行上游脚本。`references/` 已从主仓库和workspace排除，源码参考不进入分发包。已有 Cordis/Umi checkout 不更新。Satori 是 `satorijs/satori` 的消息协议与适配器框架，不是同名 SVG 渲染项目。[参考清单](../artifacts/cordis-ecosystem.json) 保存仓库、包版本、读取范围及源文件 SHA-256。

版本需要区分：Koishi 与 WebUI client 使用 Cordis 3 系列，克隆的 Satori 5 alpha 使用 Cordis 4 RC；cormi 维持自己的 `4.0.0-rc.11`。借鉴设计不代表现有 Koishi/WebUI 插件可以不改代码直接安装到 cormi。WebUI根LICENSE和client为AGPL-3.0，console及根package.json声明MIT；本次没有搬运其实现，逐包事实已记录，不把参考阅读当作整体许可兼容审计。

## 2. 生态设计实际落在哪里

**调用者作用域。** Satori 的 DisposableSet/InternalRouter 通过服务追踪和调用者 effect 撤回资源；cormi 的 `ctx.devApi.add()` 因此在服务内部绑定调用者的 Cordis effect。功能插件卸载会自动撤回自己登记的接口，无须每个插件作者复制一套清理模板。新增测试使用真正的嵌套插件，证明注销的是子插件贡献而不是误绑定到provider的整个生命周期。

**能力服务与传输适配器分开。** WebUI 的 Console/DataService/Entry 与 NodeConsole、Satori 的平台Adapter提供分层参考。cormi 将规则登记与请求所有权放入 `DevApiService`，Vite 中间件接入交给 `devApiViteBridge`。贡献者只 inject `devApi`，不需要 import Vite。独立消费者在没有安装 Vite、React 或 plugin-vite 时，仍能使用服务、贡献/撤回和严格类型声明。

**原生子插件组合。** 旧的 `devApiVitePlugin` 保留单配置入口，内部通过 `ctx.plugin()` 组合服务和bridge；复杂调用方也可分别安装。没有再设计一套插件加载器或把这些能力塞进core。

**Node/client 配对分发。** 参考 WebUI 的服务端Entry与浏览器扩展分离，同一个真实插件tgz分别暴露Node根入口、`/api`和`/client`。生产环境保留客户端runtime，但不注册开发接口。WebUI浏览器确实使用Cordis；cormi当前生成React runtime清单是产品取舍，不是声称Cordis不能在浏览器运行。本轮不移植Vue控制台或新建通用RPC层。

## 3. 已实现的公共契约

已有 `@cormijs/plugin-dev-api` 增加 `/service` 入口与 `DevApiService`，`/vite` 增加独立 `devApiViteBridge`，原主入口和组合插件继续可用。没有新增框架包、修改core或升级外部依赖；lockfile仅补充该包对已有精确Cordis版本的直接依赖关系。

一个服务可接受多个带稳定ID的贡献。新规则先整体检查，重复mock method/path或同proxy前缀不会局部生效。全局显式HEAD优先于GET回退，Mock优先于代理，代理按最长分段前缀选择。所有贡献共享每个HTTP会话的请求额度，不能通过拆成多个插件绕过并发限制。

撤回立即停止新请求匹配并取消该贡献已接收的请求，同时等待handler和响应写入收尾；其他贡献保持可用，旧注销函数不能删除同ID的新注册。慢上传、慢响应、真实上游socket断开、非合作handler和provider替换均有测试。超过排空期限明确失败，仍未结束的注册继续占资源预算，不把发出AbortSignal描述成任意代码已经停止。

`summary()`只输出prefix、贡献ID/owner和公开路径/方法，不输出handler、proxy目标或私有options。服务注册可在现有HTTP/Vite会话中动态增删；Node配置/源码改动仍采用既有worker重启。build/preview不安装开发中间件，不承诺WebSocket、SSE或生产网关。

## 4. 接续复核发现的关闭竞态

在初批266项Node和请求集成通过之后，进一步增加三个真实HTTP边界测试。其中两个先失败：HTTP session和Cordis service在AbortSignal监听器中再次调用close，会在首次关闭Promise尚未赋值时启动第二次关闭操作。原始红色结果为 `.cache/p6-close-review-red.log`。

修复将关闭Promise的保存放在取消回调之前，并立即关闭准入；重入调用获得同一个Promise。修复后两个原断言通过，第三个测试确认半个JSON请求尚在上传时撤回贡献不会调用其业务handler，且其他贡献仍能响应。定向15项通过后，重新打包并创建新的独立应用，重跑完整验证，而不是复用初批已安装的旧实现。

## 5. 独立插件与 Admin 验证链路

`tests/fixtures/dev-extension` 是一个独立测试包，不是额外框架产品。由pnpm实际pack成tgz，再安装到新应用自己的 `.cormi-local` 与 node_modules；根入口通过原生子插件组合Node API和客户端runtime，依赖均显式声明。

五组集成契约完整执行两轮：Mock成功/空结果/异常及Unicode JSON；浏览器经固定目标代理到真实HTTP上游并保持编码；浏览器AbortController取消分别传到Mock handler与上游socket；整体插件禁用/重新启用同时撤回/恢复API和runtime而peer健康接口继续存在；生产构建保留客户端扩展但无Mock和Node私有内容。

两轮实际自动配置重启均为三次worker启动，不靠手动reload。取消断言检查handler active归零及上游close，而不只是浏览器出现AbortError。生产资产扫描不含Node异常标记或代理目标；preview没有触发上游请求。代码和控制文件的raw请求为403。pageerror为空，控制台仅保留明确故障输入产生的500和撤回后404，不将这些预期失败说成全部请求都成功。

测试只临时包装新应用配置，不改Users表格/主题/数据。结束后恢复配置、删除控制文件、重新typecheck和build正常应用；src/public哈希不变，关闭本轮服务并确认端口可重绑。之前的试用应用和用户服务不动。

## 6. 最终结果

| 验证 | 实际结果 |
| --- | --- |
| pnpm check，包括框架/测试/脚本类型检查 | 269/269；比P5e新增15项 |
| pnpm test:browser | 17/17，既有框架浏览器回归未新增数量 |
| pnpm test:package | 13个框架tgz，61阶段满足预期 |
| 开发API定向重复 | 38/38，不重复计入新增用例 |
| 已安装Node/client插件的严格NodeNext声明 | skipLibCheck=false，通过 |
| Admin请求/取消/撤回/生产隔离 | 两轮，每轮五组通过 |
| 新应用及workspace冻结锁离线安装 | 均通过 |

最新完整目录为 `.cache/p6-reviewed-9559ef4600`。最终13条顶层命令全部成功，每条前后核对195份框架/测试/脚本/配置文件；安装后另冻结应用输入。安装树和tgz内的开发API三份源码逐字匹配当前实现。初批 `.cache/p6-final-f68ebfc5a5` 的266项记录保留，但最终结果不再依赖初批实现；失败与修复日志均保留在机器证据中。

本轮环境仍为macOS arm64、Node22.14.0、pnpm10.6.3和隔离的本机Edge无头上下文。沿用项目Playwright，不访问个人浏览器资料，不安装新的浏览器。没有运行Linux/Windows、所有第三方版本、长期资源趋势或不可信插件沙箱验收。仍需消费者根Cordis声明补丁，所有包为private，未公开发布、推送或部署。

## 7. 本地入口与下一步

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm check
pnpm test:package
```

需要复测请求链路时，可对本轮专用副本执行：

```sh
node --import tsx scripts/admin/dev-api.ts \
  --app "$PWD/.cache/admin-cormi-p6-reviewed-9559ef4600" \
  --out "$PWD/.cache/dev-api-recheck-$(date +%s)"
```

必须先停止同项目dev/preview；输出目录必须不存在。普通试用进入该应用后执行pnpm dev，入口为 `127.0.0.1:3047/admin/`；测试结束后的正常应用不再含临时Mock/runtime配置，不把这份页面当作永久新增业务功能。

下一步围绕插件作者体验补齐服务依赖与贡献来源诊断：先参考已有生态的服务注册和诊断方式，给出CLI/结构化信息，不先做插件市场或后台管理UI。继续以原生Cordis生命周期为唯一事实来源，领域服务负责自身资源与错误契约；按需读取固定上游源码，避免“已经克隆”代替后续设计依据。
