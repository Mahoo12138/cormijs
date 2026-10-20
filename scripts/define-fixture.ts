import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const defineConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { aliasPlugin, definePlugin } from '@cormijs/plugin-react-vite';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'alias', plugin: aliasPlugin, options: { builtins: true } },
    { id: 'define', plugin: definePlugin, options: { values: { APP_NAME: 'cormi define', APP_FLAGS: { beta: true, retries: 2 }, 'process.env.APP_MODE': 'fixture-mode' } } },
  ],
  app: { base: '/define/', server: { port: 0 } },
});
`;

export const expectedDefines = 'cormi define|{"beta":true,"retries":2}|fixture-mode';

export async function writeDefineFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi define</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': defineConfiguration,
    'src/defines.d.ts': `declare const APP_NAME: string;\ndeclare const APP_FLAGS: { beta: boolean; retries: number };\n`,
    'src/labels.ts': `export const builtinLabel = 'resolved through @/labels';`,
    'src/pages/index.tsx': `import { useLocation } from '@cormijs/runtime';
import { builtinLabel } from '@/labels';
export default function Home(){
  const location = useLocation();
  const rendered = [APP_NAME, JSON.stringify(APP_FLAGS), process.env.APP_MODE ?? 'missing'].join('|');
  return <main><h1>Define home</h1><p data-define>{rendered}</p><p data-builtin>{builtinLabel}</p><p data-runtime>{location.pathname}</p></main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'],
      paths: { '@/*': ['./src/*'] }, baseUrl: '.' },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyDefinePage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Define home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-define]').innerText(), expectedDefines);
  assert.equal(await page.locator('[data-builtin]').innerText(), 'resolved through @/labels');
  // Proves the builtin `@` alias does not capture the scoped `@cormijs/runtime` import.
  assert.equal(await page.locator('[data-runtime]').innerText(), '/');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
