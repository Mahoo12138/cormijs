import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { reactPlugin } from '@cormijs/plugin-react';
import { expandRouteConfig, validateRoutes } from '@cormijs/routes';
import type { ApplicationRequest } from '@cormijs/plugin-web';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('clientLoader is validated in the flat IR and the nested configuration', async () => {
  const module = { specifier: './src/pages/index.tsx', exportName: 'default' };
  assert.equal(validateRoutes([{ id: 'home', index: true, module, clientLoader: 'clientLoader', source: {} }])[0]?.clientLoader, 'clientLoader');
  assert.equal(validateRoutes([{ id: 'home', index: true, module, clientLoader: 'load', source: {} }])[0]?.clientLoader, 'load');
  assert.throws(() => validateRoutes([{ id: 'home', index: true, module, clientLoader: '2bad', source: {} }]), hasCode('ROUTE_CLIENT_LOADER_INVALID'));
  assert.throws(() => validateRoutes([{ id: 'home', index: true, module, clientLoader: { nested: 1 }, source: {} }]), hasCode('ROUTE_CLIENT_LOADER_INVALID'));
  assert.throws(() => validateRoutes([{ id: 'home', index: true, clientLoader: 'clientLoader', source: {} }]), hasCode('ROUTE_CLIENT_LOADER_INVALID'));

  const routes = expandRouteConfig([{ path: 'about', component: './src/About.tsx', clientLoader: 'loadAbout' }]);
  assert.equal(routes.find(route => route.id === 'config:about')?.clientLoader, 'loadAbout');
  assert.throws(() => expandRouteConfig([{ path: 'about', clientLoader: 'loadAbout' }]), hasCode('ROUTE_CLIENT_LOADER_INVALID'));
  assert.throws(() => expandRouteConfig([{ path: 'about', redirect: '/home', clientLoader: 'loadAbout' }]), hasCode('ROUTE_CLIENT_LOADER_INVALID'));
  assert.throws(() => expandRouteConfig([{ path: 'about', component: './src/About.tsx', clientLoade: 'typo' }]), hasCode('ROUTE_CONFIG_INVALID'));
});

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-client-loader 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages/member'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/member/[id].tsx'), 'export default function Member(){return null;}\nexport async function clientLoader({ params }) { return { id: params.id }; }');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default function Home(){return null;}');
  host.mount('react', reactPlugin); await host.ready();
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8'),
    request: (options: Record<string, unknown>): ApplicationRequest => ({ root, command: 'prepare', mode: 'test', options, signal: new AbortController().signal }) };
}

test('the generated entry binds the page clientLoader as the route loader', async t => {
  const f = await project(t);
  const session = await f.host.ctx.application.prepare(f.request({ routes: [
    { id: 'member', path: 'member/:id', module: { specifier: './src/pages/member/[id].tsx', exportName: 'default' }, clientLoader: 'clientLoader', source: {} },
  ] }));
  await session.close();
  const code = await f.code();
  assert.match(code, /import \{ mountApplication, resolveRouteComponent, type RuntimeEntry, clientLoaderOf \} from '@cormijs\/runtime';/);
  assert.match(code, /loader:clientLoaderOf\(page,"clientLoader","member"\)/);
  assert.equal((code.match(/await import\("\.\.\/src\/pages\/member\/\[id\]\.tsx"\)/g) ?? []).length, 1, 'the page module is resolved once per route');

  const plain = await f.host.ctx.application.prepare(f.request({ routes: [
    { id: 'home', index: true, module: { specifier: './src/pages/index.tsx', exportName: 'default' }, source: {} },
  ] }));
  await plain.close();
  assert.doesNotMatch(await f.code(), /clientLoaderOf/);
});
