import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import type { Diagnosis } from 'cormijs';
import { filesUnder } from './packaging.js';

interface Event { type: string; generation?: number; url?: string }
interface Workflow {
  consumer: string; name: string; out: string; port: number; page: Page;
  server(command: 'dev' | 'preview', action: (url: string, wait: (predicate: (event: Event) => boolean) => Promise<Event>) => Promise<void>): Promise<void>;
  cli(command: string, args?: string[], expected?: number): Promise<string>;
  record(stage: Record<string, unknown>): Promise<void>;
}
function diagnosis(text: string): Diagnosis {
  for (const line of text.split('\n')) {
    let event: { type?: string; data?: Diagnosis };
    try { event = JSON.parse(line); } catch { continue; }
    if (['result', 'diagnosis'].includes(event.type ?? '') && event.data?.format === 'cormi:diagnosis:1') return event.data;
  }
  throw new Error('No structured diagnosis report');
}
/** Same installed plugin object twice, without the author source tree or a second frontend host. */
export async function verifyPluginInstances(w: Workflow): Promise<void> {
  const configFile = join(w.consumer, 'cormi.config.ts'), layoutFile = join(w.consumer, 'src/InstanceLayout.tsx');
  const original = await readFile(configFile, 'utf8');
  const config = ({ alpha = true, duplicate = false, routeConflict = false, apiConflict = false } = {}) => `
import { defineConfig } from 'cormijs';
import type { Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-react';
import preset from '@cormijs/preset-react-vite';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';
import feature from ${JSON.stringify(w.name)};
const layout: Plugin.Object<void> = { name:'test:instance-layout', inject:['react'], apply(ctx) {
  ctx.effect(() => ctx.react.routes.tap({ id:'test:instance-layout',owner:'test:instance-layout',ownerOrder:0,stage:100,
    run: routes => routes.map(route => route.id === 'test:layout' || route.parentId ? route : {...route,parentId:'test:layout'}) }));
} };
export default defineConfig(({command})=>({presets:[preset],plugins:[
  {id:'api',plugin:devApiVitePlugin,options:{prefix:'/customer/api'},enabled:command==='dev'},
  {id:'layout',plugin:layout},
  {id:'beta',plugin:feature,options:{instance:${JSON.stringify(duplicate ? 'alpha' : 'beta')},routePath:${JSON.stringify(routeConflict ? 'plugin/alpha' : 'plugin/beta')},apiPath:${JSON.stringify(apiConflict ? '/alpha/hello' : '/beta/hello')},development:command==='dev',label:'Beta',apiBase:'/customer/api'}},
  {id:'alpha',plugin:feature,enabled:${alpha},options:{instance:'alpha',routePath:'plugin/alpha',apiPath:'/alpha/hello',development:command==='dev',label:'Alpha',apiBase:'/customer/api'}},
],app:{base:'/customer/',server:{host:'127.0.0.1',port:${w.port}},routes:[{id:'test:layout',path:'',module:{specifier:'./src/InstanceLayout.tsx',exportName:'default'},source:{file:'src/InstanceLayout.tsx'}}]}}));
`;
  await writeFile(layoutFile, `import {Link,Outlet} from 'react-router';
export default function Layout(){return <><nav aria-label="实例导航"><Link to="/plugin/alpha">前往 Alpha</Link>{' | '}<Link to="/plugin/beta">前往 Beta</Link></nav><Outlet/></>;}
`, { flag: 'wx' });
  const { page } = w;
  const ready = async (name: 'Alpha' | 'Beta', count = 0) => {
    await page.getByRole('heading', { name: '插件开发示例', exact: true }).waitFor();
    await page.getByText(name, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Count: ' + count, exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/customer/plugin/' + name.toLowerCase());
    assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(), 0);
  };
  const request = async (name: string) => {
    await page.getByRole('button', { name: '请求插件 API', exact: true }).click();
    await page.locator('output').filter({ hasText: 'Hello, ' + name + '!' }).waitFor();
  };
  try {
    await writeFile(configFile, config()); await w.cli('typecheck');
    const report = diagnosis(await w.cli('diagnose'));
    assert.ok(report.healthy);
    const contributions = report.contributions.find(s => s.id === 'dev-api')!.records.filter(r => r.kind === 'api-contribution');
    assert.equal(contributions.length, 2); assert.equal(new Set(contributions.map(r => r.ownerUid)).size, 2);
    assert.ok(report.configured.some(p => p.id === 'alpha' && p.enabled)); assert.ok(report.configured.some(p => p.id === 'beta' && p.enabled));
    await w.record({ label: 'two-installed-instances-diagnosed', ownerUids: contributions.map(r => r.ownerUid), reversedRegistrationOrder: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await w.server('dev', async (url, wait) => {
      await page.goto(new URL('plugin/alpha', url).href); await ready('Alpha'); await request('Alpha');
      const origin = await page.evaluate(() => performance.timeOrigin);
      await page.getByRole('button', { name: 'Count: 0', exact: true }).click(); await page.getByRole('button', { name: 'Count: 1', exact: true }).click();
      await page.getByRole('link', { name: '前往 Beta', exact: true }).click(); await ready('Beta');
      assert.equal(await page.locator('output').textContent(), '尚未请求'); await request('Beta');
      await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
      await page.getByRole('link', { name: '前往 Alpha', exact: true }).click(); await ready('Alpha');
      assert.equal(await page.locator('output').textContent(), '尚未请求'); assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
      await request('Alpha'); await page.getByRole('link', { name: '前往 Beta', exact: true }).click(); await ready('Beta');
      await w.record({ label: 'same-module-client-navigation-isolates-provider-and-local-state', pageReloaded: false, perRouteStateRetentionPromised: false });
      await writeFile(configFile, config({ alpha: false })); await wait(e => e.type === 'ready' && e.generation === 2);
      await page.waitForFunction(before => performance.timeOrigin !== before, origin); await ready('Beta'); await request('Beta');
      assert.equal((await fetch(new URL('api/alpha/hello', url))).status, 404);
      assert.deepEqual(await (await fetch(new URL('api/beta/hello', url))).json(), { message: 'Hello, Beta!' });
      await page.getByRole('link', { name: '前往 Alpha', exact: true }).click(); await page.getByRole('heading', { name: '404', exact: true }).waitFor();
      await writeFile(configFile, config()); await wait(e => e.type === 'ready' && e.generation === 3); await ready('Alpha'); await request('Alpha');
      await page.screenshot({ path: join(w.out, 'instances-alpha.png'), fullPage: false });
      await w.record({ label: 'one-instance-config-disable-and-restore', generations: 3, peerRemainsAvailable: true, workerRestartExpected: true });
    });
    await w.cli('build'); const published = await filesUnder(join(w.consumer, 'dist'));
    const generated = await readFile(join(w.consumer, '.cormi/app.tsx'));
    await writeFile(configFile, config({ duplicate: true }));
    const duplicate = diagnosis(await w.cli('diagnose', [], 1)); assert.equal(duplicate.healthy, false); assert.equal(duplicate.readiness.status, 'failed');
    assert.deepEqual(await readFile(join(w.consumer, '.cormi/app.tsx')), generated);
    await writeFile(configFile, config({ routeConflict: true })); assert.match(await w.cli('build', [], 1), /ROUTE_CONFLICT|Ambiguous routes/);
    assert.deepEqual(await filesUnder(join(w.consumer, 'dist')), published);
    await writeFile(configFile, config({ apiConflict: true })); const api = diagnosis(await w.cli('diagnose', [], 1)); assert.equal(api.healthy, false);
    assert.deepEqual(await filesUnder(join(w.consumer, 'dist')), published);
    await w.record({ label: 'namespace-and-URL-conflicts-fail-without-replacing-published-output', distinctFailures: 3 });
    await writeFile(configFile, config()); await w.cli('typecheck'); await w.cli('build'); await w.cli('build');
    const production = diagnosis(await w.cli('diagnose', ['--for', 'build'])); assert.ok(production.healthy);
    assert.equal(production.contributions.find(s => s.id === 'dev-api'), undefined);
    await w.server('preview', async url => {
      await page.goto(new URL('plugin/alpha', url).href); await ready('Alpha');
      assert.equal(await page.getByRole('button', { name: '请求插件 API', exact: true }).isEnabled(), false);
      await page.getByRole('link', { name: '前往 Beta', exact: true }).click(); await ready('Beta');
      await page.reload(); await ready('Beta');
      assert.equal(await page.locator('main').evaluate(e => getComputedStyle(e).borderTopWidth), '2px');
      await page.locator('img[alt="插件资源示例"]').evaluate(async (e: HTMLImageElement) => { await e.decode(); });
      const response = await fetch(new URL('api/beta/hello', url)); assert.doesNotMatch(await response.text(), /Hello, Beta!/);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(w.out, 'instances-beta-production.png'), fullPage: false });
    });
    await w.record({ label: 'two-instance-production-deep-links-and-client-only-runtime', mockAvailable: false });
  } finally {
    await writeFile(configFile, original); await unlink(layoutFile);
    // This consumer belongs to the test. Restore a valid original build, including generated metadata.
    await w.cli('build');
  }
}
