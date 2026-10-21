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
  { id: 'backend', path: 'backend/:id', component: './src/pages/backend.tsx', serverLoader: 'serverLoader', meta: { head: { title: 'SSR backend page' } } },
  { id: 'status', path: 'status', component: './src/pages/status.tsx', serverLoader: 'serverLoader', meta: { head: { title: 'SSR status page' } } },
];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
    { id: 'head', plugin: headPlugin, options: { id: 'application:head', titleTemplate: ' · demo' } },
    { id: 'ssr', plugin: ssrPlugin, options: { id: 'application:ssr', prerender: true, prerenderPaths: async () => [{ path: '/backend/7' }, { path: '/backend/8', prerender: false }], prerenderIncremental: true, sitemap: 'https://example.com', streaming: true } },
    { id: 'serve', plugin: servePlugin, options: { id: 'application:serve', port: 0, base: '/ssr/', streaming: true } },
  ],
  app: { ssr: true, base: '/ssr/', routes: [], server: { port: 0 } },
});
`;

export async function writeSsrFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><meta charset="utf-8" /><title>SSR demo</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': ssrConfiguration,
    'src/pages/index.tsx': `import { Helmet, Link } from '@cormijs/runtime';
export default function Home(){return <main><Helmet title="Helmet home title" metas={[{ name: 'helmet', content: 'yes' }]} /><h1>SSR home</h1><nav><Link to="/backend/7">Backend</Link><Link to="/guide">Guide</Link></nav></main>;}`,
    'src/pages/guide.tsx': `import { Link, useClientLoaderData } from '@cormijs/runtime';
interface Data { message: string }
export default function Guide(){
  const data = useClientLoaderData<Data>();
  return <main><h1>SSR guide</h1><p data-guide>{data.message}</p><Link to="/">Home</Link></main>;
}
export async function clientLoader(): Promise<Data> { return { message: 'loaded on server' }; }`,
    'src/pages/backend.tsx': `import { Link, useServerLoaderData } from '@cormijs/runtime';
interface Data { message: string; id: string; path: string }
export default function Backend(){
  const data = useServerLoaderData<Data>();
  return <main><h1>SSR backend</h1><p data-server-loader="true">{data.message}:{data.id}:{data.path}</p><Link to="/">Home</Link></main>;
}
export async function serverLoader({ request, params }: { request: Request; params: { id?: string } }): Promise<Data> {
  return { message: 'server loader', id: params.id ?? 'none', path: new URL(request.url).pathname };
}`,
    'src/pages/status.tsx': `import { Link, useServerLoaderData } from '@cormijs/runtime';
interface Data { source: string }
export default function Status(){
  const data = useServerLoaderData<Data>();
  return <main><h1>SSR status</h1><p data-status="true">{data.source}</p><Link to="/">Home</Link></main>;
}
export async function serverLoader({ request }: { request: Request; params: Record<string, string | undefined> }): Promise<Data> {
  return { source: new URL(request.url).pathname };
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifySsrPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'SSR home', exact: true }).waitFor();
  assert.equal(await page.title(), 'Helmet home title · demo');
  assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), 'server description');
  assert.equal(await page.locator('meta[name="helmet"]').getAttribute('content'), 'yes');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);

  const loaderRequests: string[] = [];
  const track = (request: import('playwright-core').Request) => { if (request.url().includes('/.cormi/server-loader')) loaderRequests.push(request.url()); };
  page.on('request', track);
  const backend = await page.request.get(new URL('backend/7', url).href, { headers: { accept: 'text/html' } });
  assert.equal(backend.status(), 200);
  const backendHtml = await backend.text();
  assert.match(backendHtml, /<div id="root"><main><h1>SSR backend<\/h1><p data-server-loader="true">server loader(?:<!-- -->)?:(?:<!-- -->)?7(?:<!-- -->)?:(?:<!-- -->)?\/ssr\/backend\/7<\/p>/);
  assert.match(backendHtml, /<title>SSR backend page · demo<\/title>/);
  assert.match(backendHtml, /__staticRouterHydrationData/);
  await page.goto(new URL('backend/7', url).href);
  await page.getByRole('heading', { name: 'SSR backend', exact: true }).waitFor();
  assert.equal(await page.locator('[data-server-loader]').innerText(), 'server loader:7:/ssr/backend/7');
  assert.equal(loaderRequests.length, 0, 'hydration consumes server data without calling the fallback endpoint');
  const hydration = await page.evaluate(() => (window as any).__staticRouterHydrationData);
  assert.deepEqual(hydration?.loaderData, { backend: { message: 'server loader', id: '7', path: '/ssr/backend/7' } });

  await page.goto(url); await page.getByRole('heading', { name: 'SSR home', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Backend', exact: true }).click();
  await page.getByRole('heading', { name: 'SSR backend', exact: true }).waitFor();
  assert.equal(await page.locator('[data-server-loader]').innerText(), 'server loader:7:/ssr/backend/7');
  assert.ok(loaderRequests.length >= 1, 'client navigation fetched the server loader endpoint');
  assert.ok(new URL(loaderRequests.at(-1)!).searchParams.get('url')?.endsWith('/backend/7'));
  page.off('request', track);

  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('heading', { name: 'SSR home', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Guide', exact: true }).click();
  await page.getByRole('heading', { name: 'SSR guide', exact: true }).waitFor();
  assert.equal(await page.title(), 'SSR guide page · demo');
  assert.equal(await page.locator('[data-guide]').innerText(), 'loaded on server');
  assert.equal(await page.locator('script[type="application/ld+json"]').innerText(), '{"@type":"Article","headline":"Guide"}');

  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('heading', { name: 'SSR home', exact: true }).waitFor();
  assert.equal(await page.title(), 'Helmet home title · demo');

  await page.goto(new URL('guide', url).href);
  await page.getByRole('heading', { name: 'SSR guide', exact: true }).waitFor();
  assert.equal(await page.title(), 'SSR guide page · demo');
  await page.reload();
  await page.getByRole('heading', { name: 'SSR guide', exact: true }).waitFor();
  assert.equal(await page.title(), 'SSR guide page · demo');
  assert.equal(await page.locator('[data-guide]').innerText(), 'loaded on server');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
