# cormi F5v：重导出的 clientLoader

日期：2026-10-21。本切片补齐 U13 的约定式识别缺口：页面可以通过 `export { load as clientLoader } from './loader'` 或本地导出列表重导出 loader；检测仍使用零依赖词法扫描，不执行页面代码。

## 1. 使用方式

```ts
// src/reused-loader.ts
export async function loadLabel() {
  return { label: 'reused loader' };
}
export { loadLabel as clientLoader };
```

```tsx
// src/pages/reused.tsx
export { clientLoader } from './reused-loader';

export default function Reused() {
  const data = useClientLoaderData<{ label: string }>();
  return <p>{data.label}</p>;
}
```

页面无需直接声明 `clientLoader`，约定扫描会把它写入路由 IR。

## 2. 契约与语义

- 识别范围：原有的 `export function/async function/const clientLoader`，以及 `export { … }` / `export { … } from '…'` 形式的**值**导出；
- 导出列表：支持 `clientLoader`、`local as clientLoader`、`x as clientLoader`；`clientLoader as other` 不算；空项与非法项忽略；
- 类型导出：`export type { clientLoader }` 与 `export type X = …` 仍不识别；
- 去注释/字符串：沿用词法扫描，注释或字符串中的文本不触发；
- 生成：路由的 loader 仍调用页面模块上的 `clientLoader` 绑定，重导出由模块系统解析；`loaders.d.ts` 使用页面模块的导出类型，因此本地重导出与跨文件重导出都能得到正确返回类型；
- 不读取目标文件：扫描只判断页面自身是否有该导出；目标绑定是否存在由打包与 typecheck 报告；
- 退出/失败：与直接声明一致；loader 抛错由本路由 `errorBoundary` 呈现。

## 3. 与 Umi 4 的差异

Umi 的 clientLoader 识别基于其路由生成流程；cormi 保持显式词法扫描，新增重导出只扩展可识别的语法，不引入 TypeScript 依赖。

| 方面 | Umi 4 | cormi F5v |
| --- | --- | --- |
| 识别实现 | 构建工具 | 零依赖词法扫描 |
| 本地导出列表 | 支持 | 支持 |
| 跨文件重导出 | 支持 | 支持（值导出） |
| `export type` | 不计入 | 不计入 |
| 动态/命名空间重导出 | 视实现 | 未支持 |

## 4. 限制

- 只支持静态 `export { … }` 列表；`export * from`、`export * as ns from` 与运行时拼接不识别；
- 不验证被重导出的绑定是否存在（由打包/typecheck 负责）；
- 不识别 CommonJS `module.exports` 或默认导出改名；
- 扫描上限仍为 512 个页面、单文件 1 MiB；
- 重导出的 loader 数据类型依赖页面模块的导出类型；若目标模块类型私有会按 TS 规则报错。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/page-loaders.test.ts`（本地/跨文件重导出、别名、`export type`、反例） | 2/2 |
| `tests/browser/client-loader.test.ts`（新增 reused 页面：导航、深链接、构建预览与类型契约） | 1/1 |
| `pnpm check` | 541/541，0 失败/取消/跳过（F5u 为 541，本切片无新增测试函数） |
| `pnpm test:browser` | 51/51，0 失败/取消/跳过（无新增文件） |
| `pnpm test:package` | 320 阶段通过（完整套件；client-loader consumer 的夹具包含重导出页面） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5v-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U13 后续：数据预取与 SSR loader；
- U32：SSR；U16 Antd/dayjs 联动；U17 UI adapter；
- U25 的 runtimePublicPath 受 Vite chunk 导入限制未交付；F6 多 builder 与微前端。
