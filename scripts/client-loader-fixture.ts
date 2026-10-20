import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const clientLoaderConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { routeConfigPlugin } from '@cormijs/plugin-react';
const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', routes: [
    { index: true, component: './src/Home.tsx' },
    { path: 'member/:id', component: './src/Member.tsx', clientLoader: 'clientLoader' },
  ],
}];
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } }],
  app: { base: '/client-loader/', server: { port: 0 } },
});
`;

export async function writeClientLoaderFixture(root: string) {
  await mkdir(join(root, 'src'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi client loader</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': clientLoaderConfiguration,
    'src/Shell.tsx': `import { Link, Outlet } from '@cormijs/runtime';
export default function Shell(){return <section data-shell><header><h1>Client loader demo</h1><nav><Link to="/">Home</Link><Link to="/member/42">Ada</Link></nav></header><Outlet/></section>;}`,
    'src/Home.tsx': 'export default function Home(){return <main><h2>Loader home</h2></main>;}',
    'src/Member.tsx': `import { useClientLoaderData } from '@cormijs/runtime';
interface Data { id: string; hits: number }
export default function Member(){
  const data=useClientLoaderData<Data>();
  return <main><h2>Member page</h2><p data-id>{data.id}</p><p data-hits>{String(data.hits)}</p></main>;
}
export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  await new Promise(resolve => setTimeout(resolve, 40));
  return { id: params.id ?? '-', hits: 7 };
}`,
    'src/Broken.tsx': `export default function Broken(){return <main><h2>Should not render</h2></main>;}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyClientLoaderPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Loader home', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Ada', exact: true }).click();
  await page.getByRole('heading', { name: 'Member page', exact: true }).waitFor();
  assert.equal(await page.locator('[data-id]').innerText(), '42');
  assert.equal(await page.locator('[data-hits]').innerText(), '7');

  // A deep link runs the loader before the page renders, in dev and in the built bundle alike.
  await page.goto(new URL('member/7', url).href);
  await page.getByRole('heading', { name: 'Member page', exact: true }).waitFor();
  assert.equal(await page.locator('[data-id]').innerText(), '7');
  await page.reload();
  await page.getByRole('heading', { name: 'Member page', exact: true }).waitFor();
  assert.equal(await page.locator('[data-hits]').innerText(), '7');

  // Navigating back re-runs the loader for the target route only.
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('heading', { name: 'Loader home', exact: true }).waitFor();

  await page.goto(url); await page.getByRole('heading', { name: 'Loader home', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
