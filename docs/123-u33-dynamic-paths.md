# U33-3：动态路径生产者与预渲染容错

日期：2026-10-22。本切片对齐 Umi `exportStatic.extraRoutePaths` 的两项能力：`prerenderPaths` 可以是异步函数，在构建时产出路径列表；`prerenderIgnoreErrors` 允许单页渲染失败时记录并跳过，而不是让整个构建失败。默认仍为严格失败。

## 1. 使用方式

```ts
{ id: 'ssr', plugin: ssrPlugin, options: {
  id: 'application:ssr',
  prerender: true,
  prerenderPaths: async () => {
    const ids = await loadPublishedIds();
    return ids.map(id => `/articles/${id}`);
  },
  prerenderIgnoreErrors: false,
  sitemap: 'https://example.com',
} },
```

## 2. 契约与语义

- **路径来源**：`prerenderPaths` 接受字符串数组或 `() => string[] | Promise<string[]>`。函数在客户端构建完成、SSR bundle 就绪后调用一次；结果与字面路由合并、去重、排序。
- **校验**：数组/函数返回的每一项必须是内部应用路径（`/` 开头、非 `//`、≤512 字符、无 `?`/`#`/`%`/`\`/空字节、无 `.`/`..` 段）；最多 10000 条。非法值以 `SSR_INVALID` 失败。
- **时机**：数组在插件初始化时校验；函数只在构建的 prerender 阶段调用，函数抛错或返回非法值导致构建失败，除非是页面级渲染错误且开启容错。
- **容错**：`prerenderIgnoreErrors: true` 时，单页 `render`/注入/写文件异常记录到 skipped（`status: 0`, `error` 文本）并继续；默认 false，保持“预渲染失败即构建失败”。HTTP Response/状态 ≥400 无论容错与否都跳过（不是异常）。
- **sitemap**：只包含成功写出的路径；容错跳过的页面既不写 HTML 也不进 sitemap。
- **shell**：无论路径来源如何，`dist/.cormi/shell.html` 都在预渲染前保存。
- **选项依赖**：`prerenderPaths`/`prerenderIgnoreErrors` 都需要 `prerender: true`，否则 `SSR_INVALID`。

## 3. 边界

- 路径生产者不能访问浏览器上下文；它在构建进程执行，可用 Node API，但结果必须是字符串数组。
- 生产者没有缓存或增量调用；每次构建执行一次。函数内的远程请求失败由应用自行处理。
- `ignoreErrors` 只捕获单页异常；路径生产者异常、SSR bundle 构建失败、shell 缺失仍使构建失败。
- 没有每页 `prerender: false` 的对象条目（Umi 支持），也没有并发渲染或重试。
- 页面返回 404/500 会被静默跳过并记录 skipped，不写入错误页文件。

## 4. 与 Umi 的差异

| 方面 | Umi exportStatic | cormi U33-3 |
| --- | --- | --- |
| extraRoutePaths | 数组或函数 | 数组或异步函数 |
| 错误容忍 | ignorePreRenderError | prerenderIgnoreErrors |
| 每页关闭 | 对象条目 | 仅路径字符串 |
| 并发 | 生态实现 | 顺序渲染 |
| sitemap | 插件生态 | 内置 |

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts` | 数组/异步函数解析、非法路径与类型、单页异常默认失败、ignoreErrors 跳过且 sitemap 排除 |
| `tests/browser/ssr.test.ts` | fixture 使用异步 `prerenderPaths` 生成 `/backend/7`，预渲染内容与 sitemap 校验通过 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u33-3-dynamic-paths-validation.json |

完整计数、日志哈希与源码哈希见 [机器证据](../artifacts/u33-3-dynamic-paths-validation.json)。

## 6. 下一步

- U33 剩余：每页关闭、并发/增量、robots 与 sitemap index；
- U17 Antd/ProLayout、U12 容量/失效、U16 RTL、SSR 生产化与 F6。
