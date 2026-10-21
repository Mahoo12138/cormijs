import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const staticExportConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { headPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
import { apiRoutePlugin, staticExportPlugin } from '@cormijs/plugin-react-vite';
const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', meta: { head: { title: 'Site', metas: [{ name: 'description', content: 'shell description' }] } }, routes: [
    { index: true, component: './src/Home.tsx' },
    { path: 'guide', component: './src/Guide.tsx', meta: { head: { title: 'Guide', links: [{ rel: 'canonical', href: '/static/guide' }], jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: 'Guide' } } } },
    { path: 'detail/:id', component: './src/Detail.tsx' },
  ],
}];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
    { id: 'export', plugin: staticExportPlugin, options: { id: 'application:export', titleTemplate: ' · demo' } },
    { id: 'head', plugin: headPlugin, options: { id: 'application:head', titleTemplate: ' · demo' } },
    { id: 'api', plugin: apiRoutePlugin, options: { id: 'application:api' } },
  ],
  app: { base: '/static/', routes: [], server: { port: 0 } },
});
`;

export async function writeStaticExportFixture(root: string) {
  await mkdir(join(root, 'src/api'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><meta charset="utf-8" /><title>Base title</title><meta name="author" content="static author" /><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': staticExportConfiguration,
    'src/Shell.tsx': `import { Link, Outlet } from '@cormijs/runtime';
export default function Shell(){return <section><header><h1>Static export demo</h1><nav><Link to="/">Home</Link><Link to="/guide">Guide</Link></nav></header><Outlet/></section>;}`,
    'src/Home.tsx': 'export default function Home(){return <main><h2>Export home</h2></main>;}',
    'src/Guide.tsx': 'export default function Guide(){return <main><h2>Export guide</h2></main>;}',
    'src/Detail.tsx': 'export default function Detail(){return <main><h2>Export detail</h2></main>;}',
    'src/api/ping.ts': `export default () => Response.json({ pong: true });`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyStaticExport(root: string) {
  const { readFile } = await import('node:fs/promises');
  const index = await readFile(join(root, 'dist/index.html'), 'utf8');
  assert.match(index, /<title>Site · demo<\/title>/);
  assert.match(index, /<meta name="description" content="shell description" \/>/);
  assert.match(index, /<meta name="author" content="static author" \/>/);
  const guide = await readFile(join(root, 'dist/guide/index.html'), 'utf8');
  assert.match(guide, /<title>Guide · demo<\/title>/);
  assert.match(guide, /<link rel="canonical" href="\/static\/guide" \/>/);
  assert.match(guide, /<meta name="description" content="shell description" \/>/);
  const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(guide)?.[1];
  assert.deepEqual(JSON.parse(jsonLd ?? ''), { '@context': 'https://schema.org', '@type': 'Article', headline: 'Guide' });
  assert.doesNotMatch(await readFile(join(root, 'dist/index.html'), 'utf8'), /application\/ld\+json/);
  await assert.rejects(readFile(join(root, 'dist/detail/index.html')), /ENOENT/, 'dynamic routes are not exported');
}

export async function verifyStaticExportPages(page: Page, url: string) {
  const api = await page.request.get(new URL('/api/ping', url).href);
  assert.equal(api.status(), 200); assert.deepEqual(await api.json(), { pong: true });
  const response = await page.request.get(new URL('guide/', url).href);
  assert.equal(response.status(), 200);
  const html = await response.text();
  assert.match(html, /<title>Guide · demo<\/title>/);
  await page.goto(new URL('guide/', url).href);
  await page.getByRole('heading', { name: 'Export guide', exact: true }).waitFor();
  assert.equal(await page.title(), 'Guide · demo');
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('heading', { name: 'Export home', exact: true }).waitFor();
  assert.equal(await page.title(), 'Site · demo', 'the runtime keeps the same head after navigation');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
