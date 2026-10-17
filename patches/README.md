# Cordis RC.11 声明文件兼容补丁

`cordis@4.0.0-rc.11` 的 npm 声明使用 `export * from './context'` 等无扩展名相对导入；在 `type: module` 与 TypeScript NodeNext 解析下，消费者无法读取 Context/Fiber/Plugin 等导出。

本补丁只给 `lib/*.d.ts` 的相对模块路径添加 `.js`，包含声明合并和 import 类型表达式。不改 `lib/index.js`，不修改本地 `cordis/` 参考仓库，不把未发布的生命周期修复偷偷带入。pnpm `patchedDependencies` 和锁文件记录补丁哈希；`tests/isolation.test.ts` 在无 Vite 的独立物理副本中同时验证 Node ESM 运行与 NodeNext 类型消费。

当前包仍为 private 实验包。这个 workspace 补丁不会自动传播给未来 npm 消费者；正式发布前必须等待上游声明修复，或采用明确分发并保留许可的适配产物。不能直接删除 private 后宣称已可发布。

基线：npm gitHead `0b96d9fd517b998e44e2209560c9e5f0671ce933`。仅修复声明后运行 P0 实验；参考 HEAD `5dac6953d2d993d345d1de9fb0a5926f6d78a7e7` 是不同提交。

P2a 进一步检查发现 `lib/utils.d.ts` 仍通过 `'.'` 引用目录入口，原补丁漏掉了这类写法。补充为 `'./index.js'`，仍仅改声明，不升级或修改 Cordis 运行时代码；本轮同时重新验证严格声明检查。

P3a 使用实际 tgz 安装证明：不配置根补丁时 ESM 运行正常，但严格 NodeNext 类型消费失败；本地试用包将这份补丁放入 compatibility，由消费者根 patchedDependencies 显式启用。脚本还比较原始/兼容安装中的 Cordis 运行时代码哈希，不通过新增 Context 副本、postinstall 或 skipLibCheck 遮蔽问题。公开 npm/yarn 的透明安装尚未解决。

[Cordis 许可副本](CORDIS-LICENSE)来自参考 checkout 的根 LICENSE，固定提交为 `5dac6953d2d993d345d1de9fb0a5926f6d78a7e7`；npm 包元数据声明 MIT，但实测包根没有 LICENSE 文件，因此本地 kit 附带这份已核对的上游文本并标明来源。这不是替 cormi 选择开源许可证。详见 [消费者协议](../docs/15-package-consumers.md)。
