import { assetToolsScript, buildPluginScript } from './plugin-assets.js';

// A plugin-author workspace, not another plugin loader. All generated files are inert data.
export function pluginManifest(name: string, refs: Record<string, string>, versions: Record<string, string>) {
  const peers = ['@cormijs/core', '@cormijs/plugin-react', '@cormijs/runtime', '@cormijs/plugin-dev-api'];
  return {
    name, version: '0.0.0', private: true, type: 'module', packageManager: 'pnpm@10.6.3', engines: { node: '>=22.14.0' },
    files: ['dist', 'src', 'README.md'], sideEffects: ['**/*.css'],
    exports: Object.fromEntries([['.', 'index'], ['./api', 'api'], ['./client', 'client'], ['./page', 'page']].map(([key, file]) =>
      [key!, { types: `./dist/${file}.d.ts`, import: `./dist/${file}.js` }])),
    scripts: {
      build: 'node scripts/build.mjs', typecheck: 'tsc -p tsconfig.build.json --noEmit',
      dev: 'cormi dev', 'check:app': 'cormi typecheck', 'build:app': 'cormi build', preview: 'cormi preview',
      diagnose: 'cormi diagnose', 'pack:plugin': 'node scripts/pack.mjs',
    },
    peerDependencies: { ...Object.fromEntries(peers.map(key => [key, versions[key]])), react: '19.3.1' },
    peerDependenciesMeta: { '@cormijs/plugin-dev-api': { optional: true } },
    devDependencies: {
      ...Object.fromEntries(['cormijs', '@cormijs/preset-react-vite', '@cormijs/core', '@cormijs/plugin-react', '@cormijs/runtime', '@cormijs/plugin-dev-api', '@cormijs/plugin-vite'].map(key => [key, refs[key]])),
      react: '19.3.1', 'react-dom': '19.3.1', 'react-router': '7.18.2', typescript: '5.9.3',
      '@types/node': '22.13.10', '@types/react': '19.2.0', '@types/react-dom': '19.2.0',
    },
    pnpm: { overrides: refs, patchedDependencies: { 'cordis@4.0.0-rc.11': '.cormi-local/compatibility/cordis.patch' } },
  };
}

