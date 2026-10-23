import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const chartsConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin } from '@cormijs/plugin-react';
import { ssrPlugin } from '@cormijs/plugin-react-vite';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'app', plugin: appRuntimePlugin }, { id: 'ssr', plugin: ssrPlugin, options: { id: 'application:ssr' } }],
  app: { ssr: true, base: '/charts/', server: { port: 0 } },
});
`;

export async function writeChartsFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi charts</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': chartsConfiguration,
    'src/pages/index.tsx': `import { lazy, Suspense } from 'react';
import { ClientOnly } from '@cormijs/runtime';
const Pie = lazy(() => import('@ant-design/plots').then(module => ({ default: module.Pie })));
const data = [{ type: 'A', value: 3 }, { type: 'B', value: 5 }, { type: 'C', value: 2 }];
export default function Home(){
  return <main><h1>Charts demo</h1><ClientOnly fallback={<p data-chart-fallback>Loading chart</p>}><Suspense fallback={<p data-chart-fallback>Loading chart</p>}><div data-chart><Pie data={data} angleField="value" colorField="type" height={280} legend={{ color: { position: 'bottom' } }} /></div></Suspense></ClientOnly></main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyChartsPage(page: Page, url: string) {
  const html = await (await page.request.get(url, { headers: { accept: 'text/html' } })).text();
  assert.match(html, /data-chart-fallback/);
  assert.doesNotMatch(html, /<canvas/);
  await page.goto(url);
  await page.getByRole('heading', { name: 'Charts demo', exact: true }).waitFor();
  const canvas = page.locator('[data-chart] canvas');
  await canvas.waitFor();
  assert.equal(await page.locator('[data-chart-fallback]').count(), 0);
  assert.ok(await canvas.evaluate(node => (node as HTMLCanvasElement).width > 0 && (node as HTMLCanvasElement).height > 0), 'the chart canvas has a rendered size');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
