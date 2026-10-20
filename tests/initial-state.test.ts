import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { appRuntimePlugin, initialStatePlugin, reactPlugin } from '@cormijs/plugin-react';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-initial-state 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  await writeFile(join(root, 'src/app.tsx'), 'import { defineApp } from "@cormijs/runtime"; export default defineApp({ getInitialState: async () => ({ user: "Ada" }) });');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('initial-state plugin contributes the runtime provider and getInitialState key', async t => {
  const f = await project(t);
  f.host.mount('app', appRuntimePlugin); f.host.mount('initial', initialStatePlugin, { id: 'app:initial' }); await f.host.ready();
  const session = await f.host.ctx.application.prepare(f.request); await session.close();
  const code = await f.code();
  assert.match(code, /initialStateRuntime/);
  assert.match(code, /@cormijs\/runtime/);
  assert.match(code, /"getInitialState"/);
  const inspection = readInspection(f.root).summary as { appRuntime: { keys: string[] }, runtime: Array<{ id: string }> };
  assert.ok(inspection.appRuntime.keys.includes('getInitialState'));
  assert.ok(inspection.runtime.some(item => item.id === 'app:initial'));
});

test('invalid initial-state options fail plugin activation', async t => {
  const f = await project(t);
  f.host.mount('bad', initialStatePlugin, { id: 42 } as never);
  await assert.rejects(f.host.ready(), (error: any) => error?.code === 'PLUGIN_FAILED' && error?.cause?.code === 'INITIAL_STATE_INVALID');
});

test('withdrawal removes the initial-state contribution', async t => {
  const f = await project(t);
  f.host.mount('app', appRuntimePlugin); f.host.mount('initial', initialStatePlugin, { id: 'app:initial' }); await f.host.ready();
  await f.host.unmount('initial');
  const session = await f.host.ctx.application.prepare(f.request); await session.close();
  assert.doesNotMatch(await f.code(), /initialStateRuntime/);
});
