# cormi P4b：项目创建与开发接口联调结果

日期：2026-10-18。基于本地提交 `50803911c51bf80224eeccadb8ec3cc46428159f`，完成从创建新应用到本地接口联调的功能切片。最终 macOS arm64 **209 项 Node 测试、13 项真实浏览器测试通过，0 失败、0 取消、0 跳过**；真实打包消费者 **56 个检查阶段**满足预期。精确命令、源码与日志哈希、包清单见 [最终机器记录](../artifacts/p4b-final-validation.json)。本轮不执行 Windows 或 Linux，平台工作不阻塞功能实现。

## 1. 交付内容与边界

新增 `@cormijs/create`，提供独立 `create-cormi` 命令和 createProject API，支持 react 与 react-api 两个模板。创建器没有 Cordis、Vite 或 React 运行依赖，也不读取目标应用配置；新项目尚不存在，创建操作不应依赖它先启动插件宿主。它只生成文件，不自动安装依赖、初始化 Git、执行模板或联网。

新项目自带页面、HTML、TypeScript 配置、cormi.config.ts、package.json 和 pnpm-workspace.yaml。react-api 模板额外提供 mock.ts 和可点击的接口请求示例。所有本地框架 tarball、Cordis 声明补丁和上游许可都复制到项目内 `.cormi-local/`，依赖引用不指回旧 kit 或工作区。目标必须不存在；并发创建只允许一个获得目标，校验失败不创建目录，写入中断保留不完整结果供检查，不递归删除可能被其他人修改的文件。

当前包尚未公开发布，因此 `--kit` 是明确必填的本地交付约束。不能把本轮交付描述成任意用户已经可以从公共 registry 运行 npm create。首次第三方依赖安装可能需要网络，Cordis RC.11 的消费者根 pnpm 声明补丁仍保留。所有 13 个包继续为 private。

新增 `@cormijs/plugin-dev-api`：主入口是后端无关的 Node HTTP Mock/代理处理器，`/vite` 才提供注入 vite 服务的 Cordis 桥接。功能不强制进入默认 React preset，更没有放进 core。主入口不加载 Vite；桥接使用可选 peer，选择桥接的应用明确提供该依赖。默认模板不声明开发 API 为直接依赖。

Mock 支持方法和路径精确匹配、重复 query、JSON 请求和响应、可取消异步 handler。代理支持固定 HTTP/HTTPS 目标、最长分段前缀、可选去前缀、路径与 query 转发、响应状态和多个 Set-Cookie。Mock 优先于代理；未命中 API namespace 的请求交给应用，命中 namespace 但无规则返回 JSON 404。只在 dev 接入；build 和 preview 不提供开发接口，生产环境仍需自己的 API 服务。

实现采用有界缓冲，不承诺 WebSocket、SSE、流式上传或生产网关能力。默认请求体 1 MiB、响应体 4 MiB、并发 64、总超时 10 秒；超过规则预算明确失败，不建立无界等待队列。不跟随代理重定向、不关闭 TLS 验证、不允许浏览器请求自行改变目标主机。配置和 Mock 本身是可信 Node 代码，不是不可信代码沙箱。

详细接口、配置与限制见 [项目创建和开发 API 协议](23-project-creation-and-dev-api.md)。框架名称仍为 cormi，分发名称才使用 cormijs；本轮没有升级外部依赖，锁文件只新增两个本地 workspace 包关系。

## 2. 接续与五个先失败的断言

接续时工作区已有未提交的 P4b 实现及完整初批验证。先恢复同一项目会话，核对原记录的 154 份源码 SHA-256 与实际文件相同，保留这些改动；初批结果另存为 [初批机器记录](../artifacts/p4b-initial-validation.json)，不覆盖历史阶段结果。初批为 200 项 Node、13 项浏览器通过，本轮复核额外增加 9 项 Node 用例。

新回归首先在修复前执行，15 项中有 5 项失败，10 项通过。原始失败日志保存在 `.cache/p4b-review-red-28b741a11fd3451d8a98bc27b4c7dc9b/tests.log`，其哈希已纳入最终记录；没有把这些失败改成预期成功或删去断言。

