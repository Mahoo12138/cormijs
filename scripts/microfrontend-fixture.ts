import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const microfrontendConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'app', plugin: appRuntimePlugin }],
  app: { base: '/micro/', server: { port: 0 } },
});
`;

export async function writeMicrofrontendFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi micro app</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': microfrontendConfiguration,
    'src/pages/index.tsx': `import { useRef, useState } from 'react';
import { createMicroApp } from '@cormijs/runtime/microfrontend';
const micro = createMicroApp({
  routes: [{ id: 'micro-home', path: '/', Component: () => <p data-micro>Micro content</p> }],
  history: 'memory',
}, { mountId: 'micro-root' });
export default function Home(){
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const run = (task: () => Promise<void>) => void task().then(() => setError('')).catch(reason => setError(String(reason)));
  return <main><h1>Micro app demo</h1>
    <div data-container ref={container} />
    <button data-mount onClick={()=>run(()=>micro.mount({ container: container.current! }))}>Mount</button>
    <button data-update onClick={()=>run(()=>micro.update())}>Update</button>
    <button data-unmount onClick={()=>run(()=>micro.unmount())}>Unmount</button>
    <p data-error>{error}</p></main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyMicrofrontendPage(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Micro app demo', exact: true }).waitFor();
  await page.locator('[data-mount]').click();
  await page.locator('[data-micro]').waitFor();
  assert.equal(await page.locator('[data-container] #micro-root').count(), 1);
  await page.locator('[data-mount]').click();
  await page.waitForFunction(() => document.querySelector('[data-error]')?.textContent?.includes('MICRO_APP_INVALID'));
  await page.locator('[data-update]').click();
  await page.locator('[data-unmount]').click();
  await page.waitForFunction(() => document.querySelector('[data-container]')?.childElementCount === 0);
  await page.locator('[data-mount]').click();
  await page.locator('[data-micro]').waitFor();
  await page.locator('[data-unmount]').click();
  await page.waitForFunction(() => document.querySelector('[data-container]')?.childElementCount === 0);
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
