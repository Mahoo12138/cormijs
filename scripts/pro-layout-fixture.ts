import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const proLayoutConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { antdPlugin, proLayoutPlugin } from '@cormijs/plugin-antd';
import { appRuntimePlugin, layoutPlugin, localePlugin, menuPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
const routes = [
  { id: 'home', path: '/', component: './src/Home.tsx', meta: { title: 'Home', locale: 'menu.home', order: 1, icon: 'home' } },
  { id: 'users', path: '/users', component: './src/Users.tsx', meta: { title: 'Users', locale: 'menu.users', order: 2, icon: 'users' } },
];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app', plugin: appRuntimePlugin },
    { id: 'locale', plugin: localePlugin, options: { id: 'application:locale' } },
    { id: 'menu', plugin: menuPlugin, options: { id: 'application:menu', collapse: { storageKey: 'demo:pro-layout-collapse' } } },
    { id: 'antd', plugin: antdPlugin, options: { id: 'application:antd', theme: { token: { colorPrimary: '#1677ff' } } } },
    { id: 'pro-layout', plugin: proLayoutPlugin, options: { id: 'application:pro-layout' } },
    { id: 'layout', plugin: layoutPlugin, options: { id: 'application:layout', files: ['src/layouts/index.tsx'] } },
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
  ],
  app: { base: '/pro-layout/', routes: [], server: { port: 0 } },
});
`;

export async function writeProLayoutFixture(root: string) {
  await mkdir(join(root, 'src/layouts'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi pro layout</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': proLayoutConfiguration,
    'src/app.tsx': `import { defineApp } from '@cormijs/runtime';
export default defineApp({ locale: { default: 'en', fallback: 'en', storageKey: 'demo:pro-layout-locale', messages: {
  en: { 'app.title': 'ProLayout demo', 'menu.home': 'Home', 'menu.users': 'Users', 'page.home': 'Home page', 'page.users': 'Users page' },
  zh: { 'app.title': 'ProLayout 演示', 'menu.home': '首页', 'menu.users': '用户', 'page.home': '首页', 'page.users': '用户页' },
} } });`,
    'src/layouts/index.tsx': `import { Outlet } from 'react-router';
import { HomeOutlined, TeamOutlined } from '@ant-design/icons';
import { ProLayoutShell } from '@cormijs/plugin-antd/pro-layout';
import { useIntl } from '@cormijs/runtime';
const icons = { home: <HomeOutlined />, users: <TeamOutlined /> };
export default function Layout(){
  const { t } = useIntl();
  return <ProLayoutShell title={t('app.title')} icons={icons} settingDrawer settingsStorageKey="demo:pro-layout-settings"><Outlet /></ProLayoutShell>;
}`,
    'src/Home.tsx': `import { Button } from 'antd';
import { useIntl } from '@cormijs/runtime';
import { useProLayoutSettings } from '@cormijs/plugin-antd/pro-layout';
export default function Home(){
  const { locale, setLocale, t } = useIntl();
  const { settings, update } = useProLayoutSettings();
  const dark = settings.navTheme === 'realDark';
  return <main><h2>{t('page.home')}</h2><Button data-themed type="primary">Themed</Button>
    <button data-theme onClick={()=>update(dark ? { navTheme: 'light', colorPrimary: '#1677ff' } : { navTheme: 'realDark', colorPrimary: '#722ed1' })}>Toggle theme</button>
    <button data-switch onClick={()=>setLocale(locale === 'en' ? 'zh' : 'en')}>Switch locale</button></main>;
}`,
    'src/Users.tsx': `import { useIntl } from '@cormijs/runtime';
export default function Users(){ const { t } = useIntl(); return <main><h2>{t('page.users')}</h2></main>; }`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyProLayoutPage(page: Page, url: string) {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const sider = page.locator('.ant-pro-sider');
  await sider.waitFor();
  await page.getByRole('heading', { name: 'Home page', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.ant-pro-sider-logo')?.textContent?.trim() === 'ProLayout demo');
  assert.equal((await sider.locator('.ant-pro-sider-logo').textContent())?.trim(), 'ProLayout demo');
  const menuText = async () => (await page.locator('.ant-menu-item').allInnerTexts()).map(text => text.trim());
  assert.deepEqual(await menuText(), ['Home', 'Users']);
  assert.equal(await sider.locator('.anticon-home').count(), 1);
  assert.equal(await sider.locator('.anticon-team').count(), 1);
  const themed = page.locator('[data-themed]');
  assert.match((await sider.getAttribute('class')) ?? '', /ant-pro-sider-light/);
  assert.equal(await themed.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(22, 119, 255)');
  assert.equal(await page.locator('.ant-pro-setting-drawer-handle').count(), 1);
  await page.locator('.ant-pro-setting-drawer-handle').click();
  const drawer = page.locator('.ant-pro-setting-drawer-drawer-content');
  await drawer.waitFor({ state: 'visible' });
  assert.match(await drawer.innerText(), /Page style setting/);
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  await page.locator('[data-theme]').click();
  await page.waitForFunction(() => !document.querySelector('.ant-pro-sider')?.classList.contains('ant-pro-sider-light'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-themed]')!).backgroundColor !== 'rgb(22, 119, 255)');
  assert.match((await page.evaluate(() => localStorage.getItem('demo:pro-layout-settings'))) ?? '', /"realDark"/);

  await page.getByRole('menuitem', { name: 'Users' }).click();
  await page.getByRole('heading', { name: 'Users page', exact: true }).waitFor();
  assert.match(page.url(), /\/pro-layout\/users$/);
  assert.equal((await page.locator('.ant-menu-item-selected').innerText()).trim(), 'Users');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);

  await page.getByRole('menuitem', { name: 'Home' }).click();
  await page.getByRole('heading', { name: 'Home page', exact: true }).waitFor();
  await page.locator('[data-switch]').click();
  await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.ant-pro-sider-logo')?.textContent === 'ProLayout 演示');
  assert.deepEqual(await menuText(), ['首页', '用户']);
  assert.equal(await sider.locator('.anticon-home').count(), 1);
  assert.equal(await sider.locator('.anticon-team').count(), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('demo:pro-layout-locale')), 'zh');

  await page.locator('.ant-pro-sider-collapsed-button').click();
  await page.waitForFunction(() => document.querySelector('.ant-pro-sider')?.classList.contains('ant-pro-sider-collapsed'));
  assert.equal(await page.evaluate(() => localStorage.getItem('demo:pro-layout-collapse')), 'true');
  await page.reload();
  await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.ant-pro-sider')?.classList.contains('ant-pro-sider-collapsed'));
  await page.waitForFunction(() => !document.querySelector('.ant-pro-sider')?.classList.contains('ant-pro-sider-light'));
  assert.notEqual(await page.locator('[data-themed]').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(22, 119, 255)');
  await page.locator('.ant-pro-sider-collapsed-button').click();
  await page.waitForFunction(() => !document.querySelector('.ant-pro-sider')?.classList.contains('ant-pro-sider-collapsed'));
  assert.equal(await page.evaluate(() => localStorage.getItem('demo:pro-layout-collapse')), 'false');
  await page.locator('.ant-pro-setting-drawer-handle').click();
  await page.locator('.ant-pro-setting-drawer-drawer-content').waitFor({ state: 'visible' });
  assert.match(await page.locator('.ant-pro-setting-drawer-drawer-content').innerText(), /整体风格设置/);
  await page.keyboard.press('Escape');
  await page.locator('.ant-pro-setting-drawer-drawer-content').waitFor({ state: 'hidden' });
}
