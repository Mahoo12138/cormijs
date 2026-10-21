# cormi F5u：loader 数据类型

日期：2026-10-21。本切片补齐 U13 的类型部分：编译时生成 `.cormi/loaders.d.ts`，按路由 id 暴露 `clientLoader` 的返回类型，应用可写 `CormiLoaderData.Data<'<route-id>'>`，不再手写与 loader 保持同步的接口。

## 1. 使用方式

```ts
// src/loader-contract.ts；无需 import，tsconfig 已包含 .cormi/**/*
type MemberData = CormiLoaderData.Data<'config:member/:id'>;
const member: MemberData = { id: '42', hits: 7 };
// @ts-expect-error loader data keeps the declared result type
const bad: MemberData = { id: '42', hits: '7' };
```

```tsx
// 页面仍用运行时泛型读取
const data = useClientLoaderData<CormiLoaderData.Data<'config:member/:id'>>();
```

生成的 `.cormi/loaders.d.ts`：

```ts
declare namespace CormiLoaderData {
  interface Routes {
    "config:member/:id": Awaited<ReturnType<typeof import("../src/Member.tsx")["clientLoader"]>>;
  }
  type Data<Id extends keyof Routes> = Routes[Id];
}
```

## 2. 契约与语义

- 来源：路由 IR 中所有同时具有 `module` 与 `clientLoader` 的路由；约定式页面与配置式路由一视同仁；
- 生成：按路由 id 排序，模块说明符由既有 client 解析器生成（相对 `.cormi/`，拒绝服务端/私有/符号链接模块），结果类型为 `Awaited<ReturnType<typeof import(...)[exportName]>>`；
- 发布：与 `routes.d.ts`/`locale.d.ts`/`app.tsx` 同级、由 `AtomicEntry` 原子替换的受管文件；加入应用 typecheck 的生成输入白名单；
- 空集合：没有 loader 时生成空的 `Routes` 接口，`keyof` 为 `never`，不会误放行任意 id；
- 类型错误：删除/改名 loader 导出会在应用 typecheck 中暴露，不会悄悄退化为 `unknown`；
- 运行时不变：`useClientLoaderData<T>()` 仍由调用方提供泛型，本文件只是类型来源；loader 执行、错误边界与预取行为不变；
- 退出：路由或导出移除后重新生成；无 loader 时文件保留为空接口，避免残留旧 id。

## 3. 与 Umi 4 的差异

Umi 的 routeProps/clientLoader 类型随其生成流程产出；cormi 使用轻量环境命名空间，不修改页面模块或生成包装组件。

| 方面 | Umi 4 | cormi F5u |
| --- | --- | --- |
| 类型来源 | 生成路由类型 | 路由 IR 的 module + clientLoader |
| 使用方式 | routeProps/自动类型 | 显式 `Data<'id'>` 泛型 |
| 运行时 | 生成包装 | 不变 |
| 空集合 | 视实现 | 空接口/`never` |

## 4. 限制

- 按路由 **id** 索引，不按 URL 路径；配置式与约定式 id 规则不同，可用 `inspect`/`routes.d.ts` 查看；
- 只覆盖 `clientLoader`，没有 serverLoader/SSR 数据类型；
- 不自动把类型注入 `useClientLoaderData`，调用方仍需泛型；
- 重导出 loader（`export { clientLoader } from …`）不被约定式识别，也不进入该文件；
- 生成的 import 类型依赖应用 tsconfig 包含 `.cormi/**/*`（create 模板默认如此）。

## 5. 验证

验证环境：macOS arm64、Node 22.14.0、pnpm 10.6.3、TypeScript 5.9.3、Playwright 1.58.2 与实测 Edge 155.0.4283.62。

| 检查 | 结果 |
| --- | --- |
| `tests/loader-types.test.ts`（排序、空集合、约定式页面生成、typecheck 输入） | 2/2 |
| `tests/browser/client-loader.test.ts`（dev/typecheck/build/preview；`Data<'config:member/:id'>` 正负断言） | 1/1 |
| `pnpm check` | 541/541，0 失败/取消/跳过（F5t 为 539，新增 2 项） |
| `pnpm test:browser` | 51/51，0 失败/取消/跳过（无新增文件） |
| `pnpm test:package` | 320 阶段通过（完整套件；client-loader consumer 的 typecheck 包含类型契约） |

详细计数、日志哈希和源码哈希见 [机器证据](../artifacts/f5u-validation.json)。这些是本机证据，不是公开发布或跨平台承诺。

## 6. 下一步

- U13 后续：loader 重导出的约定式识别、数据预取与 SSR loader；
- U32：SSR；U16 Antd/dayjs 联动；U17 UI adapter；
- U25 的 runtimePublicPath 受 Vite chunk 导入限制未交付；F6 多 builder 与微前端。
