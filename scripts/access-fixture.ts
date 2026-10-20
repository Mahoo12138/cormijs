import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const accessConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { accessPlugin, appRuntimePlugin, initialStatePlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
    { id: 'access', plugin: accessPlugin, options: { id: 'application:access' } },
  ],
  app: { base: '/access/', server: { port: 0 } },
});
`;

export async function writeAccessFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi access</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': accessConfiguration,
    'src/app.tsx': `import { defineApp } from '@cormijs/runtime';
export default defineApp({
  async getInitialState() {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { role: 'admin' };
  },
  access(state) {
    const user = state as { role?: string } | undefined;
    return { canAdmin: user?.role === 'admin', canRead: user !== undefined };
  },
});`,
    'src/pages/index.tsx': `import { Access, useAccess, useInitialState } from '@cormijs/runtime';
export default function Home(){
  const access=useAccess(), initial=useInitialState<{role:string}>();
  return <main>
    <h1>Access home</h1>
    <p data-role>{initial.data?.role ?? '(loading)'}</p>
    <p data-can-admin>{String(access.canAdmin)}</p>
    <Access accessible={access.canAdmin} fallback={<p data-fallback>No admin</p>}><p data-admin-only>Admin panel</p></Access>
    <button onClick={()=>initial.setInitialState({role:'user'})}>Demote</button>
    <button onClick={()=>initial.setInitialState({role:'admin'})}>Promote</button>
  </main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyAccessPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Access home', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-role]')?.textContent === 'admin');
  assert.equal(await page.locator('[data-can-admin]').innerText(), 'true');
  assert.equal(await page.locator('[data-admin-only]').innerText(), 'Admin panel');
  assert.equal(await page.locator('[data-fallback]').count(), 0);
  await page.getByRole('button', { name: 'Demote', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-can-admin]')?.textContent === 'false');
  assert.equal(await page.locator('[data-admin-only]').count(), 0);
  assert.equal(await page.locator('[data-fallback]').innerText(), 'No admin');
  await page.getByRole('button', { name: 'Promote', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-can-admin]')?.textContent === 'true');
  assert.equal(await page.locator('[data-admin-only]').innerText(), 'Admin panel');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
