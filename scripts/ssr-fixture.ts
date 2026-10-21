import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const ssrConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { headPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
import { servePlugin, ssrPlugin } from '@cormijs/plugin-react-vite';
const routes = [
  { id: 'home', path: '/', component: './src/pages/index.tsx', meta: { head: { title: 'SSR home page', metas: [{ name: 'description', content: 'server description' }] } } },
  { id: 'guide', path: 'guide', component: './src/pages/guide.tsx', clientLoader: 'clientLoader', meta: { head: { title: 'SSR guide page', jsonLd: { '@type': 'Article', headline: 'Guide' } } } },
];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
    { id: 'head', plugin: headPlugin, options: { id: 'application:head', titleTemplate: ' · demo' } },
    { id: 'ssr', plugin: ssrPlugin, options: { id: 'application:ssr' } },
    { id: 'serve', plugin: servePlugin, options: { id: 'application:serve', port: 0, base: '/ssr/' } },
  ],
  app: { ssr: true, base: '/ssr/', routes: [], server: { port: 0 } },
});
`;

export async function writeSsrFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><meta charset="utf-8" /><title>SSR demo</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': ssrConfiguration,
    'src/pages/index.tsx': `import { Helmet } from '@cormijs/runtime';
export default function Home(){return <main><Helmet title="Helmet home title" metas={[{ name: 'helmet', content: 'yes' }]} /><h1>SSR home</h1></main>;}`,
    'src/pages/guide.tsx': `import { useClientLoaderData } from '@cormijs/runtime';
interface Data { message: string }
export default function Guide(){
  const data = useClientLoaderData<Data>();
  return <main><h1>SSR guide</h1><p data-guide>{data.message}</p></main>;
}
export async function clientLoader(): Promise<Data> { return { message: 'loaded on server' }; }`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifySsrPage(page: Page, url: string) {
  const home = await page.request.get(url, { headers: { accept: 'text/html' } });
  assert.equal(home.status(), 200);
  const html = await home.text();
  assert.match(html, /<div id="root"><main><h1>SSR home<\/h1><\/main>/);
  assert.match(html, /<title>Helmet home title · demo<\/title>/);
  assert.match(html, /<meta name="description" content="server description" data-cormi-head="" \/>/);
  assert.match(html, /<meta name="helmet" content="yes" data-cormi-head="" \/>/);
  assert.match(html, /__staticRouterHydrationData/);
  await page.goto(url);
  await page.getByRole('heading', { name: 'SSR home', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);

  const guide = await page.request.get(new URL('guide', url).href, { headers: { accept: 'text/html' } });
  assert.equal(guide.status(), 200);
  const guideHtml = await guide.text();
  assert.match(guideHtml, /<div id="root"><main><h1>SSR guide<\/h1><p data-guide="true">loaded on server<\/p><\/main>/);
  assert.match(guideHtml, /<title>SSR guide page · demo<\/title>/);
  assert.match(guideHtml, /<script type="application\/ld\+json" data-cormi-head="">\{"@type":"Article","headline":"Guide"\}<\/script>/);
  await page.goto(new URL('guide', url).href);
  await page.getByRole('heading', { name: 'SSR guide', exact: true }).waitFor();
  assert.equal(await page.locator('[data-guide]').innerText(), 'loaded on server');
  const hydration = await page.evaluate(() => (window as any).__staticRouterHydrationData);
  assert.deepEqual(hydration?.loaderData, { guide: { message: 'loaded on server' } });
}
