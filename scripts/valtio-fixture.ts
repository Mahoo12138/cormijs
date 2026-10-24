import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const valtioConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'app', plugin: appRuntimePlugin }],
  app: { base: '/valtio/', server: { port: 0 } },
});
`;

export async function writeValtioFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi valtio</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': valtioConfiguration,
    'src/pages/index.tsx': `import { proxy, useSnapshot } from '@cormijs/valtio';
const store = proxy({ count: 0 });
function Counter({ slot }: { slot: string }) {
  const snapshot = useSnapshot(store);
  return <p data-count={slot}>{snapshot.count}</p>;
}
export default function Home(){
  return <main><h1>Valtio demo</h1><Counter slot="a" /><Counter slot="b" />
    <button data-increment onClick={()=>{store.count++;}}>Increment</button>
    <button data-reset onClick={()=>{store.count=0;}}>Reset</button></main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyValtioPage(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Valtio demo', exact: true }).waitFor();
  const counts = async () => [await page.locator('[data-count="a"]').innerText(), await page.locator('[data-count="b"]').innerText()];
  assert.deepEqual(await counts(), ['0', '0']);
  await page.locator('[data-increment]').click();
  await page.waitForFunction(() => document.querySelector('[data-count="a"]')?.textContent === '1' && document.querySelector('[data-count="b"]')?.textContent === '1');
  await page.locator('[data-reset]').click();
  await page.waitForFunction(() => document.querySelector('[data-count="a"]')?.textContent === '0' && document.querySelector('[data-count="b"]')?.textContent === '0');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
