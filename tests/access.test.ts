import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { accessPlugin, appRuntimePlugin, initialStatePlugin, reactPlugin } from '@cormijs/plugin-react';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-access 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  await writeFile(join(root, 'src/app.tsx'), 'import { defineApp } from "@cormijs/runtime"; export default defineApp({ getInitialState: () => ({ role: "admin" }), access: (state) => ({ canAdmin: (state as {role:string}).role === "admin" }) });');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('access plugin contributes its key and ordered provider, then withdraws', async t => {
  const f = await project(t);
  f.host.mount('app', appRuntimePlugin); f.host.mount('initial', initialStatePlugin, { id: 'app:initial' });
  f.host.mount('access', accessPlugin, { id: 'app:access' }); await f.host.ready();
  const session = await f.host.ctx.application.prepare(f.request); await session.close();
  const code = await f.code();
  assert.match(code, /accessRuntime/); assert.match(code, /\["access"/);
  const inspection = readInspection(f.root).summary as { appRuntime: { keys: string[] }, runtime: Array<{ id: string }> };
  assert.ok(inspection.appRuntime.keys.includes('access'));
  assert.ok(inspection.runtime.some(item => item.id === 'app:access'));
  await f.host.unmount('access');
  const removed = await f.host.ctx.application.prepare(f.request); await removed.close();
  assert.doesNotMatch(await f.code(), /accessRuntime/);
});

test('invalid access plugin options fail plugin activation', async t => {
  const f = await project(t);
  f.host.mount('bad', accessPlugin, { id: 42 } as never);
  await assert.rejects(f.host.ready(), (error: any) => error?.code === 'PLUGIN_FAILED' && error?.cause?.code === 'ACCESS_INVALID');
});
