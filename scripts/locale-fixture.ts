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
      en: {
        title: 'Locale demo', greeting: 'Hello {name}', fallbackOnly: 'English fallback',
        items_one: '{count} item', items_other: '{count} items',
        guests: '{count, plural, offset:1 =0 {no guests} =1 {just you} other {you and # others}}',
        reply: '{gender, select, female {She replied} male {He replied} other {They replied}}',
        total: 'Total {amount, number} ({fee, number, percent} fee)',
        richText: '<b>Hello {name}</b>, you have {count, plural, one {# message} other {# messages}}',
      },
      zh: {
        title: '语言演示', greeting: '你好 {name}', items_other: '{count} 项',
        guests: '{count, plural, offset:1 =0 {没有客人} other {你和 # 位其他客人}}',
        reply: '{gender, select, female {她回复了} other {他们回复了}}',
        total: '总计 {amount, number}（{fee, number, percent} 手续费）',
        richText: '<b>你好 {name}</b>，你有 {count, plural, other {# 条消息}}',
      },
    },
  },
});`,
    'src/pages/index.tsx': `import { FormattedMessage, useIntl } from '@cormijs/runtime';
export default function Home(){
  const {locale,setLocale,t,tp,rich,formatNumber,formatDate,formatRelativeTime}=useIntl();
  return <main>
    <h1 data-title>{t('title')}</h1>
    <p data-locale>{locale}</p>
    <p data-greeting>{t('greeting',{name:'Ada'})}</p>
    <p data-fallback>{t('fallbackOnly')}</p>
    <p data-formatted><FormattedMessage id="greeting" values={{name:'Grace'}} /></p>
    <p data-plural-one>{tp('items', 1)}</p>
    <p data-plural>{tp('items', 5)}</p>
    <p data-icu-offset>{t('guests',{count:3})}</p>
    <p data-icu-exact>{t('guests',{count:0})}</p>
    <p data-icu-select>{t('reply',{gender:'female'})}</p>
    <p data-icu-number>{t('total',{amount:1234.5,fee:0.25})}</p>
    <p data-formatted-plural><FormattedMessage id="guests" values={{count:4}} /></p>
    <p data-rich>{rich('richText',{name:'Ada',count:2},{b:chunks=><b data-rich-bold>{chunks}</b>})}</p>
    <p data-rich-formatted><FormattedMessage id="richText" values={{name:'Grace',count:1}} tags={{b:chunks=><strong data-rich-strong>{chunks}</strong>}} /></p>
    <p data-number>{formatNumber(1234.5)}</p>
    <p data-relative>{formatRelativeTime(-2,'day')}</p>
    <p data-relative-auto>{formatRelativeTime(-1,'day',{numeric:'auto'})}</p>
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
  assert.equal(await page.locator('[data-icu-offset]').innerText(), 'you and 2 others');
  assert.equal(await page.locator('[data-icu-exact]').innerText(), 'no guests');
  assert.equal(await page.locator('[data-icu-select]').innerText(), 'She replied');
  assert.equal(await page.locator('[data-icu-number]').innerText(), 'Total 1,234.5 (25% fee)');
  assert.equal(await page.locator('[data-formatted-plural]').innerText(), 'you and 3 others');
  assert.equal(await page.locator('[data-rich]').innerText(), 'Hello Ada, you have 2 messages');
  assert.equal(await page.locator('b[data-rich-bold]').count(), 1);
  assert.equal(await page.locator('[data-rich-formatted]').innerText(), 'Hello Grace, you have 1 message');
  assert.equal(await page.locator('strong[data-rich-strong]').count(), 1);
  assert.equal(await page.locator('[data-number]').innerText(), '1,234.5');
  assert.equal(await page.locator('[data-relative]').innerText(), '2 days ago');
  assert.equal(await page.locator('[data-relative-auto]').innerText(), 'yesterday');
  assert.equal(await page.locator('[data-date]').innerText(), '1/2/24');
  await page.locator('[data-switch]').click();
  await page.getByRole('heading', { name: '语言演示', exact: true }).waitFor();
  assert.equal(await page.locator('[data-locale]').innerText(), 'zh');
  assert.equal(await page.locator('[data-greeting]').innerText(), '你好 Ada');
  assert.equal(await page.locator('[data-formatted]').innerText(), '你好 Grace');
  assert.equal(await page.locator('[data-fallback]').innerText(), 'English fallback');
  assert.equal(await page.locator('[data-plural]').innerText(), '5 项');
  assert.equal(await page.locator('[data-icu-offset]').innerText(), '你和 2 位其他客人');
  assert.equal(await page.locator('[data-icu-exact]').innerText(), '没有客人');
  assert.equal(await page.locator('[data-icu-select]').innerText(), '她回复了');
  assert.equal(await page.locator('[data-icu-number]').innerText(), '总计 1,234.5（25% 手续费）');
  assert.equal(await page.locator('[data-formatted-plural]').innerText(), '你和 3 位其他客人');
  assert.equal(await page.locator('[data-rich]').innerText(), '你好 Ada，你有 2 条消息');
  assert.equal(await page.locator('b[data-rich-bold]').count(), 1);
  assert.equal(await page.locator('[data-rich-formatted]').innerText(), '你好 Grace，你有 1 条消息');
  assert.equal(await page.locator('strong[data-rich-strong]').count(), 1);
  assert.equal(await page.locator('[data-number]').innerText(), '1,234.5');
  assert.equal(await page.locator('[data-relative]').innerText(), '2天前');
  assert.equal(await page.locator('[data-relative-auto]').innerText(), '昨天');
  assert.equal(await page.locator('[data-date]').innerText(), '2024/1/2');
  await page.reload(); await page.getByRole('heading', { name: '语言演示', exact: true }).waitFor();
  assert.equal(await page.locator('[data-locale]').innerText(), 'zh');
  await page.locator('[data-switch]').click(); await page.getByRole('heading', { name: 'Locale demo', exact: true }).waitFor();
  assert.equal(await page.locator('[data-locale]').innerText(), 'en');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
