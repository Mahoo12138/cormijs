import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

const configuration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { mpaPlugin } from '@cormijs/plugin-react-vite';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'mpa', plugin: mpaPlugin, options: { id: 'application:mpa', layout: 'src/GlobalMpaLayout.tsx', template: 'src/mpa-template.html' } }],
  app: { routes: [], server: { port: 0 } },
});
`;

export async function writeMpaFixture(root: string) {
  await mkdir(join(root, 'src/pages/home'), { recursive: true });
  await mkdir(join(root, 'src/pages/admin'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><meta charset="utf-8" /><title>SPA shell</title></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': configuration,
    'src/pages/index.tsx': 'export default () => <main>SPA home</main>;',
    'src/pages/home/index.tsx': 'export default function Home(){return <main><h1>MPA home</h1></main>;}',
    'src/pages/home/config.json': JSON.stringify({ title: 'Home page', mountElementId: 'app', layout: 'src/HomeLayout.tsx' }),
    'src/mpa-template.html': '<!doctype html><html><head><meta charset="utf-8"><title>{{title}}</title><meta name="mpa-template" content="custom"><link rel="icon" href="data:,"></head><body><div id="{{mountElementId}}"></div><script type="module" src="/{{entry}}"></script></body></html>',
    'src/GlobalMpaLayout.tsx': `import type { ReactNode } from 'react';
export default function GlobalMpaLayout({ children }: { children: ReactNode }){return <section data-global-layout><header>Global MPA layout</header>{children}</section>;}`,
    'src/HomeLayout.tsx': `import type { ReactNode } from 'react';
export default function HomeLayout({ children }: { children: ReactNode }){return <section data-home-layout><header>Home layout</header>{children}</section>;}`,
    'src/pages/admin/index.tsx': 'export default function Admin(){return <main><h1>MPA admin</h1></main>;}',
    'src/pages/admin/config.json': JSON.stringify({ title: 'Admin page' }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyMpaPages(page: Page, url: string, errors: string[]) {
  await page.goto(new URL('home.html', url).href);
  await page.getByRole('heading', { name: 'MPA home', exact: true }).waitFor();
  assert.equal(await page.title(), 'Home page');
  assert.equal(await page.locator('[data-home-layout]').count(), 1);
  assert.equal(await page.locator('[data-global-layout]').count(), 0);
  await page.goto(new URL('admin.html', url).href);
  await page.getByRole('heading', { name: 'MPA admin', exact: true }).waitFor();
  assert.equal(await page.title(), 'Admin page');
  assert.equal(await page.locator('[data-global-layout]').count(), 1);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}

export async function verifyMpaOutput(root: string) {
  const home = await readFile(join(root, 'dist/home.html'), 'utf8');
  assert.match(home, /<title>Home page<\/title>/);
  assert.match(home, /<meta name="mpa-template" content="custom">/);
  assert.match(home, /<script type="module" crossorigin src="\/assets\/[^"]+\.js"><\/script>/);
  const admin = await readFile(join(root, 'dist/admin.html'), 'utf8');
  assert.match(admin, /<title>Admin page<\/title>/);
  assert.match(admin, /<meta name="mpa-template" content="custom">/);
  await assert.rejects(readFile(join(root, 'dist/.cormi/mpa/home.html')), /ENOENT/);
}
