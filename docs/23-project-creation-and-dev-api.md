# cormi：项目创建与开发 API 插件

日期：2026-10-18。阶段：P4b。本文描述新增的本地项目创建器及开发 HTTP Mock/代理，不表示框架已公开发布，也不将 Windows 平台作为本阶段前置条件。实际执行数量、先失败回归与交付目录见 [P4b 结果](24-p4b-results.md)。

## 1. 从新目录创建应用

`@cormijs/create` 是独立启动工具，命令为 `create-cormi`。它不读取目标应用的配置：新项目尚不存在，不能让创建操作依赖该项目先有可运行的 Cordis 宿主。创建器不依赖 Vite、React 或 Cordis，不自动安装依赖、初始化 Git、执行模板代码或访问网络。

在框架仓库先执行 `pnpm pack:local`，得到本地 kit 路径，再运行：

```sh
pnpm create:app /absolute/path/to/new-app --kit /absolute/path/to/kit --template react-api
```

目标目录必须不存在，父目录必须存在且不经过符号链接。即使目标是空目录，也不会自动接管；没有 `--force` 覆盖选项。`--name` 可指定小写 npm 风格应用名。模板有 `react` 和 `react-api`，前者是基础 React 页面，后者增加可直接请求的 Mock 示例。

`--kit` 当前必填，因为 cormi 包尚未公开发布，不能让用户尝试安装并不存在或归属未确认的 registry 包。创建器把 kit 的 tarball、声明补丁与上游许可复制进新项目的 `.cormi-local/`；应用依赖和 overrides 都相对这个目录，而不是指回原框架仓库。移动项目时保留 `.cormi-local/` 即可，不再依赖原 kit 所在位置。

所有 tarball 和补丁先核对清单 SHA-256、文件类型、链接和字节预算，再独占创建目标。清单最多 64 个包，单个 tarball 最多 16 MiB，总计最多 64 MiB。哈希用于检查本地 kit 的一致性，不是第三方签名或不可信包安全审计。模板是创建器内置数据，不下载或执行远程模板。

新项目包含自己的 `pnpm-workspace.yaml`，避免被外层 workspace 意外接管。第一次运行：

```sh
cd /absolute/path/to/new-app
pnpm install --ignore-scripts
pnpm dev
```

停止 dev 后执行 `pnpm typecheck`、`pnpm build` 或 `pnpm preview`。首次第三方依赖安装可能需要网络；脚手架不是完整离线镜像。Cordis RC.11 的声明补丁仍由消费者根 `pnpm.patchedDependencies` 明确配置，不使用 postinstall。

写入采用独占新目录与逐文件 `wx`。写入失败或中途取消时保留未完成目录供检查，不递归删除可能被其他进程修改的内容。它不是多文件原子事务，也不承诺对同用户恶意文件系统替换形成权限沙箱。

## 2. API 插件与构建器的边界

`@cormijs/plugin-dev-api` 主入口提供后端无关的 `DevApiSession` 与规则类型，只使用 Node HTTP 接口。`@cormijs/plugin-dev-api/vite` 提供原生 Cordis 插件 `devApiVitePlugin`，显式注入 `vite` 服务，把 HTTP handler 接入 Vite 开发会话。主入口不 import Vite，Vite 依赖是可选 peer；使用 `/vite` 桥接的应用须提供对应 peer。

没有把 Mock/代理加进 core 或默认 React preset。用户显式配置才启用；基础模板不安装此功能作为直接依赖。Vite 桥接仅用于 dev，不在 build/preview 注册 HTTP 接口，也不把 Node Mock 文件打入浏览器入口。Mock 配置来自可信 Node 文件，不是可给普通浏览器用户任意执行的代码。

```ts
import { defineConfig } from 'cormijs';
import reactVite from '@cormijs/preset-react-vite';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';
import { mocks } from './mock';

export default defineConfig({
  presets: [reactVite],
  app: { server: { host: '127.0.0.1', port: 8000 } },
  plugins: [{
    id: 'dev-api',
    plugin: devApiVitePlugin,
    options: {
      prefix: '/api',
      mocks,
      proxies: [{ path: '/backend', target: 'http://127.0.0.1:9000/v1', stripPrefix: true }],
    },
  }],
});
```

上述 `9000` 是开发者自己启动的后端示例，框架不会启动它。请求 `/api/backend/users?page=1` 会发给配置目标的 `/v1/users?page=1`。省略 stripPrefix 时保留 `/backend`。API prefix 是相对域名根的路径，不自动加应用 base；子路径部署可显式选择 `/workspace/api`，也可继续使用域名根 `/api`。

## 3. Mock 与路由规则

```ts
import type { MockRule } from '@cormijs/plugin-dev-api';
export const mocks: readonly MockRule[] = [
  { method: 'GET', path: '/hello', handle: ({ query }) => ({ body: { message: 'Hello, ' + query.get('name') } }) },
  { method: 'POST', path: '/echo', handle: ({ body }) => ({ status: 201, body }) },
];
```

