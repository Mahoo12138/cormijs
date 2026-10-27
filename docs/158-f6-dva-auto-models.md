# F6-10：dva 自动发现、immer 与 loading

日期：2026-10-26。本切片补齐 F6-3 的 Umi dva 使用体验：`@cormijs/plugin-dva` 自动发现 `src/models/**`，挂载每应用独立的 dva Provider；`@cormijs/dva` 增加可选 immer 变异 reducer 与 loading 模型。仍保留显式 `createDvaRuntime`，便于自定义目录、额外模型或非 Vite 组合。

## 1. 使用方式

```ts
import { dvaPlugin } from '@cormijs/plugin-dva';

export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'dva', plugin: dvaPlugin, options: { immer: true, loading: true } }],
  app: { base: '/dva-auto/' },
});
```

`src/models/counter.ts` 默认导出一个 model；页面照常从 `@cormijs/dva` 使用 hooks：

```ts
export default {
  namespace: 'counter',
  state: { count: 0 },
  reducers: {
    increment(state: { count: number }) { state.count += 1; return state; },
  },
  effects: {
    *incrementAsync(_action: unknown, { call, put }: any) {
      yield call(() => new Promise(resolve => setTimeout(resolve, 500)));
      yield put({ type: 'increment' });
    },
  },
};
```

```tsx
const count = useSelector((state: any) => state.counter.count);
const loading = useSelector((state: any) => state.loading.global);
const dispatch = useDispatch();
```

## 2. 契约与语义

- `@cormijs/dva/auto` 在应用根执行 Vite `import.meta.glob('/src/models/**/*.{ts,tsx}', { eager: true })`，按文件路径排序，要求每个文件默认导出对象 model。排除 `*.test.*`/`*.spec.*`/`*.d.ts`；空目录也允许，Provider 正常挂载但不注册业务 model。
- model 校验复用 `createDvaRuntime`：namespace 必填且唯一，reducers/effects/subscriptions 必须是函数表；重复 namespace 在启动时报 `DVA_INVALID`。
- `dvaPlugin` 通过 runtime 贡献挂载 `dvaRuntime`，store 按应用挂载独立创建。`options`：
  - `loading` 默认 `true`（贴近 Umi）：注册保留 namespace `loading`，状态为 `{ global, models, effects }`；每个 effect 开始/结束自动 dispatch `loading/show`/`loading/hide`，失败也在 finally 收尾。
  - `immer` 默认 `false`：为每个 reducer 包一层 immer `produce`，允许直接修改 draft；纯函数 reducer 仍可返回新状态。
- 显式 `dvaPlugin` 的 `id` 可替换，允许与其它 runtime provider 组合。
- Vite 插件把 `@cormijs/dva/auto` 排除出依赖预打包，以便 `import.meta.glob` 在应用根展开；同时把 auto 内的本地运行时代码导入改写到已优化的 `@cormijs/dva` 入口，避免 CJS `@babel/runtime/regenerator` 的默认导出互操作问题。
- 模型文件仍参与普通 Vite 构建/HMR；自动发现使用 eager glob，不带模型级拆包。
- 未启用插件时，应用可继续显式 `createDvaRuntime(models, options)`；`allowEmpty` 仅用于自动发现无模型场景。

## 3. 边界

- 自动发现固定 `src/models`、固定 Vite；不支持自定义目录、`extraModels`、非 Vite builder 或运行时动态新增模型目录。
- 所有 model 在应用入口 eager 导入；没有按路由懒加载、SSR store dehydration/hydration、getDvaApp 全局单例或 HMR 保留 store。
- loading 只提供全局/模型/effect 计数状态；没有 delay、debounce、忽略 effect 名单或 Umi `dva-loading` 的全部配置。
- immer 仅包裹 reducer；effects/subscriptions 的 state 修改仍遵循 dva/saga 语义。
- 不桥接 cormi `modelPlugin`/`useModel`；两套模型系统不要管理同一 namespace。
- 未验证 Windows、非 Edge 浏览器、真实复杂 saga 取消或长期 Provider 卸载后的 task 清理。

## 4. 验证

验证环境：`dva-core@2.0.4`、`redux@4.2.1`、`immer@11.2.9`、React 19.3.1、Playwright 1.58.2、Edge 156.0.4314.42、macOS arm64。

| 检查 | 结果 |
| --- | --- |
| `tests/dva.test.ts` | 显式 model 校验、空模型 allowEmpty、loading namespace 保留、布尔选项 |
| `tests/browser/dva.test.ts` | 显式 runtime + 自动发现两套：两个 `src/models`、immer 变异 reducer、异步 effect、loading true/false、dev/build/preview |
| 安装包 `dva` consumer | `@cormijs/plugin-dva` 安装、typecheck、公共类型、auto 模型 dev/build/preview |
| `pnpm check` | 584/584 |
| `pnpm test:browser` | 63/63 |
| `pnpm test:package` | 83 阶段（`CORMI_PACKAGE_ONLY=dva`，暖缓存离线安装；全量未重跑） |

完整日志哈希、源码集合与计数见 [机器证据](../artifacts/f6-dva-auto-validation.json)。

## 5. 下一步

- F6 剩余：qiankun 全局 `registerMicroApps`/函数式 activeRule、多 builder/MFSU、dva 自定义目录/extraModels/SSR；
- U33 按语言拆分、U09 热替换、U16 请求 locale、SSR 生产化、U17 服务端图表。
