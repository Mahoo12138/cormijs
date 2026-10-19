import { pluginTemplateFiles } from './plugin-template.js';
import { applicationConfig, applicationPage, applicationAssets, applicationReadme } from './application-template.js';
export type Template = 'react' | 'react-api' | 'plugin-react';
/** Templates are data, not executed modules or remote scripts. */
export function templateFiles(template: Template, name = 'cormi-plugin-example'): Record<string, string> {
  if (template === 'plugin-react') return pluginTemplateFiles(name);
  const api = template === 'react-api';
  return {
    'index.html': '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="icon" href="data:,"><title>cormi app</title></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>\n',
    'cormi.config.ts': applicationConfig(api),
    'src/pages/index.tsx': applicationPage(api),    'src/style.css': ':root{font-family:system-ui,sans-serif;color:#202c3a;background:#f5f7fa}*{box-sizing:border-box}body{margin:0}main{max-width:880px;margin:12vh auto;padding:32px}h1{font-size:clamp(30px,5vw,48px)}p{line-height:1.8}.eyebrow{font-size:12px;letter-spacing:.12em;color:#61748d}button{border:1px solid #bbccdd;background:#e8f0f9;padding:12px 18px;border-radius:6px;font:inherit;cursor:pointer}button:disabled{cursor:wait;opacity:.65}section{margin-top:36px;padding:24px;background:white;border:1px solid #dce3eb;border-radius:8px}output{display:block;margin-top:18px;overflow-wrap:anywhere}@media(max-width:500px){main{margin:5vh auto;padding:20px}}\n',
    'src/assets.d.ts': applicationAssets,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target:'ES2023', module:'ESNext', moduleResolution:'Bundler', jsx:'react-jsx', lib:['ES2023','DOM','DOM.Iterable'], strict:true, skipLibCheck:false, noEmit:true, allowImportingTsExtensions:true }, include:['src/**/*.ts','src/**/*.tsx','.cormi','cormi.config.ts', ...(api ? ['mock.ts'] : [])] }, null, 2) + '\n',    '.gitignore': 'node_modules/\n.cormi/\n.cormi.lock/\ndist/\n.cormi-vite-*/\n.cormi-publish-*/\n.cormi-publish.lock/\n.env\n.env.*\n*.tsbuildinfo\n',
    '.npmrc': 'auto-install-peers=false\nstrict-peer-dependencies=true\nhoist=false\nignore-scripts=true\nmanage-package-manager-versions=false\n',
    'pnpm-workspace.yaml': 'packages: []\n',
    'README.md': applicationReadme,    ...(api ? { 'mock.ts': "import type { MockRule } from '@cormijs/plugin-dev-api';\n\nexport const mocks: readonly MockRule[] = [\n  { method: 'GET', path: '/hello', handle: ({ query }) => ({ body: { message: 'Hello, ' + (query.get('name') ?? 'cormi') + '!' } }) },\n];\n" } : {}),
  };
}
