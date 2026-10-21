import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const antdConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, localePlugin } from '@cormijs/plugin-react';
import { antdPlugin } from '@cormijs/plugin-antd';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app', plugin: appRuntimePlugin },
    { id: 'locale', plugin: localePlugin, options: { id: 'application:locale' } },
    { id: 'antd', plugin: antdPlugin, options: { id: 'application:antd', theme: { token: { colorPrimary: '#1677ff' } } } },
  ],
  app: { base: '/antd/', server: { port: 0 } },
});
`;

export async function writeAntdFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi antd</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': antdConfiguration,
    'src/app.tsx': `import { defineApp } from '@cormijs/runtime';
export default defineApp({ locale: { default: 'en', fallback: 'en', storageKey: 'demo:antd-locale', messages: {
  en: { title: 'Antd demo' },
  zh: { title: 'Antd 演示' },
} } });`,
    'src/pages/index.tsx': `import { Button, Empty } from 'antd';
import { useIntl } from '@cormijs/runtime';
export default function Home(){
  const { locale, setLocale, t } = useIntl();
  return <main><h1>{t('title')}</h1><Empty /><Button data-primary type="primary">Action</Button>
    <button data-switch onClick={()=>setLocale(locale === 'en' ? 'zh' : 'en')}>Switch</button></main>;
}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyAntdPage(page: Page, url: string) {
  await page.goto(url); await page.evaluate(() => localStorage.removeItem('demo:antd-locale')); await page.reload();
  await page.getByRole('heading', { name: 'Antd demo', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.ant-empty-description')?.textContent === 'No data');
  assert.equal(await page.locator('[data-primary]').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(22, 119, 255)');
  await page.locator('[data-switch]').click();
  await page.getByRole('heading', { name: 'Antd 演示', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.ant-empty-description')?.textContent === '暂无数据');
  await page.reload(); await page.getByRole('heading', { name: 'Antd 演示', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.ant-empty-description')?.textContent === '暂无数据');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
