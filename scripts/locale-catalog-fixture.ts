import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const localeCatalogConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, localePlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'locale', plugin: localePlugin, options: { id: 'application:locale', directory: 'src/locales' } },
  ],
  app: { base: '/locale-catalog/', server: { port: 0 } },
});
`;

export async function writeLocaleCatalogFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'src/locales'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi locale catalog</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': localeCatalogConfiguration,
    'src/app.tsx': `import { defineApp } from '@cormijs/runtime';
export default defineApp({
  locale: { default: 'en', fallback: 'en', storageKey: 'demo-catalog:locale', messages: { en: { title: 'Configured title' } } },
});`,
    'src/locales/en.json': JSON.stringify({ greeting: 'Hello {name}', fromCatalog: 'catalog only' }),
    'src/locales/zh-CN.json': JSON.stringify({ title: '目录标题', greeting: '你好 {name}', fromCatalog: '仅目录提供' }),
    'src/pages/index.tsx': `import { FormattedMessage, useIntl } from '@cormijs/runtime';
export default function Home(){
  const {locale,setLocale,t}=useIntl();
  return <main>
    <h1 data-title>{t('title')}</h1>
    <p data-locale>{locale}</p>
    <p data-greeting><FormattedMessage id="greeting" values={{name:'Ada'}} /></p>
    <p data-catalog>{t('fromCatalog')}</p>
    <button data-switch onClick={()=>setLocale(locale === 'en' ? 'zh-CN' : 'en')}>Switch</button>
  </main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyLocaleCatalogPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Configured title', exact: true }).waitFor();
  assert.equal(await page.locator('[data-locale]').innerText(), 'en');
  assert.equal(await page.locator('[data-greeting]').innerText(), 'Hello Ada');
  assert.equal(await page.locator('[data-catalog]').innerText(), 'catalog only');
  await page.locator('[data-switch]').click();
  await page.waitForFunction(() => document.querySelector('[data-locale]')?.textContent === 'zh-CN');
  assert.equal(await page.locator('[data-title]').innerText(), '目录标题');
  assert.equal(await page.locator('[data-greeting]').innerText(), '你好 Ada');
  assert.equal(await page.locator('[data-catalog]').innerText(), '仅目录提供');
  await page.locator('[data-switch]').click();
  await page.waitForFunction(() => document.querySelector('[data-locale]')?.textContent === 'en');
  assert.equal(await page.locator('[data-title]').innerText(), 'Configured title', 'the app configuration wins over the catalog');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
