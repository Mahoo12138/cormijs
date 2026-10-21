import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const prefetchConfiguration = (mode: 'manual' | 'idle') => `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { routeConfigPlugin, routePrefetchPlugin } from '@cormijs/plugin-react';
const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', routes: [
    { index: true, component: './src/Home.tsx' },
    { path: 'guide', component: './src/Guide.tsx' },
  ],
}];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
    { id: 'prefetch', plugin: routePrefetchPlugin, options: { id: 'application:prefetch', mode: '${mode}' } },
  ],
  app: { base: '/prefetch/', routes: [], server: { port: 0 } },
});
`;

export async function writePrefetchFixture(root: string, mode: 'manual' | 'idle' = 'manual') {
  await mkdir(join(root, 'src'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi prefetch</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': prefetchConfiguration(mode),
    'src/Shell.tsx': `import { Link, Outlet } from '@cormijs/runtime';
export default function Shell(){return <section><header><h1>Prefetch demo</h1><nav><Link to="/">Home</Link><Link to="/guide">Guide</Link></nav></header><Outlet/></section>;}`,
    'src/Home.tsx': `import { useState } from 'react';
import { usePrefetch, usePrefetchOnIntent } from '@cormijs/runtime';
export default function Home(){
  const { ids, prefetch, prefetchAll } = usePrefetch();
  const intent = usePrefetchOnIntent('config:guide', { delayMs: 20 });
  const [result, setResult] = useState('idle');
  return <main><h2>Prefetch home</h2><p data-ids>{ids.join(',')}</p>
    <button data-prefetch onClick={()=>{ void prefetch('config:guide').then(ok => setResult(String(ok))); }}>Prefetch guide</button>
    <button data-prefetch-all onClick={()=>{ void prefetchAll().then(all => setResult(all.join(','))); }}>Prefetch all</button>
    <button data-intent {...intent}>Intent guide</button>
    <p data-result>{result}</p></main>;
}`,
    'src/Guide.tsx': 'export default function Guide(){return <main><h2>Prefetch guide</h2></main>;}',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

const requests = (page: Page) => page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));

export async function verifyPrefetchPage(page: Page, url: string, built: boolean) {
  await page.goto(url); await page.getByRole('heading', { name: 'Prefetch home', exact: true }).waitFor();
  assert.deepEqual((await page.locator('[data-ids]').innerText()).split(','), ['config:guide', 'config:root:index', 'shell']);
  const before = await requests(page);
  await page.locator('[data-prefetch]').click();
  await page.getByText('true', { exact: true }).waitFor();
  const after = await requests(page);
  const added = after.filter(name => !before.includes(name));
  if (built) assert.ok(added.some(name => /assets\/.+\.js$/.test(name)), `prefetch fetched a route chunk: ${added.join(', ')}`);
  else assert.ok(added.some(name => /Guide/.test(name)), `dev fetched the guide module: ${added.join(', ')}`);
  await page.getByRole('link', { name: 'Guide', exact: true }).click();
  await page.getByRole('heading', { name: 'Prefetch guide', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}

export async function verifyIntentPrefetch(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Prefetch home', exact: true }).waitFor();
  const before = await requests(page);
  await page.locator('[data-intent]').hover();
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => /Guide/.test(entry.name)), undefined, { timeout: 8000 });
  const after = await requests(page);
  assert.ok(after.length > before.length, 'hovering the intent target fetched the guide module');
  await page.getByRole('link', { name: 'Guide', exact: true }).click();
  await page.getByRole('heading', { name: 'Prefetch guide', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}

export async function verifyIdlePrefetch(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Prefetch home', exact: true }).waitFor();
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => /Guide/.test(entry.name)), undefined, { timeout: 8000 });
  await page.getByRole('link', { name: 'Guide', exact: true }).click();
  await page.getByRole('heading', { name: 'Prefetch guide', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
