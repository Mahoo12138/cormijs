/** Inert application template data. No template code is evaluated by the creator. */
export function applicationConfig(api: boolean): string {
  return `import { defineConfig } from 'cormijs';
import reactVite from '@cormijs/preset-react-vite';
${api ? "import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';\nimport { mocks } from './mock';\n" : ''}
// Change this one value when deploying under a URL prefix, for example /workbench/.
const base = '/';
export default defineConfig(({ command }) => ({
  presets: [reactVite],
  app: { base, server: { host: '127.0.0.1', port: 8000 } },
${api ? "  plugins: [{ id: 'dev-api', plugin: devApiVitePlugin, enabled: command === 'dev', options: { prefix: base + 'api', mocks } }],\n" : ''}}));
`;
}
export function applicationPage(api: boolean): string {
  return `import { ${api ? 'useEffect, useRef, ' : ''}useState } from 'react';
import '../style.css';

export default function Home() {
  const [count, setCount] = useState(0);
  const title = import.meta.env.CORMI_PUBLIC_TITLE ?? '开始构建你的应用。';
${api ? `  const [result, setResult] = useState('尚未请求');
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  async function load() {
    if (!import.meta.env.DEV) return;
    request.current?.abort();
    const control = new AbortController(); request.current = control; setPending(true);
    try {
      const response = await fetch(import.meta.env.BASE_URL + 'api/hello?name=cormi', { signal: control.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('message' in data) || typeof data.message !== 'string') throw new Error('Invalid API response');
      if (request.current === control && !control.signal.aborted) setResult(data.message);
    } catch (error) {
      if (request.current === control && !control.signal.aborted) setResult(error instanceof Error ? error.message : '请求失败');
    } finally {
      if (request.current === control && !control.signal.aborted) { request.current = null; setPending(false); }
    }
  }
` : ''}  return <main><p className="eyebrow">CORMI / APPLICATION</p><h1>{title}</h1><p>页面、构建工具与开发能力由插件组合提供。</p><button onClick={() => setCount(value => value + 1)}>Count: {count}</button>${api ? '<section><h2>开发接口</h2><p>Mock 仅在 dev 中启用，生产环境请提供真实 API。</p><button onClick={load} disabled={pending || !import.meta.env.DEV}>{pending ? "请求中…" : "请求 Mock"}</button><output aria-live="polite">{result}</output></section>' : ''}</main>;
}
`;
}
export const applicationAssets = `// These are module types, not a check that an asset exists. Build verifies imports.
// Keep this file a script: adding a top-level import/export changes ambient declarations into augmentations.
declare module '*.module.css' { const classes: Readonly<Record<string, string>>; export default classes; }
declare module '*.svg' { const url: string; export default url; }
declare module '*.png' { const url: string; export default url; }
`;
export const applicationReadme = `# cormi 应用

这是尚未公开发布的本地试用应用。使用 Node 22.14+、pnpm 10.6.3；先执行 pnpm install --ignore-scripts，然后 pnpm prepare:app 和 pnpm dev。创建器不会安装依赖或执行模板。

## 日常命令

停止 dev 后运行 pnpm typecheck，再运行 pnpm build，最后 pnpm preview。build 负责转译，不替代类型检查。pnpm run config:app --for build --mode staging 查看配置来源；pnpm diagnose --for dev 查看新 worker 插件依赖；pnpm inspect 读取上次生成快照。config:app 刻意避开 pnpm config 内建命令。相同项目只允许一个 cormi CLI 会话。

## 页面、类型与环境

页面放在 src/pages；_layout.tsx 使用 Outlet，动态文件使用 [id].tsx。首次 prepare:app 生成 .cormi 中的路由与 ImportMetaEnv 类型，tsconfig 已包含该目录；src/assets.d.ts 提供 CSS Modules、SVG、PNG 的有限导入声明。类型声明不证明文件存在，仍需执行 build。不要为了编译通过关闭 strict 或声明整个 SDK 为 any。

.env、.env.local、.env.<mode>、.env.<mode>.local 依次覆盖，继承进程值优先。客户端只接收 CORMI_PUBLIC_ 前缀；例如 CORMI_PUBLIC_TITLE 设置首页标题。未声明的公开值类型为 string | undefined。mode 选择文件，dev/build 决定开发/生产语义。私有值不能放入路由 meta 或 runtime options；美元符号不展开。

## 开发接口与部署前缀

react-api 模板的 Mock 只在 dev 注册，页面生产按钮禁用，不会请求一个不存在的演示后端。修改 cormi.config.ts 中的 base，例如 /workbench/，同时影响 Router、构建资源和模板 Mock URL；不要另外硬编码根 /api。真实后端 URL 是应用自己的契约，不由 base 自动替第三方接口重写。

## 静态部署

只向静态服务器交付 dist 中的站点文件，不上传 src、.env、node_modules、.cormi 或 .cormi-local。排除 dist/.cormi-build.json 等受管元数据；不要从本机原 dist 删除它，否则下次受管构建会拒绝覆盖。服务器应将应用导航回退到该 base 下的 index.html，但缺失 JS/CSS/图片和 API 必须返回真实 404 或交给后端，不能都回退成 HTML 200。preview 仅用于本地验收，不是生产服务器。公开变量写入 bundle 后，改 .env 不会改变已部署页面，必须重建。

.cormi-local 保存框架 tarball、显式 Cordis 声明补丁与许可；移动整个开发项目时必须保留。第三方依赖不在 kit 内，首次安装可能需要网络。当前仍 private，未保证普通 npm/yarn 无补丁消费、Windows、SSR 或线上运维。
`;
