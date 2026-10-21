import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const conventionalLoaderConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
export default defineConfig({
  presets: [preset],
  app: { base: '/conventional-loader/', server: { port: 0 } },
});
`;

export async function writeConventionalLoaderFixture(root: string) {
  await mkdir(join(root, 'src/pages/member'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><meta charset="utf-8" /><title>cormi conventional loader</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': conventionalLoaderConfiguration,
    'src/pages/index.tsx': `import { Link } from '@cormijs/runtime';
export default function Home(){return <main><h1>Conventional home</h1><Link to="/member/42">Member 42</Link></main>;}`,
    'src/pages/member/[id].tsx': `import { useClientLoaderData } from '@cormijs/runtime';
interface Data { id: string; loaded: boolean }
export default function Member(){
  const data=useClientLoaderData<Data>();
  return <main><h1>Conventional member</h1><p data-id>{data.id}</p><p data-loaded>{String(data.loaded)}</p></main>;
}
export async function clientLoader({ params }: { params: Record<string, string | undefined> }) {
  return { id: params.id ?? '-', loaded: true };
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyConventionalLoaderPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Conventional home', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Member 42', exact: true }).click();
  await page.getByRole('heading', { name: 'Conventional member', exact: true }).waitFor();
  assert.equal(await page.locator('[data-id]').innerText(), '42');
  assert.equal(await page.locator('[data-loaded]').innerText(), 'true');

  await page.goto(new URL('member/7', url).href);
  await page.getByRole('heading', { name: 'Conventional member', exact: true }).waitFor();
  assert.equal(await page.locator('[data-id]').innerText(), '7');
  await page.reload();
  await page.getByRole('heading', { name: 'Conventional member', exact: true }).waitFor();
  assert.equal(await page.locator('[data-loaded]').innerText(), 'true');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
