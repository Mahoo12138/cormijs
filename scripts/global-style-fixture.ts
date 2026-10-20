import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const globalStyleConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { globalStylePlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'styles', plugin: globalStylePlugin, options: { id: 'app:styles' } }],
  app: { base: '/global-style/', server: { port: 0 } },
});
`;

export async function writeGlobalStyleFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi global style</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': globalStyleConfiguration,
    'src/global.css': ':root { --cormi-band: rgb(37, 99, 128); }\n[data-global-band] { background-color: var(--cormi-band); padding: 4px 8px; border-radius: 6px; color: rgb(255, 255, 255); }\n',
    'src/pages/index.tsx': `export default function Home(){return <main><h1>Global style home</h1><p data-global-band>styled by src/global.css</p></main>;}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyGlobalStylePage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Global style home', exact: true }).waitFor();
  const band = page.locator('[data-global-band]');
  assert.equal(await band.innerText(), 'styled by src/global.css');
  assert.equal(await band.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(37, 99, 128)');
  assert.equal(await band.evaluate(element => getComputedStyle(element).borderRadius), '6px');
  assert.ok(Number(await page.evaluate('document.querySelectorAll(\'link[rel="stylesheet"], style\').length')) >= 1, 'global CSS must reach the document');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
