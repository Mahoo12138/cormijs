import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const menuConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { accessPlugin, appRuntimePlugin, initialStatePlugin, menuPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', routes: [
    { index: true, component: './src/Home.tsx', meta: { title: 'Home', order: 2 } },
    { path: 'about', component: './src/About.tsx', meta: { title: 'About', order: 1 } },
    { path: 'team', component: './src/Team.tsx', meta: { title: 'Team', order: 4 }, routes: [
      { index: true, component: './src/TeamHome.tsx', meta: { title: 'Overview' } },
    ] },
    { path: 'admin', component: './src/Admin.tsx', meta: { title: 'Admin', order: 3, access: 'canAdmin' }, access: 'canAdmin' },
  ],
}];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
    { id: 'access', plugin: accessPlugin, options: { id: 'application:access' } },
    { id: 'menu', plugin: menuPlugin, options: { id: 'application:menu' } },
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
  ],
  app: { base: '/menu/', routes: [], server: { port: 0 } },
});
`;

export async function writeMenuFixture(root: string) {
  await mkdir(join(root, 'src'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi menu</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': menuConfiguration,
    'src/app.tsx': `import { defineApp } from '@cormijs/runtime';
export default defineApp({
  async getInitialState() { await new Promise(resolve => setTimeout(resolve, 60)); return { role: 'user' }; },
  access(state) { return { canAdmin: (state as { role?: string } | undefined)?.role === 'admin' }; },
});`,
    'src/Shell.tsx': `import { Link, Outlet, useAccess, useBreadcrumb, useInitialState, useMenu } from '@cormijs/runtime';
function MenuList({items}:{items:readonly import('@cormijs/runtime').MenuItem[]}){return <ul>{items.map(item=><li key={item.key}><Link to={item.path}>{item.title}</Link>{item.children.length?<MenuList items={item.children}/>:null}</li>)}</ul>;}
export default function Shell(){
  const initial=useInitialState<{role:string}>();useAccess();
  const crumbs=useBreadcrumb();
  return <section data-shell><header><h1>Menu demo</h1><nav data-menu><MenuList items={useMenu()} /></nav><p data-crumbs>{crumbs.map(item=>item.title).join(' > ')}</p><button data-promote onClick={()=>initial.setInitialState({role:'admin'})}>Promote</button></header><Outlet/></section>;
}`,
    'src/Home.tsx': 'export default function Home(){return <main><h2>Home page</h2></main>;}',
    'src/About.tsx': 'export default function About(){return <main><h2>About page</h2></main>;}',
    'src/Admin.tsx': 'export default function Admin(){return <main><h2>Admin page</h2></main>;}',
    'src/Team.tsx': 'import { Outlet } from "react-router";export default function Team(){return <section data-team><h2>Team page</h2><Outlet/></section>;}',
    'src/TeamHome.tsx': 'export default function TeamHome(){return <main><h3>Team overview</h3></main>;}',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyMenuPage(page: Page, url: string) {
  const menuText = async () => (await page.locator('[data-menu]').innerText()).split('\n').map(line => line.trim()).filter(Boolean);
  await page.goto(url); await page.getByRole('heading', { name: 'Home page', exact: true }).waitFor();
  assert.deepEqual(await menuText(), ['About', 'Home', 'Team', 'Overview']);
  assert.equal(await page.locator('[data-crumbs]').innerText(), 'Home');
  assert.equal(await page.locator('[data-menu]').getByRole('link', { name: 'Admin', exact: true }).count(), 0);

  await page.goto(new URL('admin', url).href);
  await page.getByRole('heading', { name: '403', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Admin page', exact: true }).count(), 0);
  await page.goto(url); await page.getByRole('heading', { name: 'Home page', exact: true }).waitFor();

  await page.locator('[data-menu]').getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByRole('heading', { name: 'Team overview', exact: true }).waitFor();
  assert.equal(await page.locator('[data-crumbs]').innerText(), 'Team > Overview');
  await page.locator('[data-menu]').getByRole('link', { name: 'About', exact: true }).click();
  await page.getByRole('heading', { name: 'About page', exact: true }).waitFor();
  assert.equal(await page.locator('[data-crumbs]').innerText(), 'About');

  await page.locator('[data-promote]').click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-menu] a')).some(link => link.textContent === 'Admin'));
  await page.locator('[data-menu]').getByRole('link', { name: 'Admin', exact: true }).click();
  await page.getByRole('heading', { name: 'Admin page', exact: true }).waitFor();
  assert.equal(await page.locator('[data-crumbs]').innerText(), 'Admin');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