export function pluginTemplateFiles(name: string): Record<string, string> {
  const id = 'plugin:' + name.replace(/^@/, '').replace('/', '.');
  return {
    'src/index.ts': `import type { Plugin } from '@cormijs/core';
import { defineReactFeature } from '@cormijs/plugin-react';
import api from './api.js';

export interface Options { development: boolean; label: string; apiBase: string }
// Cordis validates options. Do not infer command mode from process-global mutable state.
const Config: NonNullable<Plugin.Object<Options>['Config']> = {
  '~standard': { version: 1, vendor: 'cormi-plugin-template', validate(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { issues: [{ message: 'Expected plugin options' }] };
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(key => !['development', 'label', 'apiBase'].includes(key))
      || typeof value.development !== 'boolean' || typeof value.label !== 'string' || !value.label || value.label.length > 100
      || typeof value.apiBase !== 'string' || !/^\\/(?:[a-zA-Z0-9_-]+\\/)*[a-zA-Z0-9_-]+$/.test(value.apiBase)) {
      return { issues: [{ message: 'Expected development:boolean, bounded label, and an absolute API path without trailing slash' }] };
    }
    return { value: { development: value.development, label: value.label, apiBase: value.apiBase } };
  } },
};
const feature: Plugin.Object<Options> = {
  name: ${JSON.stringify(id)}, Config, inject: ['react'],
  apply(ctx, options) {
    ctx.plugin(defineReactFeature({ id: ${JSON.stringify(id + ':client')},
      routes: [{ id: ${JSON.stringify(id + ':page')}, path: 'plugin', module: { specifier: ${JSON.stringify(name + '/page')}, exportName: 'default' } }],
      runtime: [{ id: ${JSON.stringify(id + ':runtime')}, module: { specifier: ${JSON.stringify(name + '/client')}, exportName: 'default' },
        options: { label: options.label, apiBase: options.apiBase, development: options.development } }],
    }));
    if (options.development) ctx.plugin(api, { label: options.label });
  },
};
export default feature;
`,
    'src/api.ts': `import type { Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-dev-api/service';
export interface ApiOptions { label: string }
const api: Plugin.Object<ApiOptions> = {
  name: ${JSON.stringify(id + ':api')}, inject: ['devApi'],
  apply(ctx, options) {
    // add() binds this contribution to the calling Cordis scope and retracts it on disposal.
    ctx.devApi.add(${JSON.stringify(id + ':api')}, { mocks: [{ method: 'GET', path: '/hello',
      handle: ({ signal }) => { signal.throwIfAborted(); return { body: { message: 'Hello, ' + options.label + '!' } }; },
    }] });
  },
};
export default api;
`,
    'src/context.ts': `import { createContext, useContext } from 'react';
export interface PublicOptions { label: string; apiBase: string; development: boolean }
export const Settings = createContext<PublicOptions | null>(null);
export function usePluginOptions(): PublicOptions {
  const value = useContext(Settings);
  if (!value) throw new Error('Plugin Provider is missing');
  return value;
}
`,
    'src/client.tsx': `import type { PropsWithChildren } from 'react';
import type { RuntimePlugin } from '@cormijs/runtime';
import { Settings, type PublicOptions } from './context.js';
function Provider({ children, options }: PropsWithChildren<{ options: unknown }>) {
  const value = options as PublicOptions;
  return <Settings.Provider value={value}>{children}</Settings.Provider>;
}
const runtime: RuntimePlugin = { Provider };
export default runtime;
`,
    'src/page.tsx': `import { useEffect, useRef, useState } from 'react';
import { usePluginOptions } from './context.js';
import styles from './page.module.css';
import illustration from './assets/plugin-mark.svg';
export default function PluginPage() {
  const options = usePluginOptions();
  const [count, setCount] = useState(0), [result, setResult] = useState('尚未请求');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function load() {
    request.current?.abort();
    const control = new AbortController(); request.current = control; setResult('请求中…');
    try {
      const response = await fetch(options.apiBase + '/hello', { signal: control.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('message' in data) || typeof data.message !== 'string') throw new Error('Invalid API response');
      if (request.current === control && !control.signal.aborted) setResult(data.message);
    } catch (error) {
      if (request.current === control && !control.signal.aborted) setResult(error instanceof Error ? error.message : '请求失败');
    }
  }
  return <main className={styles.panel}><img className={styles.mark} src={illustration} width={48} height={48} alt="插件资源示例" /><h1>插件开发示例</h1><p>{options.label}</p>
    <button onClick={() => setCount(value => value + 1)}>Count: {count}</button>
    <p>本页面和 Provider 由同一个 Cordis 功能插件贡献。</p>
    <button onClick={load} disabled={!options.development}>请求插件 API</button>
    <output aria-live="polite">{result}</output>
    {!options.development && <p>生产模式没有开发 Mock，请接入真实服务。</p>}
  </main>;
}
`,
    'src/page.module.css': `@import './assets/tokens.css';
.panel { border: var(--cormi-plugin-border, 2px) solid currentColor; border-radius: 12px; background-image: url('./assets/plugin-mark.svg'); background-repeat: no-repeat; background-position: right 24px top 24px; background-size: 24px; }
.mark { display: block; object-fit: contain; }
`,
    'src/assets/tokens.css': ':root { --cormi-plugin-border: 2px; }\n',
    'src/assets/plugin-mark.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="32" rx="8" fill="none" stroke="#486582" stroke-width="3"/><path d="M16 24h16M24 16v16" stroke="#486582" stroke-width="3"/></svg>\n',
    'src/assets.d.ts': `declare module '*.module.css' { const classes: Readonly<Record<string, string>>; export default classes; }
declare module '*.svg' { const url: string; export default url; }
declare module '*.png' { const url: string; export default url; }
`,
    'cormi.config.ts': `import { fileURLToPath } from 'node:url';
import { defineConfig } from 'cormijs';
import type { Plugin } from '@cormijs/core';
import reactVite from '@cormijs/preset-react-vite';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';
import type {} from '@cormijs/plugin-vite';
import feature from './src/index.js';

// Author-only adapter: source TSX is hot-reloaded; distributable exports still point to dist.
const sourceBridge: Plugin.Object<void> = { name: 'author:source', inject: ['vite'], apply(ctx) {
  ctx.effect(() => ctx.vite.add('author:source', () => ({ name: 'author:source', config: () => ({ resolve: { alias: [
    { find: ${JSON.stringify(name + '/client')}, replacement: fileURLToPath(new URL('./src/client.tsx', import.meta.url)) },
    { find: ${JSON.stringify(name + '/page')}, replacement: fileURLToPath(new URL('./src/page.tsx', import.meta.url)) },
  ] } }) })));
} };
export default defineConfig(({ command }) => ({ presets: [reactVite], plugins: [
  { id: 'author-source', plugin: sourceBridge },
  { id: 'dev-api', plugin: devApiVitePlugin, options: { prefix: '/workbench/api' }, enabled: command === 'dev' },
  { id: 'example-plugin', plugin: feature, options: { development: command === 'dev', label: 'cormi author', apiBase: '/workbench/api' } },
], app: { base: '/workbench/', outDir: 'app-dist', server: { host: '127.0.0.1', port: 8003 },
  routes: [{ id: 'home', index: true, module: { specifier: './playground/Home.tsx', exportName: 'default' }, source: { file: 'playground/Home.tsx' } }],
} }));
`,
    'playground/Home.tsx': `import { Link } from 'react-router';
export default function Home() { return <main><h1>cormi 插件工作区</h1><Link to="/plugin">打开插件页面</Link></main>; }
`,
    'index.html': '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>cormi plugin playground</title><style>body{font-family:system-ui,sans-serif;margin:0}main{max-width:800px;margin:8vh auto;padding:24px}button{font:inherit;padding:10px;margin:8px 8px 8px 0}output{display:block;margin:16px 0}</style></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>\n',
    'tsconfig.build.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', jsx: 'react-jsx', lib: ['ES2023', 'DOM', 'DOM.Iterable'], strict: true, skipLibCheck: false, noEmitOnError: true, declaration: true, declarationMap: true, sourceMap: true, rootDir: 'src', outDir: 'dist' }, include: ['src/**/*.ts', 'src/**/*.tsx'] }, null, 2) + '\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', jsx: 'react-jsx', strict: true, skipLibCheck: false, noEmit: true }, include: ['src', 'playground', 'cormi.config.ts', '.cormi'] }, null, 2) + '\n',
    '.gitignore': 'node_modules/\ndist/\napp-dist/\nartifacts/\n.cormi/\n.cormi.lock/\n.cormi-vite-*/\n.cormi-publish-*/\n.cormi-publish.lock/\n.cormi-package-*/\n.env\n.env.*\n*.tsbuildinfo\n',
    '.npmrc': 'auto-install-peers=false\nstrict-peer-dependencies=true\nhoist=false\nignore-scripts=true\nmanage-package-manager-versions=false\n',
    'pnpm-workspace.yaml': 'packages: []\n',
    'scripts/pack.mjs': packScript,
    'scripts/resources.mjs': assetToolsScript,
    'scripts/build.mjs': buildPluginScript,
    'PACKAGE.md': `# ${name}\n\n本地 cormi 功能插件。请在已有 cormi 应用中安装此 tgz 并显式提供 peerDependencies。\n\n从 ${name} 导入默认 feature，在 defineConfig 的 plugins 中登记它，options 为 { development: command === 'dev', label: 'My plugin', apiBase: '/api' }。开发环境还需配置 DevApiService 与传输桥接，prefix 等于 apiBase；生产保留客户端而不安装开发 API。页面为 /plugin（受应用 base 影响）。\n\nNode 根入口 /api 与浏览器 /client、/page 分开。不得从浏览器代码导入根入口。缺少 provider 时使用 cormi diagnose --for dev；配置变化会重启 worker，不承诺所有状态保留。\n\n当前 private:true，仅作本地评估；仍需消费者自己的 Cordis RC.11 声明补丁。未选择许可证、未公开发布，也不包含作者的联调应用或本地框架归档。\n`,
    'README.md': `# ${name}

这是一个 cormi 插件作者工作区，不是已公开发布的 npm 包。

## 创建后

执行 \`pnpm install --ignore-scripts\`、\`pnpm build\`、\`pnpm dev\`，访问 \`127.0.0.1:8003/workbench/plugin\`。停止 dev 后执行 \`pnpm typecheck\`（库源码）、\`pnpm check:app\`（示例与生成入口）、\`pnpm diagnose --for dev\`、\`pnpm build:app\` 和 \`pnpm preview\`。

## 源码与生命周期

\`src/index.ts\` 是原生 Cordis Node 插件，通过子插件贡献路由、Provider 和开发 API。\`src/api.ts\` 只注入 devApi，卸载自动撤回请求贡献；\`src/client.tsx\` 和 \`src/page.tsx\` 是独立浏览器入口，不导入 Node SDK。development 由应用配置的 command 显式传入，runtime options 全部是公开数据。

\`cormi.config.ts\` 是作者的联调应用。它静态导入 Node 源码，使修改触发既有 worker 重启；只在这个应用中用 Vite 别名将公开 /page 和 /client 入口指向 TSX 源码，普通组件修改由 Fast Refresh 处理。别名不进入插件包，不要求消费者安装作者工具。类型声明仍需先 pnpm build，导出接口变化后重新构建声明。

## 打包与独立消费

先停止同项目 dev/preview，再运行 \`pnpm pack:plugin\`。它对 src 创建独立快照，在全新 dist 中执行严格 TypeScript 编译，再用当前 pnpm pack 生成 \`artifacts/plugin-*/\` 下的 tgz。它不复制工作区旧 dist，不将 .cormi-local、示例、开发依赖路径、pnpm overrides 或安装脚本带入库包。生成包保留 private:true；PACKAGE.md 作为消费者 README，并保留作者提供的 LICENSE/NOTICE 文件原字节，未替作者选择开源许可或执行 publish。

目标应用应有自己的 cormi 安装及明确的 peers。将 tgz 复制到目标内，再显式安装。例如将 \`feature\` 从 \`${name}\` 导入，在 \`defineConfig(({ command }) => ...)\` 的 plugins 中登记 \`{ id: 'my-feature', plugin: feature, options: { development: command === 'dev', label: 'My plugin', apiBase: '/api' } }\`。仅在 dev 配置 \`DevApiService\` 加桥接或现有 \`devApiVitePlugin\`（prefix 应等于 apiBase）。生产不注册 API 子插件；/plugin 页面仍可使用 Provider。

同一作用域本模板只安装一个实例；多个实例需要作者显式设计唯一贡献 ID 与路由，不能仅改外层实例 ID。\`diagnose\` 是新 worker 的一次性观察，不是在线监控。生产 preview 不模拟后端。

## 当前交付边界

移动整个作者项目时保留 .cormi-local；初次安装第三方依赖可能需要网络。消费者仍需自己的 Cordis RC.11 声明补丁配置，补丁不会通过插件 peer 自动传播。打包器只接受有界普通 src 代码和支持的资源文件，拒绝链接、点文件及未知资源扩展；CSS、SVG/PNG/JPEG/GIF/WebP/AVIF/ICO 与 WOFF/WOFF2/TTF/OTF 按 src 相对目录复制到 dist；普通 TypeScript 声明文件同步保留。样式使用 CSS Modules、图片使用显式相对 import、CSS 内使用相对 url()，不把文件复制到消费者 public 或写死部署根。不要将包内 new URL(..., import.meta.url) 视为经过依赖预构建后仍保持原目录的保证；模板选择静态资源导入。资源变换由消费应用的 Vite 承担。更改包名时同步检查公开 module specifier 和联调别名。Windows、长期资源测试与任意第三方插件兼容不在此模板保证内。
`,
  };
}

