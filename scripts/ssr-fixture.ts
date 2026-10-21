import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const ssrConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { ssrPlugin } from '@cormijs/plugin-react-vite';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'ssr', plugin: ssrPlugin, options: { id: 'application:ssr' } }],
  app: { ssr: true, server: { port: 0 } },
});
`;

export async function writeSsrFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><meta charset="utf-8" /><title>SSR demo</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': ssrConfiguration,
    'src/pages/index.tsx': 'export default function Home(){return <main><h1>SSR home</h1></main>;}',
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
  assert.match(html, /__staticRouterHydrationData/);
  await page.goto(url);
  await page.getByRole('heading', { name: 'SSR home', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);

  const guide = await page.request.get(new URL('guide', url).href, { headers: { accept: 'text/html' } });
  assert.equal(guide.status(), 200);
  const guideHtml = await guide.text();
  assert.match(guideHtml, /<div id="root"><main><h1>SSR guide<\/h1><p data-guide="true">loaded on server<\/p><\/main>/);
  await page.goto(new URL('guide', url).href);
  await page.getByRole('heading', { name: 'SSR guide', exact: true }).waitFor();
  assert.equal(await page.locator('[data-guide]').innerText(), 'loaded on server');
  const hydration = await page.evaluate(() => (window as any).__staticRouterHydrationData);
  assert.deepEqual(hydration?.loaderData, { 'file:src/pages/guide.tsx': { message: 'loaded on server' } });
}
