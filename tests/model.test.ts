import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { modelContributions, modelPlugin, reactPlugin, resolveModels } from '@cormijs/plugin-react';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';
import { hasCode } from './helpers.js';

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-model 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'src/models'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('model discovery derives stable namespaces and rejects invalid or duplicated sources', async t => {
  const f = await project(t);
  await writeFile(join(f.root, 'src/models/user.ts'), 'export default () => ({ name: "user" });');
  await writeFile(join(f.root, 'src/models/admin.user.ts'), 'export default () => ({ admin: true });');
  const plans = await resolveModels(f.root, modelContributions([{ id: 'app:models' }]));
  assert.deepEqual(plans.map(plan => [plan.namespace, plan.module.specifier]), [
    ['admin.user', './src/models/admin.user.ts'],
    ['user', './src/models/user.ts'],
  ]);
  await writeFile(join(f.root, 'src/models/user.model.ts'), 'export default () => ({});');
  await assert.rejects(resolveModels(f.root, modelContributions([{ id: 'app:models' }])), hasCode('MODEL_CONFLICT'));
  assert.throws(() => modelContributions([{ id: 'bad', dir: '../models' }]), hasCode('MODEL_INVALID'));
  assert.throws(() => modelContributions([{ id: 'bad', files: [] }]), hasCode('MODEL_INVALID'));
});

test('model plugin generates imports, type surface and inspection, then withdraws cleanly', async t => {
  const f = await project(t);
  const empty = await f.host.ctx.application.prepare(f.request); await empty.close();
  assert.doesNotMatch(await f.code(), /model0/);
  assert.doesNotMatch(await readFile(join(f.root, '.cormi/routes.d.ts'), 'utf8'), /ModelNamespace/);

  f.host.mount('models', modelPlugin, { id: 'app:models' }); await f.host.ready();
  await writeFile(join(f.root, 'src/models/counter.ts'), 'export default () => ({ count: 0 });');
  const enabled = await f.host.ctx.application.prepare(f.request); await enabled.close();
  const code = await f.code();
  assert.match(code, /import \* as model0 from "\.\.\/src\/models\/counter\.ts"/);
  assert.match(code, /const models = \[\{namespace:"counter",model:model0\["default"\]\}\];/);
  assert.match(code, /plugins,models/);
  assert.match(await readFile(join(f.root, '.cormi/routes.d.ts'), 'utf8'), /export type ModelNamespace = "counter";/);
  const inspection = readInspection(f.root).summary as { models: Array<{ namespace: string, module: { specifier: string } }> };
  assert.deepEqual(inspection.models.map(model => [model.namespace, model.module.specifier]), [['counter', './src/models/counter.ts']]);

  await unlink(join(f.root, 'src/models/counter.ts'));
  const removed = await f.host.ctx.application.prepare(f.request); await removed.close();
  assert.doesNotMatch(await f.code(), /model0/);
  await f.host.unmount('models');
  const off = await f.host.ctx.application.prepare(f.request); await off.close();
  assert.doesNotMatch(await f.code(), /model0/);
});
