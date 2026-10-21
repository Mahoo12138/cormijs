import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const outputConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { outputPlugin } from '@cormijs/plugin-react-vite';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'output', plugin: outputPlugin, options: {
    hash: false,
    copy: [{ from: 'static', to: 'extras' }, { from: 'static/marker.txt' }],
  } }],
  app: { base: '/output/', server: { port: 0 } },
});
`;

export async function writeOutputFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'static/nested'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi output</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': outputConfiguration,
    'src/pages/index.tsx': 'export default function Home(){return <main><h1>Output home</h1></main>;}',
    'static/marker.txt': 'copied marker',
    'static/nested/data.json': JSON.stringify({ nested: true }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

/** Files are published after bundling: preview serves them and stable names drop content hashes. */
export async function verifyOutputBuild(root: string) {
  const { readdir, readFile } = await import('node:fs/promises');
  const assets = (await readdir(join(root, 'dist/assets'))).sort();
  assert.ok(assets.includes('index.js'), `entry file keeps the stable name: ${assets.join(', ')}`);
  assert.equal(assets.some(name => /^index-[A-Za-z0-9_-]+\.js$/.test(name)), false, 'hash:false emits no hashed entry');
  assert.equal(await readFile(join(root, 'dist/marker.txt'), 'utf8'), 'copied marker');
  assert.equal(await readFile(join(root, 'dist/extras/marker.txt'), 'utf8'), 'copied marker');
  assert.deepEqual(JSON.parse(await readFile(join(root, 'dist/extras/nested/data.json'), 'utf8')), { nested: true });
}

export async function verifyOutputPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Output home', exact: true }).waitFor();
  const marker = await page.request.get(new URL('marker.txt', url).href);
  assert.equal(marker.status(), 200);
  assert.equal(await marker.text(), 'copied marker');
  const nested = await page.request.get(new URL('extras/nested/data.json', url).href);
  assert.equal(nested.status(), 200);
  assert.deepEqual(await nested.json(), { nested: true });
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
