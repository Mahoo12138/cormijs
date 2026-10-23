import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const reactQueryConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin } from '@cormijs/plugin-react';
import { reactQueryPlugin } from '@cormijs/plugin-react-query';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app', plugin: appRuntimePlugin },
    { id: 'react-query', plugin: reactQueryPlugin, options: { id: 'application:react-query', defaults: { staleTime: 60000, retry: 0, refetchOnWindowFocus: false } } },
  ],
  app: { base: '/react-query/', server: { port: 0 } },
});
`;

export async function writeReactQueryFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi react query</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': reactQueryConfiguration,
    'src/pages/index.tsx': `import { useQuery } from '@tanstack/react-query';
async function loadGreeting(): Promise<{ message: string }> {
  const response = await fetch('/api/greeting');
  if (!response.ok) throw new Error('request failed');
  return response.json();
}
function Greeting({ slot }: { slot: string }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['greeting'], queryFn: loadGreeting });
  return <section><p data-slot={slot}>{data?.message ?? ''}</p><p data-slot-loading={slot}>{String(isLoading)}</p><p data-slot-error={slot}>{error ? 'error' : ''}</p>
    {slot === 'one' ? <button data-refetch onClick={() => void refetch()}>Refetch</button> : null}</section>;
}
export default function Home(){ return <main><h1>React Query demo</h1><Greeting slot="one" /><Greeting slot="two" /></main>; }`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyReactQueryPage(page: Page, url: string) {
  let calls = 0;
  await page.route('**/api/greeting', async route => {
    calls++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'hello:' + calls }) });
  });
  await page.goto(url);
  await page.getByRole('heading', { name: 'React Query demo', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-slot="one"]')?.textContent === 'hello:1');
  await page.waitForFunction(() => document.querySelector('[data-slot="two"]')?.textContent === 'hello:1');
  assert.equal(calls, 1, 'two observers share one cached query');
  assert.equal(await page.locator('[data-slot-loading="one"]').innerText(), 'false');
  await page.locator('[data-refetch]').click();
  await page.waitForFunction(() => document.querySelector('[data-slot="one"]')?.textContent === 'hello:2');
  await page.waitForFunction(() => document.querySelector('[data-slot="two"]')?.textContent === 'hello:2');
  assert.equal(calls, 2, 'refetch updates both observers');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
  await page.unroute('**/api/greeting');
}
