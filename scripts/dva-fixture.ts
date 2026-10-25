import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const dvaConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'app', plugin: appRuntimePlugin }],
  app: { base: '/dva/', runtime: [{ id: 'dva', module: { specifier: './src/dva.tsx', exportName: 'default' } }], server: { port: 0 } },
});
`;

export async function writeDvaFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'src/models'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi dva</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': dvaConfiguration,
    'src/models/counter.ts': `export default { namespace: 'counter', state: { count: 0 }, reducers: {
  increment(state: { count: number }) { return { ...state, count: state.count + 1 }; },
  reset(state: { count: number }) { return { ...state, count: 0 }; },
} };`,
    'src/dva.tsx': `import { createDvaRuntime } from '@cormijs/dva';
import counter from './models/counter';
export default createDvaRuntime([counter]);`,
    'src/pages/index.tsx': `import { useDispatch, useSelector } from '@cormijs/dva';
export default function Home(){
  const count = useSelector((state: any) => state.counter.count);
  const dispatch = useDispatch();
  return <main><h1>Dva demo</h1><p data-count>{count}</p>
    <button data-increment onClick={()=>{dispatch({ type: 'counter/increment' });}}>Increment</button>
    <button data-reset onClick={()=>{dispatch({ type: 'counter/reset' });}}>Reset</button></main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyDvaPage(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Dva demo', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-count]')?.textContent === '0');
  await page.locator('[data-increment]').click();
  await page.waitForFunction(() => document.querySelector('[data-count]')?.textContent === '1');
  await page.locator('[data-increment]').click();
  await page.waitForFunction(() => document.querySelector('[data-count]')?.textContent === '2');
  await page.locator('[data-reset]').click();
  await page.waitForFunction(() => document.querySelector('[data-count]')?.textContent === '0');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
