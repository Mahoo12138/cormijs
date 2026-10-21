import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const analyticsConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { analyticsPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', routes: [
    { index: true, component: './src/Home.tsx' },
    { path: 'guide', component: './src/Guide.tsx' },
  ],
}];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
    { id: 'analytics', plugin: analyticsPlugin, options: { id: 'application:analytics', measurementId: 'G-TEST1234', dispatch: true } },
  ],
  app: { base: '/analytics/', routes: [], server: { port: 0 } },
});
`;

export async function writeAnalyticsFixture(root: string) {
  await mkdir(join(root, 'src'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><meta charset="utf-8" /><title>cormi analytics</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': analyticsConfiguration,
    'src/Shell.tsx': `import { useEffect, useState } from 'react';
import { Link, Outlet } from '@cormijs/runtime';
interface View { path: string; referrer: string }
// The initial page-view fires before React mounts, so the fixture records at module scope.
const views: View[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('cormi:pageview', event => {
    views.push((event as CustomEvent<View>).detail);
    window.dispatchEvent(new Event('cormi:analytics-change'));
  });
}
export default function Shell(){
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump(value => value + 1);
    window.addEventListener('cormi:analytics-change', listener);
    return () => window.removeEventListener('cormi:analytics-change', listener);
  }, []);
  return <section><header><h1>Analytics demo</h1><nav><Link to="/">Home</Link><Link to="/guide">Guide</Link></nav>
    <p data-views>{views.length}</p><p data-last>{views.at(-1)?.path ?? '-'}</p></header><Outlet/></section>;
}`,
    'src/Home.tsx': 'export default function Home(){return <main><h2>Analytics home</h2></main>;}',
    'src/Guide.tsx': 'export default function Guide(){return <main><h2>Analytics guide</h2></main>;}',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyAnalyticsPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Analytics home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-views]').innerText(), '1');
  assert.equal(await page.locator('[data-last]').innerText(), '/');
  const queue = () => page.evaluate(() => (window as unknown as { dataLayer?: unknown[][] }).dataLayer ?? []);
  const initial = await queue();
  assert.ok(initial.some(entry => entry[0] === 'config' && entry[1] === 'G-TEST1234'), 'gtag config is queued');
  const firstView = initial.find(entry => entry[0] === 'event' && entry[1] === 'page_view') as unknown[] | undefined;
  assert.ok(firstView, 'the initial route sends a page_view');
  assert.equal((firstView![2] as { page_path: string }).page_path, '/analytics/');

  await page.getByRole('link', { name: 'Guide', exact: true }).click();
  await page.getByRole('heading', { name: 'Analytics guide', exact: true }).waitFor();
  assert.equal(await page.locator('[data-views]').innerText(), '2');
  assert.equal(await page.locator('[data-last]').innerText(), '/guide');
  const views = (await queue()).filter(entry => entry[0] === 'event' && entry[1] === 'page_view');
  const last = views.at(-1) as unknown[];
  assert.equal((last[2] as { page_path: string }).page_path, '/analytics/guide');
  assert.equal((last[2] as { page_referrer: string }).page_referrer, '/analytics/', 'the previous served location is the referrer');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
