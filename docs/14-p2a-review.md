# cormi P2a：开发恢复收尾复核

日期：2026-10-17。基线为 main 上的 P1c 提交 `6923d9ad3f72acfdba930484b682606422dacb53`。本轮最终功能回归为 **133 项 Node 测试、10 项真实浏览器测试通过，0 失败、0 取消、0 跳过**。执行时间、命令参数、输出计数、日志和源码哈希以 [复核机器记录](../artifacts/p2a-review-validation.json) 为准。

## 1. 接续范围与交付

进入工作区时已经存在未提交的 P2a 实现及初批测试记录。本轮先恢复同一项目会话，核对旧记录中所有源码哈希与实际文件一致，保留这批改动，然后进行边界审查、补回归、修正问题并准备本地提交。没有覆盖或改写原始 [初批机器记录](../artifacts/p2a-validation.json)。

整体 P2a 使首次路由冲突、缺失本地客户端模块等可修复编译问题不再要求退出并手动重启 dev。开发服务器可以继续监听，浏览器显示明确诊断；输入修复后使用同一 worker 恢复应用。首次失败不会写入伪造成功的生成集，旧会话留下的 app.tsx 也不自动等于本次编译成功。CLI 的 applicationStatus 区分服务器已监听与应用编译状态。

运行中的结构冲突保留最后成功生成的入口和已有 DOM；修复后代码完全相同则仅清除诊断，不改 mtime 或强制刷新，计数器等现有状态可以保留。有效路由结构发生变化仍采用整页刷新，不承诺任意编辑都保留应用状态。

诊断以有限纯数据契约经过 Web 命令交给 Vite provider。React 编译器不 import Vite；浏览器面板为开发专用 DOM 模块，不依赖 Cordis。面板支持最小化、重新展开、较窄视口和新连接的当前状态重放。公开消息使用白名单，不原样传递异常 stack、cause、完整配置或私有环境变量。

## 2. 本轮先失败、再修复的三个断言

新增 [生命周期回归](../tests/development-lifecycle.test.ts) 的首批三个用例在原有 P2a 源码上全部失败，原始输出保存在 `.cache/p2a-review-red.log`，哈希纳入机器记录。这些失败不是靠增加等待时间或删除断言解决的。

**所有权错误被路由冲突掩盖。** 原实现只在实际 publish 时检查已有生成文件。若本轮路由先失败并进入恢复模式，未拥有的 app.tsx 会绕过这个检查。现在 AtomicEntry.open 在进入可容错编译前验证已有文件，组合场景仍须以 GENERATED_NOT_OWNED 拒绝启动；文件内容不被覆盖。

**关闭提前结束。** 原来的错误通知可能脱离编译队列继续执行，导致 session.close 返回后还有正在等待的回调。现在记录所有已进入执行的通知 Promise，关闭时停止新交付、清空订阅、等待计算与观察循环，再等待已接受通知收尾。

**已注销观察者仍收到迟到通知。** 原循环遍历订阅快照，前一个监听器 await 后，后一个即使已经注销仍会被调用。现在每次调用前重新核对取消状态、状态版本和订阅成员关系；每次注册使用独立身份，旧注销函数不能删除同一 callback 的新注册。

另外补充两个用例：观察者抛错不能把成功编译反向标记成路由错误，但 close 要通过 AggregateError 报告交付失败；旧注销句柄不得删除新订阅。错误观察者不影响其他仍有效观察者获得通知。永久挂起的第三方回调仍受外层 worker 超时约束，不是假装已经强制取消。

## 3. 浏览器验证

主要路径是：在 `/demo/users/73` 冷启动遇到路由冲突，看到结构错误面板，最小化后重新打开，修复文件后自动进入 User 73 页面，且不重启 CLI worker。测试核对页面 title 与 URL，不以 HTTP 200 或非空 body 代替应用状态。

