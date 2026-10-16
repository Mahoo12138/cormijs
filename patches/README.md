# Cordis RC.11 声明文件兼容补丁

`cordis@4.0.0-rc.11` 的 npm 声明使用 `export * from './context'` 等无扩展名相对导入；在 `type: module` 与 TypeScript NodeNext 解析下，消费者无法读取 Context/Fiber/Plugin 等导出。

本补丁只给 `lib/*.d.ts` 的相对模块路径添加 `.js`，包含声明合并和 import 类型表达式。不改 `lib/index.js`，不修改本地 `cordis/` 参考仓库，不把未发布的生命周期修复偷偷带入。pnpm `patchedDependencies` 和锁文件记录补丁哈希；`tests/isolation.test.ts` 在无 Vite 的独立物理副本中同时验证 Node ESM 运行与 NodeNext 类型消费。

当前包仍为 private 实验包。这个 workspace 补丁不会自动传播给未来 npm 消费者；正式发布前必须等待上游声明修复，或采用明确分发并保留许可的适配产物。不能直接删除 private 后宣称已可发布。

基线：npm gitHead `0b96d9fd517b998e44e2209560c9e5f0671ce933`。仅修复声明后运行 P0 实验；参考 HEAD `5dac6953d2d993d345d1de9fb0a5926f6d78a7e7` 是不同提交。