**响应写入期间的名额释放过早。** handler 已经返回但客户端暂停读取大响应时，旧实现提前释放并发名额。现在一个请求同时拥有 handler 和响应的完成状态，两者结束才释放；还增加“迟到 handler 与慢响应同时存在”的组合，不能用两个集合长度的最大值代替实际请求数。总超时覆盖背压写入，响应头已发送后只断开连接，不追加另一段错误 JSON。关闭等待已接收 handler 与响应收尾。

**无实体响应被错误附加长度。** Mock 的 204/205/304 不再输出实体；204 不设置 Content-Length。HEAD 和 304 代理响应保留上游给出的表示长度，不把没有传输响应体误写成长度 0。真实 HTTP 用例分别核对 HEAD、GET、204、205、304 的状态、响应头和实体。

**逐跳头过滤的大小写漏洞。** Mock 返回大写 Connection 时，旧实现没有过滤它提名的 X-Internal。现在头名和 Connection token 按大小写无关规则处理，同名不同大小写的重复输出明确拒绝。

**清单字段被隐式转换后接受。** 旧版本字段 `['0.0.1']` 可被 RegExp 隐式转换成字符串而通过。创建器先检查 name/version/sha256 的实际类型，再验证格式；错误发生在创建目录之前。

补充测试还覆盖目标父目录别名、kit 祖先链接、客户端截断上传、响应写入超时、慢响应与未结束 handler 的组合。最初五个失败断言修复后通过，33 项创建/API/响应边界测试额外连续复测两轮，最终完整回归后再重复一轮，均通过。它们是重复验证，不累加为新增用例或长期内存证明。

## 3. 实际浏览器行为

沿用 Node 22.14.0、pnpm 10.6.3、macOS arm64 和本机 Edge 155.0.4283.62。通过项目现有 playwright-core 在独立无头上下文运行，不使用个人浏览器 profile。新增一个完整浏览器用例，其余十二个既有浏览器用例继续执行。

链路为：生成模板页面 → 验证标题与实际 URL → 点击计数器 → 点击“请求 Mock”看到 Hello, cormi! → 把 mock.ts 改坏 → 配置编译明确报错而旧 worker 继续提供原响应 → 修复并修改 handler → 新 worker 返回 Updated, cormi! → 正常关闭并重新绑定原端口。生产 build/preview 另验证页面仍可访问，但不再提供开发 Mock 响应。

`/mock.ts?raw` 和 `/.cormi-local/manifest.json?raw` 均返回 403，普通页面和 API 正常。新 `.cormi-local/**` 拒绝规则位于 Vite provider，避免本地归档/补丁成为静态资源。不存在开发诊断覆盖层残留或未预期 pageerror。该边界防误暴露，不承诺可信用户插件主动输出机密时仍能自动拦截。

桌面 1280×800 与窄视口 390×844 的截图均已打开复核：中文、计数器、Mock 按钮和结果可见，没有横向溢出。截图位于 `.cache/cormi-created-desktop.png`、`.cache/cormi-created-mobile.png`，哈希记录于机器证据；它们是桌面浏览器视口验证，不代表真机移动浏览器矩阵。

## 4. 真实打包消费者，不止 workspace 示例

本轮真正打包 13 个 tgz，并从仓库外安装树运行 create-cormi 的 bin。新建 react-api 应用后确认没有 node_modules 和 .git，将新应用移动到另一个包含中文和空格的路径，同时把原 kit 移离原位置；之后使用应用自己的 `.cormi-local` 安装和 CLI，完成 typecheck、inspect、浏览器计数/Mock、build、重复 build 和 preview。

安装链接逐一检查，不允许返回 cormi 工作区；所有公共 ESM/types 入口（包括 API 的 /vite）均检查，严格 NodeNext 类型使用 skipLibCheck=false。旧 core、launcher、SDK、basic、features 消费者与无补丁/缺少 peer/坏构建/类型错误等负向断言保留。旧 basic 消费者仍覆盖重定位后删除 node_modules 并按未变化锁文件重装；新创建应用本轮验证的是移位后首次独立安装，不混淆两者。

