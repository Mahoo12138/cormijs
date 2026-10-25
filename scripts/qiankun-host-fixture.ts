import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const qiankunHostConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'app', plugin: appRuntimePlugin }],
  app: { base: '/host/', server: { port: 0 } },
});
`;

export async function writeQiankunHostFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'public/fake'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi qiankun host</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': qiankunHostConfiguration,
    'public/fake/qiankun.html': '<!doctype html><html><head><meta charset="utf-8" /></head><body><script src="./fake-micro.js"></script></body></html>',
    'public/fake/fake-micro.js': `window.FakeMicro = {
  bootstrap: async function () {},
  mount: async function (props) { props.container.innerHTML = '<p data-fake-micro>Fake micro mounted</p>'; },
  unmount: async function (props) { props.container.innerHTML = ''; },
  update: async function () {},
};`,
    'src/pages/index.tsx': `import { useState } from 'react';
import { QiankunMicroApp } from '@cormijs/plugin-qiankun/host';
export default function Home(){
  const [mounted, setMounted] = useState(false);
  return <main><h1>Qiankun host demo</h1><button data-toggle onClick={()=>setMounted(value=>!value)}>{mounted ? 'Unmount' : 'Mount'}</button>
    {mounted ? <QiankunMicroApp name="FakeMicro" entry="./fake/qiankun.html" /> : null}</main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyQiankunHostPage(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Qiankun host demo', exact: true }).waitFor();
  await page.locator('[data-toggle]').click();
  await page.locator('[data-fake-micro]').waitFor();
  assert.equal(await page.locator('[data-qiankun-host="FakeMicro"] [data-fake-micro]').count(), 1);
  await page.locator('[data-toggle]').click();
  await page.waitForFunction(() => document.querySelector('[data-fake-micro]') === null);
  await page.locator('[data-toggle]').click();
  await page.locator('[data-fake-micro]').waitFor();
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
