# U33-4：每页关闭与增量预渲染

日期：2026-10-22。本切片补齐预渲染控制：`prerenderPaths` 支持 `{ path, prerender: false }` 对象条目，保留配置但跳过本次构建；`prerenderIncremental` 在渲染结果与既有 HTML 相同时不重写文件。渲染仍为顺序执行。

## 1. 使用方式

```ts
{ id: 'ssr', plugin: ssrPlugin, options: {
  id: 'application:ssr',
  prerender: true,
  prerenderPaths: async () => [
    { path: '/articles/1' },
    { path: '/articles/draft-2', prerender: false },
  ],
  prerenderIncremental: true,
  sitemap: 'https://example.com',
} },
```

## 2. 契约与语义

- **对象条目**：条目为字符串或 `{ path, prerender? }`；未知字段、非字符串 path、非 boolean prerender 以 `SSR_INVALID` 失败。`prerender: false` 的路径不进入本次预渲染与 sitemap。
- **校验**：启用条目的路径规则与字符串条目一致（内部绝对路径、无 `.`/`..`/查询/哈希/编码特殊字符、≤512）；去重、排序后返回。
- **增量**：`prerenderIncremental: true` 时，页面仍会执行 SSR（loader/head 均运行），但生成的 HTML 与目标文件完全相同时不写文件，记入 `unchanged`；`written` 只含实际写入的路径。sitemap 同时包含 written 与 unchanged。
- **默认**：增量关闭，保持每次都写入；`prerenderIncremental`/`prerenderPaths`/`prerenderIgnoreErrors` 均需要 `prerender: true`。
- **错误**：增量读取目标文件除 ENOENT 外的错误仍使构建失败；页面异常遵循 `prerenderIgnoreErrors`。
- **结果**：`PrerenderResult` 新增 `unchanged` 数组；`written`/`unchanged`/`skipped` 均冻结。

## 3. 边界

- 增量只比较最终 HTML 字符串，不比较依赖文件哈希；SSR 仍会完整执行，因此不节省渲染时间，只避免磁盘写入/mtime 变化。
- 没有并发渲染、远程缓存或按路由 hash 重建；路径顺序仍为拓扑无关的字典序。
- `prerender: false` 仅跳过预渲染，不会从路由或 sitemap 删除该路由的其他用途。
- 动态禁用条目不会记录到结果；需要审计时应在路径生产者中记录。
- 未提供 robots.txt 或 sitemap index。

## 4. 与 Umi 的差异

| 方面 | Umi exportStatic | cormi U33-4 |
| --- | --- | --- |
| 每页关闭 | 对象条目 prerender:false | 同左 |
| 增量 | 生态/插件 | 比较最终 HTML |
| 并发 | 生态实现 | 顺序 |
| robots | 插件生态 | 未提供 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts` | 对象条目过滤/校验、增量二次运行 written 为空且 unchanged 命中、sitemap 保留 |
| `tests/browser/ssr.test.ts` | fixture 的 `/backend/7` 预渲染、`/backend/8` 关闭、sitemap 排除；既有预渲染/SSR 用例保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u33-4-prerender-control-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u33-4-prerender-control-validation.json)。

## 6. 下一步

- U33 剩余：并发渲染、robots/sitemap index；
- U17 ProLayout/图表、F6、U12 throttle/持久化、U16 请求 locale、SSR 生产化。
