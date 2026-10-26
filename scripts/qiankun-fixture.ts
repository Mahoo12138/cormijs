import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright-core';

export const qiankunConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin } from '@cormijs/plugin-react';
import { qiankunPlugin } from '@cormijs/plugin-qiankun';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'app', plugin: appRuntimePlugin }, { id: 'qiankun', plugin: qiankunPlugin, options: { name: 'CormiMicroApp', mountId: 'root' } }],
  app: { base: '/qiankun/', server: { port: 0 } },
});
`;

export async function writeQiankunFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi qiankun</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': qiankunConfiguration,
    'src/pages/index.tsx': `import { useState } from 'react';
export default function Home(){
  const [count, setCount] = useState(0);
  return <main><h1>Qiankun demo</h1><p data-qiankun-page>{count}</p><button data-increment onClick={()=>setCount(value=>value+1)}>Increment</button></main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyQiankunDevPage(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Qiankun demo', exact: true }).waitFor();
  await page.locator('[data-increment]').click();
  await page.waitForFunction(() => document.querySelector('[data-qiankun-page]')?.textContent === '1');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}

export async function verifyQiankunBuild(root: string) {
  assert.ok(existsSync(join(root, 'dist/qiankun.js')), 'UMD bundle');
  const html = await readFile(join(root, 'dist/qiankun.html'), 'utf8');
  assert.match(html, /qiankun\.js/);
}

export async function verifyQiankunUmd(page: Page, url: string) {
  await page.goto(new URL('qiankun.html', url).href);
  await page.evaluate(() => { window.history.replaceState(null, '', '/mounted/'); });
  await page.evaluate(async () => {
    const api = (window as any).CormiMicroApp;
    if (!api) throw new Error('CormiMicroApp global missing');
    await api.bootstrap();
    await api.mount({ container: document.body, base: '/mounted/' });
  });
  await page.getByRole('heading', { name: 'Qiankun demo', exact: true }).waitFor();
  await page.locator('[data-increment]').click();
  await page.waitForFunction(() => document.querySelector('[data-qiankun-page]')?.textContent === '1');
  await page.evaluate(async () => { await (window as any).CormiMicroApp.unmount(); });
  await page.waitForFunction(() => document.querySelector('[data-qiankun-page]') === null);
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
