import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export type HistoryKind = 'hash' | 'memory';

export function historyConfiguration(type: HistoryKind, base: string) {
  return `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
export default defineConfig({
  presets: [preset],
  app: { base: '${base}', history: '${type}', server: { port: 0 } },
});
`;
}

export async function writeHistoryFixture(root: string, type: HistoryKind, base: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi history</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': historyConfiguration(type, base),
    'src/pages/_layout.tsx': `import { Link, Outlet, useLocation } from '@cormijs/runtime';
export default function Layout(){const location=useLocation();return <section data-history-layout data-path={location.pathname}><nav><Link to="/">History home</Link><Link to="/about">History about</Link><Link to="/query?tab=one">History query</Link></nav><Outlet /></section>;}`,
    'src/pages/index.tsx': `export default function Home(){return <main><h1>History home</h1></main>;}`,
    'src/pages/about.tsx': `export default function About(){return <main><h1>History about</h1></main>;}`,
    'src/pages/query.tsx': `import { useNavigate, useSearchParams } from '@cormijs/runtime';
export default function Query(){const [params,setParams]=useSearchParams(),navigate=useNavigate();return <main><h1>History query</h1><p data-query>{params.get('tab') ?? ''}|{params.get('q') ?? ''}</p><button onClick={()=>setParams({tab:'two',q:'value'})}>Update query</button><button onClick={()=>navigate('/about')}>Navigate about</button></main>;}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyHistoryPage(page: Page, url: string, type: HistoryKind, base: string) {
  const at = (path: string) => new URL(path, url).href;
  await page.goto(url); await page.getByRole('heading', { name: 'History home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-history-layout]').getAttribute('data-path'), '/');
  assert.equal(new URL(page.url()).pathname, base);
  if (type === 'hash') assert.equal(new URL(page.url()).hash, '');
  else assert.equal(new URL(page.url()).hash, '');

  await page.getByRole('link', { name: 'History about', exact: true }).click();
  await page.getByRole('heading', { name: 'History about', exact: true }).waitFor();
  assert.equal(await page.locator('[data-history-layout]').getAttribute('data-path'), '/about');
  if (type === 'hash') {
    assert.equal(new URL(page.url()).pathname, base);
    assert.equal(new URL(page.url()).hash, '#/about');
  } else {
    assert.equal(new URL(page.url()).pathname, base);
    assert.equal(new URL(page.url()).hash, '');
  }

  await page.getByRole('link', { name: 'History query', exact: true }).click();
  await page.getByRole('heading', { name: 'History query', exact: true }).waitFor();
  assert.equal(await page.locator('[data-query]').innerText(), 'one|');
  await page.getByRole('button', { name: 'Update query', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-query]')?.textContent === 'two|value');
  assert.equal(await page.locator('[data-query]').innerText(), 'two|value');
  if (type === 'hash') assert.match(new URL(page.url()).hash, /#\/query\?tab=two&q=value/);

  await page.reload();
  if (type === 'hash') {
    await page.getByRole('heading', { name: 'History query', exact: true }).waitFor();
    assert.equal(await page.locator('[data-query]').innerText(), 'two|value');
  } else {
    await page.getByRole('heading', { name: 'History home', exact: true }).waitFor();
    assert.equal(await page.locator('[data-history-layout]').getAttribute('data-path'), '/');
  }
  await page.goto(at('')); await page.getByRole('heading', { name: 'History home', exact: true }).waitFor();
}