56 个阶段包含预期非零结果，不等于 56 个新增单元测试。本轮相对上次已提交 P4a（176 Node / 12 browser），新增 33 项 Node 和 1 项浏览器测试。相对接续的初批 P4b（200 / 13），本轮复核新增 9 项 Node；不能把两份记录或多次执行累加成新用例。

## 5. 最终验证与证据

| 检查 | 结果 |
| --- | --- |
| pnpm check，含框架、测试与脚本类型检查 | 209/209；无失败、取消、跳过 |
| pnpm test:browser | 13/13；无失败、取消、跳过 |
| pnpm test:package | 56 阶段满足预期，13 个真实 tgz |
| 创建/API/响应边界定向重复 | 每轮 33/33，未重复计数 |
| 新增浏览器链路定向重复 | 1/1，未重复计数 |
| basic 类型检查、features 应用 typecheck | 分别退出 0 |
| 冻结锁文件离线安装、原 P0 demo | 分别退出 0 |
| 新 kit、创建示例、创建器 help | 分别退出 0 |

完整验证目录为 `.cache/p4b-final-deb09ec52645471fb75c976ce1d46fad`。收尾 diff 检查发现一个测试文件末尾多余空行；仅删除该空行后，再在 `.cache/p4b-closeout-d449073be07f4e379f68e3460dc92041` 重新执行全部 Node/类型、浏览器、打包消费者和 33 项定向回归，均通过。最终记录明确保留这一次字节差异和前后报告；应用代码、安装锁文件、测试断言均未改变，安装/demo/交付目录结果来自相同应用源码的前一份记录。

完整验证前冻结 155 份源码/测试/脚本/示例/配置/补丁，每条命令前后核对文件集合与 SHA-256，收尾重新核对全部当前文件。此后只补文档与证据汇总。初批、[完整复核](../artifacts/p4b-review-validation.json)、最终收尾 JSON 及先失败/复测日志各自保留，历史 P0–P4a 记录不改写。Linux 和 Windows 本轮没有运行，不把过去平台通过推广到新增实现。

## 6. 本地试用

已生成但未安装依赖的 react-api 项目位于：

`/Users/mahoo/Projects/cormijs/.cache/cormi-created-api-81d5b1945e6e`

```sh
cd /Users/mahoo/Projects/cormijs
nvm use
cd .cache/cormi-created-api-81d5b1945e6e
pnpm install --ignore-scripts
pnpm dev
```

默认监听 127.0.0.1:8000；页面的“请求 Mock”按钮调用 /api/hello。停止 dev 后可以执行 pnpm typecheck、pnpm build、pnpm preview。创建的 27 个文件包含独立模板与本地包交付文件，不代表第三方依赖已经安装。该项目可以整体移动到仓库外，保留 `.cormi-local/`；建议实际使用时移到长期目录。

重新创建其他项目时，在框架仓库执行 pnpm pack:local，然后运行：

```sh
pnpm create:app /absolute/path/to/new-app --kit /absolute/path/to/kit --template react-api
```

本轮最终 kit：`/Users/mahoo/Projects/cormijs/.cache/cormi-kit-c0a38bd6-9538-4fe0-adef-72762c49061d`。这里只使用本地已核验归档，不发布 registry。

## 7. 下一步

基础应用、可复用功能插件、项目创建和开发接口链路已交付，下一步集中完善应用配置派生、覆盖来源及有效值诊断；不要用更多平台测试代替功能实现。现有 inspect 仍主要读成功生成快照，不冒充完整配置来源工具。公开许可、包名归属、Cordis 声明兼容交付、SSR/RSC、长期资源趋势和自动崩溃恢复仍不在本轮完成范围。没有推送、发布、部署或新增常驻服务。

实现与回归入口：[创建器](../packages/create/src/index.ts)、[CLI](../packages/create/src/cli.ts)、[模板](../packages/create/src/templates.ts)、[开发 HTTP](../packages/plugin-dev-api/src/index.ts)、[Vite 桥接](../packages/plugin-dev-api/src/vite.ts)、[响应边界](../tests/dev-api-framing.test.ts)、[创建测试](../tests/create.test.ts)、[浏览器链路](../tests/browser/dev-api.test.ts)。
