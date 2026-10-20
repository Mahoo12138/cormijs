import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const configRoutesSource = `import type { ConfigRoute } from '@cormijs/plugin-react';
export const routes: readonly ConfigRoute[] = [{
  id: 'shell', path: '/', component: './src/layouts/Shell.tsx',
  routes: [
    { index: true, component: './src/pages/Home.tsx', meta: { title: 'Home' } },
    { path: 'about', component: './src/pages/About.tsx', meta: { title: 'About' }, wrappers: ['./src/wrappers/Trace.tsx', './src/wrappers/Gate.tsx'] },
    { path: 'legacy/:id', redirect: '/team/:id' },
    { path: 'search', redirect: '/about', keepQuery: true },
    { id: 'team', path: 'team', component: './src/pages/team/TeamLayout.tsx', routes: [
      { index: true, component: './src/pages/team/TeamIndex.tsx', meta: { title: 'Team' } },
      { path: ':id', component: './src/pages/team/Member.tsx', errorBoundary: './src/pages/team/MemberError.tsx', meta: { title: 'Member' }, wrappers: ['./src/wrappers/Trace.tsx'] },
    ] },
  ],
}];
`;
export const configRoutesConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { routeConfigPlugin } from '@cormijs/plugin-react';
import { routes } from './src/app-routes';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'application-routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } }],
  app: { base: '/routes/', routes: [], server: { port: 0 } },
});
`;
export async function writeConfigRoutesFixture(root: string) {
  await mkdir(join(root, 'src/layouts'), { recursive: true }); await mkdir(join(root, 'src/pages/team'), { recursive: true }); await mkdir(join(root, 'src/wrappers'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi config routes</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': configRoutesConfiguration,
    'src/app-routes.ts': configRoutesSource,
    'src/layouts/Shell.tsx': `import { Link, Outlet, useLocation } from 'react-router';
import { useRouteMatches } from '@cormijs/runtime';
export default function Shell() {
  const matches = useRouteMatches(), current = matches.at(-1), location = useLocation();
  return <section data-shell="configured">
    <header><h1>Configured routes</h1><nav><Link to="/">Home</Link><Link to="/about">About</Link><Link to="/team">Team</Link><Link to="/legacy/alpha">Legacy alpha</Link><Link to="/search?q=alpha#hits">Search redirect</Link></nav></header>
    <p data-location>{location.pathname}</p>
    <p data-route={current?.id ?? ''} data-title={String(current?.meta.title ?? '')}>{current?.id} · {String(current?.meta.title ?? '')}</p>
    <Outlet />
  </section>;
}`,
    'src/pages/Home.tsx': `export default function Home(){return <main><h2>Config home</h2><p>Nested configuration owns this route.</p></main>;}`,
    'src/pages/About.tsx': `export default function About(){return <main><h2>About config</h2><p>Metadata and paths come from src/app-routes.ts.</p></main>;}`,
    'src/pages/team/TeamLayout.tsx': `import { Outlet } from 'react-router';
export default function TeamLayout(){return <section data-team="layout"><h2>Team layout</h2><Outlet /></section>;}`,
    'src/pages/team/TeamIndex.tsx': `import { Link } from 'react-router';
export default function TeamIndex(){return <main><h2>Team index</h2><Link to="/team/alpha">Member alpha</Link><Link to="/team/boom">Broken member</Link></main>;}`,
    'src/pages/team/Member.tsx': `import { Link, useParams } from 'react-router';
export default function Member(){const {id}=useParams();if(id==='boom')throw new Error('member exploded');return <main><h2>Member {id}</h2><Link to="/team">Team</Link></main>;}`,
    'src/pages/team/MemberError.tsx': `import { Link, useRouteError } from 'react-router';
export default function MemberError(){const error=useRouteError();return <main role="alert"><h2>Member boundary</h2><p>{error instanceof Error?error.message:'Unknown error'}</p><Link to="/team">Team</Link></main>;}`,
    'src/wrappers/Trace.tsx': `import { Outlet, useLocation, useParams } from 'react-router';
