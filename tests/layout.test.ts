import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { applyGlobalLayout, expandRouteConfig, validateRoutes } from '@cormijs/routes';
import { layoutContributions, layoutPlugin, reactPlugin } from '@cormijs/plugin-react';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';
import { hasCode } from './helpers.js';

const home = { specifier: './src/routes/Home.tsx', exportName: 'default' } as const;
const layout = { specifier: './src/layouts/index.tsx', exportName: 'default' } as const;

test('global layout wraps only top-level routes that do not opt out', () => {
  const routes = validateRoutes([
    { id: 'shell', path: '', module: home, source: {} },
    { id: 'bare', path: 'bare', module: home, layout: false, source: {} },
    { id: 'child', parentId: 'shell', path: 'child', module: home, source: {} },
  ]);
  const wrapped = applyGlobalLayout(routes, { module: layout, pluginId: 'app:layout' });
  assert.deepEqual(wrapped.map(route => [route.id, route.parentId ?? null, route.path ?? null, route.layout ?? true]), [
    ['layout:global', null, null, true],
    ['shell', 'layout:global', '', true],
    ['bare', null, 'bare', false],
    ['child', 'shell', 'child', true],
  ]);
  assert.deepEqual(wrapped[0]!.module, layout);
  assert.equal(wrapped[0]!.source.pluginId, 'app:layout');
  const optedOut = applyGlobalLayout(validateRoutes([{ id: 'bare', path: 'bare', module: home, layout: false, source: {} }]), { module: layout });
  assert.deepEqual(optedOut.map(route => route.id), ['bare']);
  assert.throws(() => applyGlobalLayout(routes, { id: 'shell', module: layout }), hasCode('ROUTE_ID_CONFLICT'));
  assert.throws(() => validateRoutes([{ id: 'x', path: 'x', module: home, layout: true, source: {} }]), hasCode('ROUTE_LAYOUT_INVALID'));
});

test('configured layout opt-out reaches wrapper records and rejects non-false values', () => {
  const routes = expandRouteConfig([{
    path: 'about',
    component: './src/routes/About.tsx',
    wrappers: ['./src/routes/Auth.tsx'],
    layout: false,
  }]);
  assert.deepEqual(routes.map(route => [route.id, route.parentId ?? null, route.path ?? null, route.layout ?? true]), [
    ['config:about:wrapper:1', null, 'about', false],
    ['config:about', 'config:about:wrapper:1', '', false],
  ]);
  assert.throws(() => expandRouteConfig([{ path: 'x', component: './src/routes/Home.tsx', layout: true }]), hasCode('ROUTE_CONFIG_INVALID'));
  assert.throws(() => layoutContributions([{ id: 'x', files: [] }]), hasCode('LAYOUT_INVALID'));
  assert.throws(() => layoutContributions([{ id: 'x', files: ['../layout.tsx'] }]), hasCode('LAYOUT_INVALID'));
});

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-layout 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'src/routes'), { recursive: true });
  await mkdir(join(root, 'src/layouts'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  await writeFile(join(root, 'src/routes/Home.tsx'), 'export default () => null;');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: { routes: [
    { id: 'home', index: true, module: home, source: {} },
    { id: 'bare', path: 'bare', module: home, layout: false, source: {} },
  ] }, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('layout plugin discovers, conflicts and withdraws its global layout', async t => {
  const f = await project(t);
  const plain = await f.host.ctx.application.prepare(f.request); await plain.close();
  assert.doesNotMatch(await f.code(), /layout:global/);

  f.host.mount('layout', layoutPlugin, { id: 'app:layout', files: ['src/layouts/index.tsx'] }); await f.host.ready();
  const missing = await f.host.ctx.application.prepare(f.request); await missing.close();
  assert.doesNotMatch(await f.code(), /layout:global/);
  await writeFile(join(f.root, 'src/layouts/index.tsx'), 'export default () => null;');
  const enabled = await f.host.ctx.application.prepare(f.request); await enabled.close();
  const code = await f.code();
  assert.match(code, /layout:global/); assert.match(code, /\.\.\/src\/layouts\/index\.tsx/);
  const inspection = readInspection(f.root).summary as { layout: { owner: string }, routes: Array<{ id: string, layout?: false }> };
  assert.equal(inspection.layout.owner, 'app:layout');
  assert.equal(inspection.routes.find(route => route.id === 'bare')?.layout, false);

  await writeFile(join(f.root, 'src/layouts/second.tsx'), 'export default () => null;');
  f.host.mount('layout2', layoutPlugin, { id: 'app:layout2', files: ['src/layouts/second.tsx'] }); await f.host.ready();
  await assert.rejects(f.host.ctx.application.prepare(f.request), hasCode('LAYOUT_CONFLICT'));
  await f.host.unmount('layout2');
  const repaired = await f.host.ctx.application.prepare(f.request); await repaired.close(); assert.match(await f.code(), /layout:global/);
  await f.host.unmount('layout');
  const removed = await f.host.ctx.application.prepare(f.request); await removed.close(); assert.doesNotMatch(await f.code(), /layout:global/);
});
