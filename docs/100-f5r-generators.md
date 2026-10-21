# cormi F5r：API 与 Mock 生成器

日期：2026-10-21。本切片补齐 U27 的两类常用模板：`cormi generate api <name>` 生成 `src/api/<name>.ts`，`cormi generate mock <name>` 生成 `mock/<name>.ts`。它们复用既有 `generatorPlugin`、命令协议与覆盖/试运行规则，不新增插件生命周期。

## 1. 使用方式

```sh
cormi generate api health
cormi generate mock health
cormi generate api order -- --dry-run
cormi generate mock order -- --force
```

```ts
// src/api/health.ts
export default function handler(request: Request) {
  return Response.json({ ok: true, method: request.method });
}
```

```ts
// mock/health.ts
export default {
  'GET /api/health': () => ({ ok: true }),
};
```

生成的文件分别被 `apiRoutePlugin`（F5n）与 `mockPlugin`（F4b）按既有约定发现；生成器本身不注册路由或 Mock。

## 2. 契约与语义

- 入口：仍是 `generatorPlugin` 的 `generate` 命令，用法扩展为 `generate <page|component|model|api|mock> <name> [--force] [--dry-run]`；
- 名称：沿用 `^[A-Za-z][A-Za-z0-9-]{0,63}$`；文件路径使用 kebab-case，API 与 Mock 模板共享同一名称；
- API 模板：默认导出 Fetch 处理器，返回 `{ ok: true, method }`，由应用替换为真实逻辑；TypeScript 需要 DOM/Node 的 Fetch 类型（create 模板默认包含）；
- Mock 模板：默认导出 `{ 'GET /api/<name>': () => ({ ok: true }) }`，符合 `mockPlugin` 的 `METHOD /path` 约定；
- 覆盖：目标存在且无 `--force` 以 `GENERATE_EXISTS` 失败；`--dry-run` 只返回计划，不写文件；所有写入限制在项目内；
- 退出：与既有生成器相同，卸载 `generatorPlugin` 后命令消失；生成的文件归应用所有，删除插件不会删除它们。

## 3. 与 Umi 4 的差异

Umi 的生成器/插件体系支持模板扩展与更多内置类型；cormi 目前只有五个内置模板，模板贡献面与交互式提问仍未提供。

| 方面 | Umi 4 | cormi F5r |
| --- | --- | --- |
| 命令 | `umi generate` | `cormi generate` |
| 内置类型 | 较多 | page/component/model/api/mock |
| 模板扩展 | 插件贡献 | 未提供 |
| 自动注册 | 视模板 | API/Mock 由对应插件发现 |

## 4. 限制

- API 模板是零依赖骨架，不含鉴权、方法分派、校验或数据库访问；
- Mock 模板只生成 GET 示例，不生成多方法/动态路径；
- 生成器不修改配置、不注册路由、不安装依赖；
- 模板贡献、交互式提问与自定义输出目录仍待后续；
- 生成的文件仍需应用自行 typecheck（命令不执行校验）。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/generate.test.ts`（规划与 CLI 写入 api/mock、覆盖/试运行/非法 kind） | 2/2 |
| `pnpm check` | 535/535，0 失败/取消/跳过（F5q 为 535，本切片无新增测试函数） |
| `pnpm test:browser` | 51/51，0 失败/取消/跳过（无新增浏览器用例） |
| `pnpm test:package` | 320 阶段通过（完整套件；generator consumer 新增 `generator-api` 与 `generator-mock` 阶段） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5r-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U27 后续：模板贡献面、交互式提问与更多生成器；
- U32：SSR；U25 的 `runtimePublicPath` 受 Vite chunk 导入限制，未交付等价实现；
- U16 Antd/dayjs 联动；U17 UI adapter；F6 多 builder 与微前端。
