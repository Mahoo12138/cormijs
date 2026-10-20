import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const initialStateConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, initialStatePlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
  ],
  app: { base: '/initial-state/', server: { port: 0 } },
});
`;

export async function writeInitialStateFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi initial state</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': initialStateConfiguration,
    'src/app.tsx': `import { defineApp } from '@cormijs/runtime';
let calls = 0;
export default defineApp({
  async getInitialState() {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 400));
    return { user: calls === 1 ? 'Ada' : 'Grace', call: calls };
  },
});`,
    'src/pages/index.tsx': `import { useInitialState } from '@cormijs/runtime';
export default function Home(){
  const {loading,error,data,refresh,setInitialState}=useInitialState<{user:string;call:number}>();
  return <main>
    <h1>Initial state</h1>
    <p data-loading>{String(loading)}</p>
    <p data-error>{error ? String(error) : ''}</p>
    <p data-user>{data?.user ?? ''}</p>
    <p data-call>{data?.call ?? 0}</p>
    <button onClick={()=>setInitialState({user:'Bob',call:9})}>Set Bob</button>
    <button onClick={()=>void refresh()}>Refresh</button>
  </main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyInitialStatePage(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Initial state', exact: true }).waitFor();
  assert.equal(await page.locator('[data-loading]').innerText(), 'true');
  await page.waitForFunction(() => document.querySelector('[data-user]')?.textContent === 'Ada');
  assert.equal(await page.locator('[data-loading]').innerText(), 'false');
  assert.equal(await page.locator('[data-call]').innerText(), '1');
  assert.equal(await page.locator('[data-error]').innerText(), '');
  await page.getByRole('button', { name: 'Set Bob', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-user]')?.textContent === 'Bob');
  assert.equal(await page.locator('[data-call]').innerText(), '9');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-user]')?.textContent === 'Grace');
  assert.equal(await page.locator('[data-call]').innerText(), '2');
  await page.reload(); await page.getByRole('heading', { name: 'Initial state', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-user]')?.textContent === 'Ada');
  assert.equal(await page.locator('[data-call]').innerText(), '1');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
