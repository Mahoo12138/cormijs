import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const requestConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, requestPlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'request', plugin: requestPlugin, options: { id: 'application:request' } },
  ],
  app: { base: '/request/', server: { port: 0 } },
});
`;

export async function writeRequestFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi request</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': requestConfiguration,
    'src/app.tsx': `import { defineApp } from '@cormijs/runtime';
export default defineApp({ request: { baseURL: '/api', headers: { 'x-app': 'cormi' }, timeout: 2000 } });`,
    'src/pages/index.tsx': `import { useRef } from 'react';
import { useRequest } from '@cormijs/runtime';
function Auto(){
  const {data,loading,error,refresh}=useRequest<{message:string}>((client,signal)=>client.get('/hello',{signal,params:{q:'one'}}));
  return <section data-auto-section><p data-auto>{data?.message ?? ''}</p><p data-loading>{String(loading)}</p><p data-error>{error ? 'error' : ''}</p><button onClick={()=>void refresh()}>Refresh</button></section>;
}
function Manual(){
  const {data,loading,error,run,cancel}=useRequest<{message:string}>((client,signal)=>client.get('/slow',{signal}),{manual:true});
  return <section data-manual-section><p data-manual>{data?.message ?? ''}</p><p data-manual-loading>{String(loading)}</p><p data-manual-error>{error ? 'error' : ''}</p><button onClick={()=>void run()}>Run slow</button><button onClick={cancel}>Cancel slow</button></section>;
}
function Failure(){
  const {data,error,run}=useRequest<{message:string}>((client,signal)=>client.get('/error',{signal}),{manual:true});
  return <section><p data-failure-data>{data?.message ?? ''}</p><p data-failure>{error instanceof Error ? error.message : ''}</p><button onClick={()=>void run()}>Run error</button></section>;
}
function Race(){
  const target=useRef('first');
  const {data,run}=useRequest<{message:string}>((client,signal)=>client.get('/slow?id='+target.current,{signal}),{manual:true});
  return <section><p data-race>{data?.message ?? ''}</p><button onClick={()=>{target.current='first';void run();}}>Run first</button><button onClick={()=>{target.current='second';void run();}}>Run second</button></section>;
}
export default function Home(){return <main><h1>Request home</h1><Auto /><Manual /><Failure /><Race /></main>;}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyRequestPage(page: Page, url: string) {
  let helloCount = 0, seenHeader = '', slowCount = 0;
  await page.route('**/api/**', async route => {
    const request = route.request(), target = new URL(request.url());
    seenHeader = request.headers()['x-app'] ?? '';
    if (target.pathname === '/api/hello') {
      helloCount++;
      await new Promise(resolve => setTimeout(resolve, 30));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'hello:' + (target.searchParams.get('q') ?? '') }) });
    } else if (target.pathname === '/api/slow') {
      slowCount++;
      await new Promise(resolve => setTimeout(resolve, 300));
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: target.searchParams.get('id') ?? 'slow' }) }); }
      catch { /* the useRequest generation may have aborted this request */ }
    } else if (target.pathname === '/api/error') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'failed' }) });
    } else {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });
  await page.goto(url); await page.getByRole('heading', { name: 'Request home', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-auto]')?.textContent === 'hello:one');
  assert.equal(seenHeader, 'cormi');
  assert.equal(await page.locator('[data-loading]').innerText(), 'false');
  assert.equal(helloCount, 1);
  const refreshed = page.waitForResponse(response => response.url().includes('/api/hello'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await refreshed;
  await page.waitForFunction(() => document.querySelector('[data-loading]')?.textContent === 'false');
  assert.equal(helloCount, 2);

  await page.getByRole('button', { name: 'Run slow', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-manual-loading]')?.textContent === 'true');
  await page.getByRole('button', { name: 'Cancel slow', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-manual-loading]')?.textContent === 'false');
  assert.equal(await page.locator('[data-manual]').innerText(), '');
  assert.equal(await page.locator('[data-manual-error]').innerText(), '');

  await page.getByRole('button', { name: 'Run error', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-failure]')?.textContent?.includes('500'));
  assert.equal(await page.locator('[data-failure-data]').innerText(), '');

  await page.getByRole('button', { name: 'Run first', exact: true }).click();
  await page.waitForTimeout(40);
  await page.getByRole('button', { name: 'Run second', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-race]')?.textContent === 'second');
  assert.ok(slowCount >= 2);
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
  await page.unroute('**/api/**');
}