export default function Trace(){const params=useParams(),location=useLocation();return <div data-wrapper="trace" data-wrapper-param={String(params.id ?? '')} data-wrapper-search={location.search}><Outlet/></div>;}`,
    'src/wrappers/Gate.tsx': `import { Outlet } from 'react-router';
export default function Gate(){return <div data-wrapper="gate"><Outlet/></div>;}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}
export async function verifyConfigRoutesPage(page: Page, url: string, errorBoundary = true) {
  await page.goto(url); await page.getByRole('heading', { name: 'Config home', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/routes/'); assert.equal(await page.title(), 'cormi config routes');
  const current = page.locator('[data-route]');
  assert.equal(await current.getAttribute('data-route'), 'config:root:index');
  assert.equal(await current.getAttribute('data-title'), 'Home');
  assert.equal(await page.locator('[data-shell="configured"] [data-team]').count(), 0);
  const nav = page.getByRole('navigation');
  await nav.getByRole('link', { name: 'Legacy alpha', exact: true }).click();
  await page.getByRole('heading', { name: 'Member alpha', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/routes/team/alpha');
  assert.equal(await page.locator('[data-wrapper="trace"]').getAttribute('data-wrapper-param'), 'alpha');
  await page.goBack(); await page.getByRole('heading', { name: 'Config home', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/routes/');
  await nav.getByRole('link', { name: 'About', exact: true }).click(); await page.getByRole('heading', { name: 'About config', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/routes/about');
  assert.equal(await current.getAttribute('data-route'), 'config:about'); assert.equal(await current.getAttribute('data-title'), 'About');
  assert.equal(await page.locator('[data-wrapper="trace"] [data-wrapper="gate"] h2').innerText(), 'About config');
  assert.equal(await page.locator('[data-wrapper="trace"]').getAttribute('data-wrapper-param'), '');
  await nav.getByRole('link', { name: 'Team', exact: true }).click(); await page.getByRole('heading', { name: 'Team index', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/routes/team');
  assert.equal(await current.getAttribute('data-route'), 'config:team:index'); assert.equal(await current.getAttribute('data-title'), 'Team');
  await page.getByRole('link', { name: 'Member alpha', exact: true }).click(); await page.getByRole('heading', { name: 'Member alpha', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/routes/team/alpha');
  assert.equal(await current.getAttribute('data-route'), 'config:team/:id'); assert.equal(await current.getAttribute('data-title'), 'Member');
  assert.equal(await page.locator('[data-wrapper="trace"]').getAttribute('data-wrapper-param'), 'alpha');
  await nav.getByRole('link', { name: 'Team', exact: true }).click(); await page.getByRole('heading', { name: 'Team index', exact: true }).waitFor();
  if (errorBoundary) {
    await page.getByRole('link', { name: 'Broken member', exact: true }).click();
    const alert = page.getByRole('alert'); await alert.getByRole('heading', { name: 'Member boundary', exact: true }).waitFor();
    assert.equal(await alert.innerText().then(text => text.includes('member exploded')), true);
    assert.equal(await page.getByRole('heading', { name: 'Configured routes', exact: true }).count(), 1);
    await alert.getByRole('link', { name: 'Team', exact: true }).click(); await page.getByRole('heading', { name: 'Team index', exact: true }).waitFor();
  }
  await nav.getByRole('link', { name: 'Search redirect', exact: true }).click();
  await page.getByRole('heading', { name: 'About config', exact: true }).waitFor();
  const redirected = new URL(page.url());
  assert.equal(redirected.pathname, '/routes/about'); assert.equal(redirected.search, '?q=alpha'); assert.equal(redirected.hash, '#hits');
  assert.equal(await page.locator('[data-wrapper="trace"]').getAttribute('data-wrapper-search'), '?q=alpha');
  await page.goto(new URL('team/beta', url).href); await page.getByRole('heading', { name: 'Member beta', exact: true }).waitFor();
  await page.reload(); await page.getByRole('heading', { name: 'Member beta', exact: true }).waitFor();
  await page.goto(new URL('missing', url).href); await page.getByRole('heading', { name: '404', exact: true }).waitFor();
  await page.goto(url); await page.getByRole('heading', { name: 'Config home', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