// Run only by an explicit pnpm pack:plugin, never by install/prepare hooks.
const packScript = String.raw`import { collectPluginSource, copyPluginResources } from './resources.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const pm = process.env.npm_execpath;
assert.ok(pm && /\.(?:c?js|mjs)$/.test(pm), 'Run this command through the installed pnpm: pnpm pack:plugin');
try { await lstat(join(root, '.cormi.lock')); throw new Error('Stop the active cormi session before packaging'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const source = await collectPluginSource(root);
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(manifest.private, true, 'Local packaging must retain private:true');
assert.ok(manifest.exports && Object.keys(manifest.exports).length, 'Explicit exports required');
for (const value of Object.values({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies })) {
  assert.equal(typeof value, 'string'); assert.ok(!/^(?:file:|link:|workspace:)/.test(value), 'Consumer dependencies cannot reference the author workspace');
}
// Minimal distribution metadata: no author scripts, overrides, dev dependencies or local installation paths.
const packed = Object.fromEntries(['name','version','private','type','exports','engines','peerDependencies','peerDependenciesMeta','dependencies','optionalDependencies','license','sideEffects'].filter(key => key in manifest).map(key => [key, manifest[key]]));
packed.files = ['dist', 'src', 'README.md'];
const documents = new Map();
for (const name of ['PACKAGE.md', 'LICENSE', 'LICENSE.md', 'NOTICE', 'NOTICE.md']) {
  const full = join(root, name); let info;
  try { info = await lstat(full); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 1024 * 1024, 'Package documentation must be independent regular files');
  documents.set(name === 'PACKAGE.md' ? 'README.md' : name, await readFile(full));
}
assert.ok(documents.has('README.md'), 'PACKAGE.md consumer documentation is required');
packed.files = ['dist', 'src', ...documents.keys()];
const stage = await mkdtemp(join(root, '.cormi-package-'));
let complete = false;
try {
  for (const [path, bytes] of source) { await mkdir(dirname(join(stage, path)), { recursive: true }); await writeFile(join(stage, path), bytes, { flag: 'wx' }); }
  await writeFile(join(stage, 'package.json'), JSON.stringify(packed, null, 2));
  await writeFile(join(stage, 'tsconfig.build.json'), await readFile(join(root, 'tsconfig.build.json')));
  for (const [name, bytes] of documents) await writeFile(join(stage, name), bytes, { flag: 'wx' });
  function run(file, args, cwd) {
    const result = spawnSync(file, args, { cwd, stdio: 'inherit', shell: false, timeout: 90000, killSignal: 'SIGKILL' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Package command failed');
  }
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(stage, 'tsconfig.build.json'), '--rootDir', join(stage, 'src'), '--outDir', join(stage, 'dist'), '--noEmitOnError', 'true', '--noCheck', 'false', '--skipLibCheck', 'false', '--declaration', 'true', '--sourceMap', 'true', '--declarationMap', 'true'], root);
  await copyPluginResources(source, join(stage, 'dist'));
  for (const target of Object.values(packed.exports)) {
    assert.ok(target && typeof target === 'object');
    for (const file of [target.types, target.import]) {
      assert.ok(typeof file === 'string' && /^\.\/dist\/[a-zA-Z0-9._/-]+$/.test(file) && !file.split('/').includes('..'), 'Invalid export target');
      assert.ok((await lstat(join(stage, file))).isFile(), 'Missing compiled export');
    }
  }
  const artifacts = join(root, 'artifacts'); await mkdir(artifacts, { recursive: true });
  assert.equal(await realpath(artifacts), artifacts, 'Artifact directory cannot be a link');
  const destination = await mkdtemp(join(artifacts, 'plugin-'));
  run(process.execPath, [pm, 'pack', '--pack-destination', destination], stage);
  const archives = (await readdir(destination)).filter(name => name.endsWith('.tgz')); assert.equal(archives.length, 1);
  const file = join(destination, archives[0]), bytes = await readFile(file);
  console.log(JSON.stringify({ file, sha256: createHash('sha256').update(bytes).digest('hex'), sourceFiles: source.size, published: false }));
  complete = true;
} finally {
  if (complete) await rm(stage, { recursive: true });
  else console.error('Incomplete packaging snapshot retained at ' + stage);
}
`;
