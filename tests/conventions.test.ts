import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { routesFromFiles } from '@cormijs/routes';
import { loadingContributions, loadingPlugin, reactPlugin } from '@cormijs/plugin-react';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';
import { hasCode } from './helpers.js';

test('root convention 404 becomes a terminal catch-all; nested 404 stays a normal page', () => {
  const routes = routesFromFiles(['src/pages/index.tsx', 'src/pages/about.tsx', 'src/pages/404.tsx', 'src/pages/docs/404.tsx']);
  const byId = new Map(routes.map(route => [route.id, route]));
  assert.equal(byId.get('file:src/pages/404.tsx')?.path, '*');
  assert.equal(byId.get('file:src/pages/404.tsx')?.index, undefined);
  assert.equal(byId.get('file:src/pages/docs/404.tsx')?.path, 'docs/404');
  assert.throws(() => routesFromFiles(['src/pages/404.tsx', 'src/pages/[...rest].tsx']), hasCode('ROUTE_CONFLICT'));
  assert.throws(() => loadingContributions([{ id: 'bad', files: [] }]), hasCode('LOADING_INVALID'));
  assert.throws(() => loadingContributions([{ id: 'bad', files: ['../loading.tsx'] }]), hasCode('LOADING_INVALID'));
});

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-loading 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('loading plugin activates one source, reports conflicts and withdraws with its owner', async t => {
  const f = await project(t);
  const plain = await f.host.ctx.application.prepare(f.request); await plain.close(); assert.doesNotMatch(await f.code(), /applicationLoading/);

  f.host.mount('loading', loadingPlugin, { id: 'app:loading', files: ['src/loading.tsx'] }); await f.host.ready();
  const missing = await f.host.ctx.application.prepare(f.request); await missing.close(); assert.doesNotMatch(await f.code(), /applicationLoading/);
  await writeFile(join(f.root, 'src/loading.tsx'), 'export default () => null;');
  const enabled = await f.host.ctx.application.prepare(f.request); await enabled.close();
  const code = await f.code();
  assert.match(code, /import \* as applicationLoading/); assert.match(code, /loading:applicationLoading\["default"\]/);
  const inspection = readInspection(f.root).summary as { loading: { owner: string } };
  assert.equal(inspection.loading.owner, 'app:loading');

  await writeFile(join(f.root, 'src/loading.second.tsx'), 'export default () => null;');
  f.host.mount('loading2', loadingPlugin, { id: 'app:loading2', files: ['src/loading.second.tsx'] }); await f.host.ready();
  await assert.rejects(f.host.ctx.application.prepare(f.request), hasCode('LOADING_CONFLICT'));
  await f.host.unmount('loading2');
  const repaired = await f.host.ctx.application.prepare(f.request); await repaired.close(); assert.match(await f.code(), /applicationLoading/);
  await f.host.unmount('loading');
  const removed = await f.host.ctx.application.prepare(f.request); await removed.close(); assert.doesNotMatch(await f.code(), /applicationLoading/);
});
