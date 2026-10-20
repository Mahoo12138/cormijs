import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const conventionsConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { layoutPlugin, loadingPlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'application-layout', plugin: layoutPlugin, options: { id: 'application:layout' } },
    { id: 'application-loading', plugin: loadingPlugin, options: { id: 'application:loading' } },
  ],
  app: { base: '/conventions/', server: { port: 0 } },
});
`;

export async function writeConventionsFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'src/layouts'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi conventions</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': conventionsConfiguration,
    'src/layouts/index.tsx': `import { Outlet, useLocation } from 'react-router';
export default function Layout(){const location=useLocation();return <div data-convention-layout data-convention-path={location.pathname}><aside>Convention layout</aside><Outlet /></div>;}`,
    'src/loading.tsx': `export default function Loading(){return <p role="status" data-convention-loading>Convention loading…</p>;}`,
    'src/pages/index.tsx': `import { Link } from 'react-router';
export default function Home(){return <main><h1>Convention home</h1><Link to="/slow">Slow page</Link></main>;}`,
    'src/pages/404.tsx': `export default function NotFound(){return <main><h1>Custom 404</h1><p>This page comes from src/pages/404.tsx.</p></main>;}`,
    'src/pages/slow.tsx': `await new Promise(resolve => setTimeout(resolve, 800));
export default function Slow(){return <main><h1>Slow ready</h1></main>;}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyConventionsPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Convention home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-convention-layout]').count(), 1);
  assert.equal(await page.locator('[data-convention-layout]').getAttribute('data-convention-path'), '/');
  await page.goto(new URL('missing', url).href); await page.getByRole('heading', { name: 'Custom 404', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/conventions/missing');
  assert.equal(await page.locator('[data-convention-layout]').count(), 1);
  await page.goto(new URL('slow', url).href, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-convention-loading]').waitFor({ timeout: 5000 });
  await page.getByRole('heading', { name: 'Slow ready', exact: true }).waitFor();
  assert.equal(await page.locator('[data-convention-layout]').count(), 1);
  await page.goto(url); await page.getByRole('heading', { name: 'Convention home', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
