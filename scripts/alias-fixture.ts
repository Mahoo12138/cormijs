import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const aliasConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { aliasPlugin } from '@cormijs/plugin-react-vite';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'alias', plugin: aliasPlugin, options: { aliases: { '@': 'src', '@shared': 'src/shared' } } }],
  app: { base: '/alias/', server: { port: 0 } },
});
`;

export async function writeAliasFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'src/shared'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi alias</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': aliasConfiguration,
    'src/shared/message.ts': `export const sharedMessage = 'from @shared/message';`,
    'src/pages/index.tsx': `import { sharedMessage } from '@shared/message';
export default function Home(){return <main><h1>Alias home</h1><p data-alias>{sharedMessage}</p></main>;}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'],
      paths: { '@shared/*': ['./src/shared/*'] }, baseUrl: '.' },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyAliasPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Alias home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-alias]').innerText(), 'from @shared/message');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
