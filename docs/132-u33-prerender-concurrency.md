# U33-6：并发预渲染

日期：2026-10-22。预渲染支持 `prerenderConcurrency`（1–16，默认 1）：多个页面并行执行 SSR 与写文件；结果数组仍按页面路径顺序输出，sitemap 顺序不变。默认保持既有的顺序执行语义。

## 契约

- `ssrPlugin.prerenderConcurrency?: number`，整数 1–16；非法值 `SSR_INVALID`，且需要 `prerender: true`。
- 工作池大小 `min(concurrency, pages.length)`；每个 worker 取下一个页面，直到队列耗尽或出现不可忽略错误。
- 默认 `1`：行为与之前一致（顺序渲染、顺序写入）。
- 结果：`written`/`unchanged`/`skipped` 始终按输入页面顺序组装；sitemap URL 同样按页面顺序。
- 错误：`prerenderIgnoreErrors` 时单页异常转为 skipped，不终止其他 worker；未开启时首个异常停止调度，等待在途页面结束后抛出。
- 路径包含校验仍在页面渲染前执行，属于编程错误，开启容错也不会吞掉。

## 边界

- 并发不保证文件写入完成的先后顺序，只保证结果数组顺序；同目录 mkdir recursive 安全。
- 没有速率限制、每页超时或取消；SSR bundle 内的共享状态需自行保证并发安全。
- 不并行执行路径生产者（仍在构建时调用一次）。
- `prerenderIncremental` 的比较/写入在并发下按页独立；同一路径不会重复调度。
- 未提供 worker 线程/进程隔离。

## 验证

| 检查 | 结果 |
| --- | --- |
| `tests/ssr.test.ts` | 并发峰值 >1 且 ≤3、结果保持页面顺序、非法选项 |
| `tests/browser/ssr.test.ts` | fixture 以 `prerenderConcurrency: 2` 构建，预渲染/robots/sitemap 断言保持 |
| `pnpm check` / `pnpm test:browser` / `pnpm test:package` | 见 artifacts/u33-6-prerender-concurrency-validation.json |