Mock 按方法和路径精确匹配；HEAD 可以使用 GET 的 handler 但不返回实体。path 是去除 API namespace 后的相对业务路径。已匹配 Mock 优先于代理，代理按最长分段前缀匹配，`/backend` 不匹配 `/backend-other`。同方法/路径的 Mock、同路径代理重复会报错，不以注册先后覆盖。最多 256 条规则，不提供动态参数、正则或文件目录自动扫描约定。

带 body 的 Mock 请求仅接受 application/json（可以附带 charset），不接受 application/jsonp 之类的前缀近似值；不支持表单上传、multipart 或二进制 Mock body。handler 返回 JSON body、可选 status 和 headers；204/205/304 不返回实体；204 不携带 Content-Length，代理 HEAD/304 保留上游对所选表示给出的长度，不把“没有响应体”错误写成“表示长度为 0”。异常对客户端输出稳定错误码，不回传异常堆栈、源码或代理目标。

未命中 API namespace 的请求交给其他中间件。命中 namespace 却没有规则返回 JSON 404，避免被 SPA HTML fallback 伪装成接口成功。外部 Origin 被拒绝，但这不是身份认证；本地程序可自行发送请求。开发服务默认 loopback，不建议把含开发 Mock 和代理的服务公开到互联网。

## 4. 代理与资源控制

代理目标在 Node 配置中固定，只支持 HTTP/HTTPS；拒绝包含用户密码、search 和 fragment 的 target，不允许客户端通过 query 指定转发主机。转发保留路径的百分号编码，不把 %2F 解码成新的路径分段；解码检查仅用于拒绝非法和越界路径。不会跟随上游重定向，不关闭 TLS 校验。请求 Host 和 Content-Length 重算，过滤 hop-by-hop 及 Connection 声明的逐跳头；保留响应 Set-Cookie 数组。本阶段不重写 Cookie Domain/Path 或 Location。

每个请求默认总超时 10 秒、请求体 1 MiB、响应体 4 MiB；上限分别为 60 秒和 16 MiB。maxConcurrent 默认 64，最多 256；达到上限返回 503，不建立无界等待队列。一个请求的 handler 与响应写入共同拥有一个名额，只有两者结束才释放。超时后仍未结束的第三方 handler，以及已经算出结果但客户端读取缓慢的响应，都不能绕过并发限制。总超时也覆盖响应写入：已经发出响应头时只断开连接，不向半个 JSON 响应末尾追加另一份错误 JSON。

请求/响应采用有界缓冲，不适用于 WebSocket、SSE、长轮询或大文件传输。使用这类能力需要独立实现对应流式协议，而不是调大此插件的预算冒充完整代理。

客户端断开、超时或插件关闭会传播 AbortSignal。关闭等待已接收 handler 和响应完成；不合作的 handler 在两秒清理期限后明确报错，外层 worker 仍拥有其最终退出期限。取消不是强制终止用户函数，不能把 Promise.race 先返回当作全部资源已经释放。

## 5. 更新与私有输入

`mock.ts` 通过 Node 配置静态 import，沿用配置编译依赖追踪。有效修改使用新 worker；静态语法错误可继续服务旧 worker，修复后重启。不是进程内无缝替换 handler，也不是独立 Mock watcher。动态读取的其他文件需要显式 watch。

已知 Node 配置/Mock 依赖继续走 serverOnlyFiles 拒绝规则。Vite 增加 `.cormi-local/**` HTTP 拒绝，防止把新脚手架内的包归档和补丁当静态资源暴露。将密钥主动写入 public 或在可信插件中直接输出仍不属于此边界的安全保障。

HTTP 行为对照 [RFC 9110 §8.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6)、[§15.3.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.6) 与固定 [Node 22.14 HTTP API](https://nodejs.org/download/release/v22.14.0/docs/api/http.html) 核对；具体头部、背压和关闭行为仍以本项目的真实 HTTP 回归为验证依据。Vite 集成沿用锁定 7.3.2 的 configureServer/closeBundle，不因滚动文档出现新 hook 就改变后端接口。

## 6. 实现入口

[创建器](../packages/create/src/index.ts)、[创建命令](../packages/create/src/cli.ts)、[内置模板](../packages/create/src/templates.ts)、[HTTP 实现](../packages/plugin-dev-api/src/index.ts)、[Vite 桥接](../packages/plugin-dev-api/src/vite.ts)、[创建边界测试](../tests/create.test.ts)、[HTTP 测试](../tests/dev-api.test.ts)、[浏览器链路](../tests/browser/dev-api.test.ts)。

正式 registry 分发、任意第三方模板、多包管理器、完整配置派生/覆盖来源诊断、SSR/RSC 及长期资源趋势不由本阶段承诺完成。
