import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { accessContributions, accessPlugin, appRuntimePlugin, initialStatePlugin, reactPlugin, resolveAccessPlan } from '@cormijs/plugin-react';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

async function project(t: TestContext, options: { withAppConfig: boolean }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-access-convention 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  if (options.withAppConfig) {
    await writeFile(join(root, 'src/app.tsx'), 'import { defineApp } from "@cormijs/runtime"; export default defineApp({ getInitialState: () => ({ role: "admin" }), access: () => ({ fromConfig: true }) });');
  } else {
    await writeFile(join(root, 'src/app.tsx'), 'import { defineApp } from "@cormijs/runtime"; export default defineApp({ getInitialState: () => ({ role: "admin" }) });');
  }
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('access contributions validate candidate lists and ids', async () => {
  assert.deepEqual(accessContributions([{ id: 'app:access', files: ['src/access.ts'] }]), [{ id: 'app:access', files: ['src/access.ts'] }]);
  assert.throws(() => accessContributions([{ id: 'app:access', files: ['src/access.css'] }]), hasCode('ACCESS_INVALID'));
  assert.throws(() => accessContributions([{ id: 'app:access', files: ['../access.ts'] }]), hasCode('ACCESS_INVALID'));
  assert.throws(() => accessContributions([{ id: 'app:access', files: [] }]), hasCode('ACCESS_INVALID'));
  assert.throws(() => accessContributions([{ id: 'a', files: ['src/access.ts'] }, { id: 'a', files: ['src/other.ts'] }]), hasCode('ACCESS_INVALID'));
});

test('resolveAccessPlan is inactive without a file and conflicts on two modules', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-access-resolve 中文-')));
  await mkdir(join(root, 'src'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await resolveAccessPlan(root, accessContributions([{ id: 'a', files: ['src/access.ts', 'src/access.tsx'] }])), undefined);
  await writeFile(join(root, 'src/access.tsx'), 'export default () => ({});');
  const plan = await resolveAccessPlan(root, accessContributions([{ id: 'a', files: ['src/access.ts', 'src/access.tsx'] }]));
  assert.equal(plan?.owner, 'a'); assert.equal(plan?.module.specifier, './src/access.tsx');
  await writeFile(join(root, 'src/other.ts'), 'export default () => ({});');
  await assert.rejects(resolveAccessPlan(root, accessContributions([
    { id: 'a', files: ['src/access.tsx'] }, { id: 'b', files: ['src/other.ts'] },
  ])), hasCode('ACCESS_CONFLICT'));
});

test('the src/access.ts convention feeds the generated app config and can be withdrawn', async t => {
  const f = await project(t, { withAppConfig: false });
  f.host.mount('app', appRuntimePlugin); f.host.mount('initial', initialStatePlugin, { id: 'app:initial' });
  f.host.mount('access', accessPlugin, { id: 'app:access' }); await f.host.ready();

  const before = await f.host.ctx.application.prepare(f.request); await before.close();
  assert.doesNotMatch(await f.code(), /accessConvention/);
  assert.equal((readInspection(f.root).summary as { access: unknown }).access, null);

  await writeFile(join(f.root, 'src/access.ts'), 'export default (state) => ({ canAdmin: (state as { role?: string } | undefined)?.role === "admin" });');
  const after = await f.host.ctx.application.prepare(f.request); await after.close();
  const code = await f.code();
  assert.match(code, /import \* as accessConvention from "\.\.\/src\/access\.ts";/);
  assert.match(code, /appConfig:applyAccessConvention\(resolveAppConfig\(applicationConfig,\["access","accessForbidden","getInitialState"\]\),accessConvention\.default\)/);
  const inspection = readInspection(f.root).summary as { access: { owner: string; module: { specifier: string } } };
  assert.equal(inspection.access.owner, 'app:access');
  assert.equal(inspection.access.module.specifier, './src/access.ts');

  await f.host.unmount('access');
  const removed = await f.host.ctx.application.prepare(f.request); await removed.close();
  assert.doesNotMatch(await f.code(), /accessConvention|accessRuntime/);
  assert.equal((readInspection(f.root).summary as { access: unknown }).access, null);
});

test('an access function in the app configuration module wins over the convention file', async t => {
  const f = await project(t, { withAppConfig: true });
  f.host.mount('app', appRuntimePlugin); f.host.mount('initial', initialStatePlugin, { id: 'app:initial' });
  await writeFile(join(f.root, 'src/access.ts'), 'export default () => ({ fromConvention: true });');
  f.host.mount('access', accessPlugin, { id: 'app:access' }); await f.host.ready();
  const session = await f.host.ctx.application.prepare(f.request); await session.close();
  const code = await f.code();
  assert.match(code, /accessConvention\.default/);
  assert.match(code, /\["access","accessForbidden","getInitialState"\]/);
  // The runtime helper keeps the configured function, so the convention module cannot replace it.
  const { applyAccessConvention } = await import('@cormijs/runtime');
  const configured = { access: () => ({ fromConfig: true }) };
  assert.equal(applyAccessConvention(configured, () => ({ fromConvention: true })).access, configured.access);
  assert.throws(() => applyAccessConvention({}, undefined), /ACCESS_INVALID/);
});
