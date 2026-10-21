import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const localeConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, localePlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'locale', plugin: localePlugin, options: { id: 'application:locale' } },
  ],
  app: { base: '/locale/', server: { port: 0 } },
});
`;

export async function writeLocaleFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi locale</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': localeConfiguration,
    'src/app.tsx': `import { defineApp } from '@cormijs/runtime';
export default defineApp({
  locale: {
    default: 'en', fallback: 'en', storageKey: 'demo:locale',
    messages: {
      en: { title: 'Locale demo', greeting: 'Hello {name}', fallbackOnly: 'English fallback', items_one: '{count} item', items_other: '{count} items' },
      zh: { title: '语言演示', greeting: '你好 {name}', items_other: '{count} 项' },
    },
  },
});`,
    'src/pages/index.tsx': `import { FormattedMessage, useIntl } from '@cormijs/runtime';
export default function Home(){
  const {locale,setLocale,t,tp,formatNumber,formatDate}=useIntl();
  return <main>
    <h1 data-title>{t('title')}</h1>
    <p data-locale>{locale}</p>
    <p data-greeting>{t('greeting',{name:'Ada'})}</p>
    <p data-fallback>{t('fallbackOnly')}</p>
    <p data-formatted><FormattedMessage id="greeting" values={{name:'Grace'}} /></p>
    <p data-plural-one>{tp('items', 1)}</p>
    <p data-plural>{tp('items', 5)}</p>
    <p data-number>{formatNumber(1234.5)}</p>
    <p data-date>{formatDate(Date.UTC(2024, 0, 2), { timeZone: 'UTC', dateStyle: 'short' })}</p>
    <button data-switch onClick={()=>setLocale(locale === 'en' ? 'zh' : 'en')}>Switch</button>
  </main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyLocalePage(page: Page, url: string) {
  await page.goto(url); await page.evaluate(() => localStorage.removeItem('demo:locale')); await page.reload();
  await page.getByRole('heading', { name: 'Locale demo', exact: true }).waitFor();
  assert.equal(await page.locator('[data-locale]').innerText(), 'en');
  assert.equal(await page.locator('[data-greeting]').innerText(), 'Hello Ada');
  assert.equal(await page.locator('[data-formatted]').innerText(), 'Hello Grace');
  assert.equal(await page.locator('[data-fallback]').innerText(), 'English fallback');
  assert.equal(await page.locator('[data-plural-one]').innerText(), '1 item');
  assert.equal(await page.locator('[data-plural]').innerText(), '5 items');
  assert.equal(await page.locator('[data-number]').innerText(), '1,234.5');
  assert.equal(await page.locator('[data-date]').innerText(), '1/2/24');
  await page.locator('[data-switch]').click();
  await page.getByRole('heading', { name: '语言演示', exact: true }).waitFor();
  assert.equal(await page.locator('[data-locale]').innerText(), 'zh');
  assert.equal(await page.locator('[data-greeting]').innerText(), '你好 Ada');
  assert.equal(await page.locator('[data-formatted]').innerText(), '你好 Grace');
  assert.equal(await page.locator('[data-fallback]').innerText(), 'English fallback');
  assert.equal(await page.locator('[data-plural]').innerText(), '5 项');
  assert.equal(await page.locator('[data-number]').innerText(), '1,234.5');
  assert.equal(await page.locator('[data-date]').innerText(), '2024/1/2');
  await page.reload(); await page.getByRole('heading', { name: '语言演示', exact: true }).waitFor();
  assert.equal(await page.locator('[data-locale]').innerText(), 'zh');
  await page.locator('[data-switch]').click(); await page.getByRole('heading', { name: 'Locale demo', exact: true }).waitFor();
  assert.equal(await page.locator('[data-locale]').innerText(), 'en');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
