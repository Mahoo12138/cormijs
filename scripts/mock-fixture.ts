import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const mockConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { mockPlugin } from '@cormijs/plugin-dev-api';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'dev-api', plugin: devApiVitePlugin },
    { id: 'mock', plugin: mockPlugin, options: { intervalMs: 50 } },
  ],
  app: { base: '/mock/', server: { port: 0 } },
});
`;

export async function writeMockFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'mock'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi mock</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': mockConfiguration,
    'mock/users.ts': `export default {
  'GET /api/users': { body: { users: ['Ada'] } },
  'POST /api/echo': request => ({ status: 201, body: request.body }),
  'GET /plain': { body: { plain: true } },
};`,
    'src/pages/index.tsx': `import { useState } from 'react';
export default function Home(){
  const [users,setUsers]=useState<string[]>([]);
  const load=async()=>{const response=await fetch('/api/users');setUsers((await response.json()).users ?? []);};
  return <main><h1>Mock home</h1><p data-dev>{String(import.meta.env.DEV)}</p><p data-users>{users.join(',')}</p><button onClick={()=>void load()}>Load users</button></main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyMockPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Mock home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-dev]').innerText(), 'true');
  await page.getByRole('button', { name: 'Load users', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-users]')?.textContent === 'Ada');
  const plain = await page.evaluate(async () => (await fetch('/api/plain')).json());
  assert.deepEqual(plain, { plain: true });
  const echoed = await page.evaluate(async () => (await fetch('/api/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 1 }) })).json());
  assert.deepEqual(echoed, { value: 1 });
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