新增冷启动用例先生成一个有效磁盘入口，再制造冲突启动 dev。断言旧入口与 inspect 内容保留、但旧应用没有被执行；修复后即使生成内容和 mtime 不变，也必须真正加载应用，计数器可以点击，worker 仅启动一次。

桌面面板按 1280×800、窄视口按 390×844 检查。面板有可见错误说明和相对文件路径，按钮可以操作，窄视口边界不越界。恢复后断言 overlay 移除、只存在一个应用 header/Provider、footer 内容正确，没有未预期 pageerror。截图在视口完成布局/绘制后获取，不把中途重绘当作 DOM 重复挂载。

测试通过项目已有 playwright-core 启动本机 Edge 的独立无头上下文，不访问个人浏览器 profile，也没有下载浏览器。这是桌面浏览器的窄视口验证，不是真实 iOS/Android 设备矩阵。截图 `.cache/cormi-development-desktop.png`、`.cache/cormi-development-mobile.png`、`.cache/cormi-development-recovered.png` 保留在忽略目录，哈希记录于机器文件，不纳入 Git 源码提交。

## 4. 验证范围

| 检查 | 结果与边界 |
| --- | --- |
| pnpm check | 133/133 Node 测试通过，并完成框架与测试 TypeScript 检查 |
| pnpm test:browser | 10/10 真实浏览器测试通过，含旧路由、Fast Refresh、构建预览与 runtime 回归 |
| 开发恢复浏览器定向重复 | 四个恢复场景独立重复；次数和每次计数见机器记录，不重复计为新增用例 |
| 生命周期/恢复/后端/命令/生成定向重复 | 25/25 通过，不额外累加为新用例 |
| pnpm typecheck:example | 示例源码检查退出码 0 |
| 严格声明消费 | Vite provider 的 skipLibCheck=false 检查通过；无 Vite 的物理独立 core 消费者同样检查声明 |
| 冻结锁文件离线安装 | exit 0，未升级全局工具 |
| 原 P0 demo、示例 cormi typecheck 与 inspect | 均 exit 0，保留此前功能回归 |

相对用户上次收到的 P1c（118 Node / 4 browser），本批增加 15 项 Node 与 6 项浏览器用例。相对工作区已有的初批 P2a（128 / 9），本轮复核增加 5 项 Node 与 1 项浏览器用例。不能把重复执行次数算作新的测试数量。

本轮维持 Node 22.14.0、pnpm 10.6.3 与锁文件的依赖组合；实际浏览器版本见机器记录和浏览器日志。最终校验期间冻结源码，开始与结束核对 107 份所选源码、配置、测试、示例与补丁文件哈希。结果文档可以随后补写，但不在测试结束后修改已验证的实现。

Cordis 声明补丁还补齐 utils.d.ts 中相对包入口的 NodeNext 路径，仍不修改上游运行时 JavaScript。严格声明检查通过只是本机可用性证据，补丁不会自动传播给未来 npm 消费者。

## 5. 使用与后续

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
pnpm build
pnpm cormi dev --root examples/basic
```

示例默认监听 `127.0.0.1:8001`，Ctrl+C 关闭。开发恢复仅适用于所实现的可修复编译问题；基础 HTML 缺失、配置非法、生成文件未拥有等仍需明确失败。prepare/build/typecheck 不启用容错成功语义；preview 不注入开发诊断客户端。

下一切片优先使用真正打包产物创建独立消费者，验证 exports/bin/types 与依赖，并处理 Cordis 声明补丁的分发方案，再验证 Linux/Windows。尚未完成首次配置语法错误的独立诊断服务器、全部运行时错误处理、完整项目引用类型构建、长期内存趋势、自动中断发布恢复或线上部署。包保持 private，没有推送、发布或部署。

相关实现：[生成所有权](../packages/plugin-web/src/generation.ts)、[React 编译与通知](../packages/plugin-react/src/index.ts)、[恢复协议](12-development-recovery.md)、[Node 生命周期测试](../tests/development-lifecycle.test.ts)、[浏览器回归](../tests/browser/development.test.ts)。
