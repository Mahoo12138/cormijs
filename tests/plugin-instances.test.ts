import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import ts from 'typescript';
import { ProjectRuntime, DiagnosticService, type Plugin } from '@cormijs/core';
import { reactPlugin, runtimeContributions } from '@cormijs/plugin-react';
import { validateRoutes, type RouteRecord } from '@cormijs/routes';
import { DevApiService } from '@cormijs/plugin-dev-api/service';
import { pluginTemplateFiles } from '../packages/create/src/plugin-template.js';
import { listen, close, hasCode } from './helpers.js';

const bounds = { timeout: 10000 };
const defaults = { development: true, label: 'Default', apiBase: '/api' };
async function fixture(t: TestContext, name = '@example/instances') {
  const cache = resolve('.cache'); await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, 'instance-unit-'));
  // Unit test only: transpilations resolve workspace SDKs. Real tgz consumption is a separate test.
  const files = pluginTemplateFiles(name);
  for (const file of ['index', 'api']) await writeFile(join(directory, file + '.js'), ts.transpileModule(files['src/' + file + '.ts']!, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  const plugin: Plugin.Object<Record<string, unknown>> = (await import(pathToFileURL(join(directory, 'index.js')).href)).default;
  const host = new ProjectRuntime(); host.mount('diagnostics', DiagnosticService); await host.ready();
  host.mount('react', reactPlugin); host.mount('api', DevApiService); await host.ready();
  const handle = host.ctx.devApi.open();
  const server = createServer((req, res) => handle.middleware(req, res, () => { res.statusCode = 418; res.end(); }));
  const port = await listen(server);
  t.after(async () => { try { await handle.close(); await host.dispose(); } finally { await close(server); await rm(directory, { recursive: true, force: true }); } });
  const routes = async () => validateRoutes(await host.ctx.react.routes.reduce([], (value): value is readonly RouteRecord[] => Array.isArray(value)));
  const runtimes = async () => runtimeContributions(await host.ctx.react.runtime.collect(undefined));
  return { host, plugin, routes, runtimes, url: `http://127.0.0.1:${port}` };
}

test('the existing single-instance author options retain their page and API paths', bounds, async t => {
  const f = await fixture(t); f.host.mount('default', f.plugin, defaults); await f.host.ready();
  assert.deepEqual((await f.routes()).map(r => r.path), ['plugin']);
  assert.deepEqual(await (await fetch(f.url + '/api/hello')).json(), { message: 'Hello, Default!' });
});

test('one native plugin object supports two instances with separate route runtime and API identities', bounds, async t => {
  const f = await fixture(t);
  const a = f.host.mount('alpha', f.plugin, { ...defaults, instance: 'alpha', label: 'Alpha' });
  const b = f.host.mount('beta', f.plugin, { ...defaults, instance: 'beta', label: 'Beta' });
  await f.host.ready();
  assert.notEqual(a.uid, b.uid); assert.equal(f.host.ctx.registry.get(f.plugin)?.fibers.length, 2);
  const routes = await f.routes(), runtime = await f.runtimes();
  assert.deepEqual(routes.map(r => r.path), ['plugin/alpha', 'plugin/beta']);
  assert.equal(new Set(routes.map(r => r.id)).size, 2); assert.equal(new Set(runtime.map(r => r.id)).size, 2);
  assert.deepEqual(await (await fetch(f.url + '/api/alpha/hello')).json(), { message: 'Hello, Alpha!' });
  assert.deepEqual(await (await fetch(f.url + '/api/beta/hello')).json(), { message: 'Hello, Beta!' });
  const betaBefore = { uid: b.uid, route: routes[1], runtime: runtime[1] };
  await f.host.unmount('alpha'); await f.host.ready();
  assert.equal((await fetch(f.url + '/api/alpha/hello')).status, 404);
  assert.equal(b.uid, betaBefore.uid); assert.deepEqual(await f.routes(), [betaBefore.route]);
  assert.deepEqual(await f.runtimes(), [betaBefore.runtime]);
  assert.deepEqual(await (await fetch(f.url + '/api/beta/hello')).json(), { message: 'Hello, Beta!' });
  f.host.mount('alpha-replacement', f.plugin, { ...defaults, instance: 'alpha', label: 'New Alpha' }); await f.host.ready();
  await a.dispose();
  assert.deepEqual(await (await fetch(f.url + '/api/alpha/hello')).json(), { message: 'Hello, New Alpha!' });
  assert.equal(b.uid, betaBefore.uid);
  const section = f.host.ctx.diagnostics.snapshot().find(s => s.id === 'dev-api')!;
  const owners = section.records.filter(r => r.kind === 'api-contribution').map(r => r.ownerUid);
  assert.equal(new Set(owners).size, 2);
});

test('a duplicate instance fails without replacing the existing instance and can be removed independently', bounds, async t => {
  const f = await fixture(t); f.host.mount('original', f.plugin, { ...defaults, instance: 'same', label: 'Original' }); await f.host.ready();
  const routes = await f.routes(), runtime = await f.runtimes();
  f.host.mount('duplicate', f.plugin, { ...defaults, instance: 'same', label: 'Unexpected' });
  await assert.rejects(f.host.ready(), hasCode('PLUGIN_FAILED'));
  assert.deepEqual(await (await fetch(f.url + '/api/same/hello')).json(), { message: 'Hello, Original!' });
  await f.host.unmount('duplicate'); await f.host.ready();
  assert.deepEqual(await f.routes(), routes); assert.deepEqual(await f.runtimes(), runtime);
});

test('different identities cannot bypass API path conflict protection', bounds, async t => {
  const f = await fixture(t); f.host.mount('a', f.plugin, { ...defaults, instance: 'a', label: 'A', apiPath: '/shared' }); await f.host.ready();
  f.host.mount('b', f.plugin, { ...defaults, instance: 'b', label: 'B', apiPath: '/shared' });
  await assert.rejects(f.host.ready(), hasCode('PLUGIN_FAILED'));
  assert.deepEqual(await (await fetch(f.url + '/api/shared')).json(), { message: 'Hello, A!' });
  await f.host.unmount('b'); await f.host.ready(); assert.equal((await f.runtimes()).length, 1);
});

test('different instance IDs still reject equivalent URL paths instead of overwriting a page', bounds, async t => {
  const f = await fixture(t);
  f.host.mount('a', f.plugin, { ...defaults, instance: 'a', routePath: 'shared' });
  f.host.mount('b', f.plugin, { ...defaults, instance: 'b', routePath: 'SHARED' }); await f.host.ready();
  await assert.rejects(f.routes(), hasCode('ROUTE_CONFLICT'));
  await f.host.unmount('b'); await f.host.ready(); assert.deepEqual((await f.routes()).map(r => r.path), ['shared']);
});

test('template instance options reject malformed paths and accept explicit namespaces', bounds, async t => {
  const f = await fixture(t), schema = f.plugin.Config!['~standard'];
  for (const patch of [{ instance: '' }, { instance: 'a:b' }, { instance: ['a'] }, { routePath: '../x' }, { routePath: '/x' },
    { routePath: 'x/' }, { apiPath: '//x' }, { apiPath: '/x/../y' }, { apiPath: '/x?x=1' }, { apiPath: ['/x'] }]) {
    assert.ok((await schema.validate({ ...defaults, ...patch })).issues, JSON.stringify(patch));
  }
  const valid = await schema.validate({ ...defaults, instance: 'alpha', routePath: 'tools/alpha', apiPath: '/tools/alpha' });
  assert.equal(valid.issues, undefined);
});

test('a supported 100-character package name activates the default instance without truncating IDs', bounds, async t => {
  const name = '@' + 's'.repeat(40) + '/' + 'n'.repeat(58); assert.equal(name.length, 100);
  const f = await fixture(t, name); f.host.mount('long-package', f.plugin, defaults); await f.host.ready();
  const runtime = (await f.runtimes())[0]!;
  assert.equal(runtime.id, 'plugin:' + name.slice(1).replace('/', '.') + ':default:runtime');
  assert.ok(runtime.id.length <= 128);
  assert.deepEqual(await (await fetch(f.url + '/api/hello')).json(), { message: 'Hello, Default!' });
  const result = await f.plugin.Config!['~standard'].validate({ ...defaults, instance: 'a'.repeat(14) });
  assert.ok(result.issues, 'Long combined namespace must not be silently shortened');
});