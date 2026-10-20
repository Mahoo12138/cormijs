# cormi F4b：Mock 目录约定与开发期重载

日期：2026-10-20。本切片交付 U18 的 Mock 约定：显式启用的 `mockPlugin` 扫描 `mock/**/*.{ts,tsx,js,jsx}`，把默认导出的 `METHOD /api/path` 映射注册到既有 `DevApiService`；开发期按文件变更自动重载。生产预览不提供 Mock，代理仍由 DevApi 配置负责。

## 1. 使用方式

```ts
// cormi.config.ts
import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { mockPlugin } from '@cormijs/plugin-dev-api';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'dev-api', plugin: devApiVitePlugin },
    { id: 'mock', plugin: mockPlugin, options: { intervalMs: 200 } },
  ],
});
```

```ts
// mock/users.ts
export default {
  'GET /api/users': { body: { users: ['Ada'] } },
  'POST /api/echo': request => ({ status: 201, body: request.body }),
};
```

- key 必须是 `METHOD /path`；路径可带 dev API prefix（默认 `/api`），注册时会去掉 prefix；
- 值可以是 `{ status?, headers?, body? }` 或返回该对象的函数；函数收到 cormi `MockRequest`（method/path/query/body/signal）；
- 默认扫描 `mock`，可用 `dir` 或 `files` 覆盖；默认前缀 `/api`，可用 `prefix` 覆盖。

## 2. 运行时语义

1. 启动时用 esbuild 打包每个 Mock 文件（TS/TSX），以 data URL 在 Node worker 中求值；不进入浏览器 bundle；
2. 默认导出对象转换为既有 `MockRule`，统一交给 `ctx.devApi.add` 做冲突、路径与响应校验；
3. 每 200ms（可配置 50–5000ms）比较文件列表和 mtime/size；变更时重新加载并替换本插件规则；
4. 新文件无效时保留上一组规则并输出错误，不终止正在运行的开发服务器；
5. 文件删除或目录清空会撤回规则；插件卸载会清除定时器并撤销贡献；
6. 只有 DevApi Vite bridge 在 dev server 中安装中间件；build/preview 不提供 Mock 请求；
7. Mock 是显式开发代码，可执行 Node 能力；不是安全沙箱，也不进入生产产物。

`ProjectRuntime` 现在可由宿主提供只读 `projectRoot` 服务（worker 传入 `--root`），Mock 等文件约定插件不再依赖进程 cwd。

## 3. 与 Umi 4 的差异

参考 Umi `packages/preset-umi/src/features/mock` 与 Mock 文档：

| 方面 | Umi | cormi F4b |
| --- | --- | --- |
| 发现 | `mock/` 约定默认启用 | 显式 mockPlugin |
| 文件格式 | 方法/路径对象、函数 | 同类对象映射 |
| 函数签名 | req/res 风格 | MockRequest -> MockResponse |
| 重载 | 开发期热更新 | 轮询文件变化并替换规则 |
| 代理 | config/proxy | 既有 DevApi proxies |
| 生产 | 不提供 | 不提供 |
| 安全 | 开发代码 | 开发代码，不是沙箱 |

本切片不承诺 Umi Mock 函数签名、文件 API 或插件二进制的兼容。

## 4. 限制

- 只支持 default export 对象映射；不支持按文件名自动生成 REST 资源；
- 无 req/res 写入式响应；只能返回 `MockResponse`；
- 轮询重载而非文件系统事件，interval 有下限；
- 新规则注册失败时保留上一组规则，但已发生的模块副作用不会回滚；
- 不提供生产 Mock、远程 Mock、录制回放或安全隔离；
- 代理仍通过 DevApiService 配置，不由 mock 文件声明。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。

| 检查 | 结果 |
| --- | --- |
| `tests/mock.test.ts`（TS 发现、路径映射、POST、重载、无效模块） | 2/2 |
| `tests/browser/mock.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 472/472，0 失败/取消/跳过（F4a 为 470，新增 2 项；约 110 秒） |
| `pnpm test:browser` | 34/34，0 失败/取消/跳过（F4a 为 33，新增 mock 用例；约 357 秒；loader 调整后 mock 用例重跑通过） |
| `pnpm test:package` | 197 阶段满足预期（F4a 为 189，新增 8 个 mock 阶段） |
| `examples/mock` prepare + typecheck | 退出 0 |

浏览器验收覆盖：`/api/users`、`/api/plain`、POST `/api/echo`、编辑文件后重载、production preview 不提供 Mock。独立打包消费覆盖插件公开类型、开发、构建与预览。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f4b-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- F4c：配置/别名、样式与资源、微生成器，别名已由 [F4c](76-f4c-alias.md) 交付；
- U18 后续：Mock 文件 req/res 兼容、代理统一配置与更细的重载诊断；
- U19/U22/U27 按路线逐项吸收。
