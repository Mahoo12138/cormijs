import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const headConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { headPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', meta: { head: { metas: [{ name: 'description', content: 'shell description' }] } }, routes: [
    { index: true, component: './src/Home.tsx', meta: { head: { title: 'Home' } } },
    { path: 'guide/:id', component: './src/Guide.tsx', meta: { head: { title: 'Guide', metas: [{ property: 'og:title', content: 'Guide og' }], links: [{ rel: 'canonical', href: '/guide' }], jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: 'Guide', name: 'A </script> test' } } } },
  ],
}];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
    { id: 'head', plugin: headPlugin, options: { id: 'application:head', titleTemplate: ' · demo' } },
  ],
  app: { base: '/route-head/', server: { port: 0 } },
});
`;

export async function writeHeadFixture(root: string) {
  await mkdir(join(root, 'src'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>Base title</title><meta name="author" content="static author" /><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': headConfiguration,
    'src/Shell.tsx': `import { Link, Outlet } from '@cormijs/runtime';
export default function Shell(){return <section><header><h1>Head demo</h1><nav><Link to="/">Home</Link><Link to="/guide/7">Guide</Link></nav></header><Outlet/></section>;}`,
    'src/Home.tsx': `import { Helmet } from '@cormijs/runtime';
export default function Home(){return <main>
  <Helmet title="Helmet home" metas={[{ name: 'description', content: 'helmet description' }]} links={[{ rel: 'alternate', href: '/home-alt' }]} jsonLd={{ '@type': 'WebPage', name: 'Helmet home' }} />
  <h2>Head home</h2></main>;}`,
    'src/Guide.tsx': 'export default function Guide(){return <main><h2>Guide page</h2></main>;}',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

const managed = (page: Page, selector: string) => page.locator(`${selector}[data-cormi-head]`).count();

export async function verifyHeadPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Head home', exact: true }).waitFor();
  assert.equal(await page.title(), 'Helmet home · demo');
  assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), 'helmet description');
  assert.equal(await managed(page, 'meta'), 1);
  assert.equal(await managed(page, 'link'), 1);
  const homeJsonLd = page.locator('script[type="application/ld+json"][data-cormi-head]');
  assert.equal(await homeJsonLd.count(), 1);
  assert.deepEqual(JSON.parse(await homeJsonLd.textContent() ?? ''), { '@type': 'WebPage', name: 'Helmet home' });
  assert.equal(await page.locator('meta[name="author"]').getAttribute('content'), 'static author');

  await page.getByRole('link', { name: 'Guide', exact: true }).click();
  await page.getByRole('heading', { name: 'Guide page', exact: true }).waitFor();
  assert.equal(await page.title(), 'Guide · demo');
  assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'), 'Guide og');
  assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute('href') ?? '', url).pathname, '/guide');
  assert.equal(await managed(page, 'meta'), 2, 'inherited description plus the guide og:title, replaced not appended');
  assert.equal(await managed(page, 'link'), 1, 'managed links are replaced, not appended');
  const jsonLd = page.locator('script[type="application/ld+json"][data-cormi-head]');
  assert.equal(await jsonLd.count(), 1);
  assert.deepEqual(JSON.parse(await jsonLd.textContent() ?? ''), { '@context': 'https://schema.org', '@type': 'Article', headline: 'Guide', name: 'A </script> test' });
  assert.equal(await page.locator('meta[name="author"]').getAttribute('content'), 'static author');

  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('heading', { name: 'Head home', exact: true }).waitFor();
  assert.equal(await page.title(), 'Helmet home · demo');
  assert.equal(await managed(page, 'meta'), 1, 'returning to a route does not duplicate tags');
  assert.equal(await managed(page, 'link'), 1);
  assert.equal(await page.locator('meta[property="og:title"]').count(), 0);
  const returned = page.locator('script[type="application/ld+json"][data-cormi-head]');
  assert.equal(await returned.count(), 1);
  assert.deepEqual(JSON.parse(await returned.textContent() ?? ''), { '@type': 'WebPage', name: 'Helmet home' });

  await page.goto(new URL('guide/9', url).href);
  await page.getByRole('heading', { name: 'Guide page', exact: true }).waitFor();
  assert.equal(await page.title(), 'Guide · demo');
  await page.reload();
  await page.getByRole('heading', { name: 'Guide page', exact: true }).waitFor();
  assert.equal(await page.title(), 'Guide · demo');
  assert.equal(await managed(page, 'meta'), 2);
  assert.equal(await page.locator('meta[name="author"]').getAttribute('content'), 'static author');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
