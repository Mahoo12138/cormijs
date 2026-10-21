# cormi F5j：约定式路由的 clientLoader 识别

日期：2026-10-20。本切片补齐 U13 的约定式缺口：`src/pages/**` 的页面文件若导出 `clientLoader`，约定路由会自动获得该 loader；检测使用零依赖的词法扫描（先把注释、字符串与模板内容抹成空格），注释/字符串/`declare`/类型导出都不会误判。配置式路由仍以 `clientLoader` 字段显式声明（F5a）。

## 1. 使用方式

```tsx
// src/pages/member/[id].tsx —— 无需在配置里声明 clientLoader
export default function Member() {
  const data = useClientLoaderData<{ id: string }>();
  return <p>{data.id}</p>;
}
export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  return { id: params.id ?? '-' };
}
```

`pnpm cormi dev` 即可；深链接 `/member/42` 在渲染前完成取数。示例之外的验收见下文脚本。

## 2. 契约与语义

- 检测：`detectClientLoader(source)` 在去除注释/字符串后的源码上扫描，只认顶层 `export function clientLoader`、`export async function clientLoader`、`export const clientLoader = …` 三种形式；重导出 `export { clientLoader } from …`、`declare`、类型别名与未导出声明都不注册；
- 装配：`routesFromFiles(files, directory, loaders)` 新增可选的 `loaders: { [file]: exportName }`，只对确有导出的页面写入 `clientLoader`；未导出的页面保持普通懒加载路由；
- 读取：`pageLoaders(root, files)` 读取每个页面源码（>1 MiB 跳过、至多 512 个文件），返回 `file → 'clientLoader'`；错误导出名仍由 `validateRoutes` 以 `ROUTE_CLIENT_LOADER_INVALID` 拦截；
- 观测：页面文件本身已在既有 `repairFiles` 观测集中（模块引用被登记），内容变化会触发生成更新；新增/删除页面由目录扫描与 `pageFiles` 处理；
- 生成：与 F5a 相同——loader 是路由的**静态**属性并自行 `import()` 页面模块，组件走 `lazy`，loader 抛错由该路由的 `errorBoundary` 承接；
- 退出：移除 `clientLoader` 导出后重新生成，路由回到不带 loader 的形状。

## 3. 与 Umi 4 的差异

Umi 的 clientLoader 功能（`packages/preset-umi/src/features/clientLoader/clientLoader.ts`）通过生成路由属性 `propertyName: 'clientLoader'` 在运行期把页面导出绑定为 loader；cormi 在编译期用轻量扫描检测并把导出名写入扁平 IR，因此类型检查与 `inspect.jsonc` 都能看到该字段，但只支持上述三种导出形式（重导出需改为直接导出）。

| 方面 | Umi 4 | cormi F5j |
| --- | --- | --- |
| 检测 | 运行期属性绑定 | 编译期词法扫描 |
| 支持形式 | 页面导出即可 | function / async function / const |
| 配置式 | 同一机制 | 显式字段（F5a） |
| 重导出 | 支持 | 不识别（文档限制） |

## 4. 限制

- 只识别三种直接导出；`export { clientLoader } from './x'` 或 `export { default as clientLoader }` 不会被检测，需改为直接定义；
- 检测基于词法扫描而非类型检查：`export const clientLoader = 1` 会注册，随后在运行时由 `clientLoaderOf` 报 `CLIENT_LOADER_INVALID`；
- 大于 1 MiB 的页面文件被跳过；页面数超过 512 时直接失败（避免无界扫描）；
- 约定式布局（`_layout`）同样参与检测，但布局文件通常没有 loader；
- 不做 loader 结果类型生成，页面需自带返回类型。

## 5. 验证

最终验证在 macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62 上执行。实现先用 TypeScript AST，触发了既有插件边界测试（`plugin-react` 不允许 `typescript` 依赖），因此改为零依赖词法扫描并重跑整套；这与“依赖边界优先于便利”的既有约束一致。

**独立包消费验证本轮未完成**：整机磁盘仅剩约 1.3 GiB（已按用户确认清理 `.cache/admin-*` 历史快照，仍不足以安装一个 consumer），`pnpm test:package`（含 `CORMI_PACKAGE_ONLY=conventional-loader` 子集）在第一个安装阶段即 `ERR_PNPM_ENOSPC`，运行到 1 个阶段。`conventional-loader` consumer 块已加入脚本但**未执行**，本切片不能宣称“独立安装消费已验证”。

| 检查 | 结果 |
| --- | --- |
| `tests/page-loaders.test.ts`（注释/字符串/declare/类型导出不误判、装配与非法导出名） | 2/2 |
| `tests/plugin-boundaries.test.ts`（依赖边界：无新增运行时依赖） | 2/2 |
| `tests/browser/conventional-loader.test.ts`（dev、typecheck、build、preview） | 1/1 |
| `pnpm check` | 515/515，0 失败/取消/跳过（F5i 为 513，新增 2 项；约 128 秒） |
| `pnpm test:browser` | 49/49，0 失败/取消/跳过（F5i 为 48，新增 1 项；约 344 秒） |
| `pnpm test:package` | **未完成**：ENOSPC，1 阶段（consumer 未执行） |

浏览器验收断言：约定式页面 `member/[id].tsx` 的 `clientLoader` 被识别，深链接 `/member/7` 与站内导航到 `/member/42` 都先取数再渲染（`data-id`/`data-loaded`），刷新后一致；dev 与静态 preview 相同；无控制台错误与开发覆盖层。

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5j-validation.json)（package 结果标记为未完成）。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U13 剩余：loader 数据类型生成、重导出支持；
- U32/U34/U35：SSR、MPA、生产 API 路由；U25 externals/runtimePublicPath；
- F5k 已交付 locale key 类型，见 [F5k locale 类型](93-f5k-locale-types.md)；U16 ICU、U17 UI adapter、F6 多 builder 与微前端待后续。
