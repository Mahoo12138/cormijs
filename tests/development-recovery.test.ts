import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, realpath, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CormiError, ProjectRuntime } from '@cormijs/core';
import { reactPlugin } from '@cormijs/plugin-react';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';
import type { DevelopmentState } from '@cormijs/builder/development';
import { developmentDiagnostic } from '../packages/plugin-react/dist/development.js';
import { fixture, gate, hasCode } from './helpers.js';

async function project() {
  const f = await fixture(), root = await realpath(f.root), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default function Page(){return null}');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'dev', mode: 'development', options: {}, signal: new AbortController().signal };
  return { root, host, request, entry: join(root, '.cormi/app.tsx'), write: (name: string, content: string) => writeFile(join(root, name), content),
    async close() { try { await host.dispose(); } finally { await f.clean(); } } };
}
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 6000;
  while (Date.now() < end) { if (await check()) return; await delay(20); }
  throw new Error('Development state did not converge');
}
const options = { timeout: 12000 };

test('initial route conflict keeps a recoverable compiler without publishing a fake successful generation', options, async () => {
  const f = await project();
  try {
    await f.write('src/pages/index.jsx', 'export default ()=>null');
    const session = await f.host.ctx.application.prepare(f.request);
    assert.equal(session.development?.current().status, 'error'); assert.equal(session.development?.current().hasOutput, false);
    assert.equal(session.development?.current().diagnostic?.code, 'ROUTE_CONFLICT');
    assert.equal(session.snapshot, undefined); assert.equal(existsSync(f.entry), false);
    assert.equal(f.host.ctx.get('builder'), undefined);
    const states: DevelopmentState[] = [], changes: unknown[] = [];
    session.development!.subscribe(async state => { states.push(state); }); session.updates!.subscribe(async files => { changes.push(files); });
    const revision = session.development!.current().revision;
    await delay(500); assert.equal(session.development!.current().revision, revision);
    await unlink(join(f.root, 'src/pages/index.jsx')); await until(() => session.development!.current().status === 'ready');
    assert.equal(session.development!.current().hasOutput, true); await until(() => changes.length === 1);
    assert.ok(await readFile(f.entry, 'utf8')); assert.equal(states.at(-1)?.status, 'ready');
    await session.close();
    const count = states.length; await f.write('src/pages/index.jsx', 'export default ()=>null'); await delay(350);
    assert.equal(states.length, count);
  } finally { await f.close(); }
});
test('startup errors preserve old files but do not label a previous session output as currently valid', options, async () => {
  const f = await project();
  try {
    const first = await f.host.ctx.application.prepare({ ...f.request, command: 'prepare' }); await first.close();
    const before = await readFile(f.entry, 'utf8'), mtime = (await stat(f.entry)).mtimeMs;
    await f.write('src/pages/index.jsx', 'export default ()=>null');
    const second = await f.host.ctx.application.prepare(f.request); assert.equal(second.development!.current().hasOutput, false);
    assert.equal(await readFile(f.entry, 'utf8'), before);
    let invalidations = 0; second.updates!.subscribe(async () => { invalidations++; });
    await unlink(join(f.root, 'src/pages/index.jsx')); await until(() => invalidations === 1);
    assert.equal(second.development!.current().status, 'ready'); assert.equal((await stat(f.entry)).mtimeMs, mtime); await second.close();
  } finally { await f.close(); }
});
test('missing runtime module repair is observed even when the page set has not changed', options, async () => {
  const f = await project();
  try {
    const session = await f.host.ctx.application.prepare({ ...f.request, options: { runtime: [{ id: 'missing', module: { specifier: './src/missing.ts', exportName: 'default' } }] } });
    assert.equal(session.development!.current().status, 'error'); assert.equal(session.development!.current().diagnostic?.code, 'ENOENT');
    await f.write('src/missing.ts', 'export default {};'); await until(() => session.development!.current().status === 'ready');
    assert.match(await readFile(f.entry, 'utf8'), /missing.ts/); await session.close();
  } finally { await f.close(); }
});
test('production and inspection preparation remain strict while generated-file ownership errors are fatal even in dev', options, async () => {
  const f = await project();
  try {
    await f.write('src/pages/index.jsx', 'export default ()=>null');
    for (const command of ['prepare', 'build', 'typecheck'] as const) await assert.rejects(f.host.ctx.application.prepare({ ...f.request, command }), hasCode('ROUTE_CONFLICT'));
    await unlink(join(f.root, 'src/pages/index.jsx')); await mkdir(join(f.root, '.cormi'), { recursive: true });
    await f.write('.cormi/app.tsx', 'USER OWNED');
    await assert.rejects(f.host.ctx.application.prepare(f.request), hasCode('GENERATED_NOT_OWNED'));
    assert.equal(await readFile(f.entry, 'utf8'), 'USER OWNED');
  } finally { await f.close(); }
});
test('fixing a live conflict clears diagnostics without rewriting identical output or invalidating the application', options, async () => {
  const f = await project();
  try {
    const session = await f.host.ctx.application.prepare(f.request), mtime = (await stat(f.entry)).mtimeMs;
    let invalidations = 0; session.updates!.subscribe(async () => { invalidations++; });
    await f.write('src/pages/index.jsx', 'export default ()=>null'); await until(() => session.development!.current().status === 'error');
    assert.equal(session.development!.current().hasOutput, true);
    await unlink(join(f.root, 'src/pages/index.jsx')); await until(() => session.development!.current().status === 'ready');
    assert.equal((await stat(f.entry)).mtimeMs, mtime); assert.equal(invalidations, 0); await session.close();
  } finally { await f.close(); }
});
test('browser diagnostics omit exception messages, causes, absolute roots, private options and traversal paths', () => {
  const secret = 'PRIVATE_TEST_VALUE', root = '/project';
  const d = developmentDiagnostic(new CormiError('HOOK_FAILED', secret, {
    pluginId: 'local:plugin', hookId: 'routes:check', file: '../.env', first: { file: 'src/pages/about.tsx' }, second: { file: '/outside/secret' }, options: { token: secret },
  }, { cause: new Error(secret) }), 'routes', root);
  const text = JSON.stringify(d); assert.doesNotMatch(text, /PRIVATE_TEST_VALUE|outside|\.env|\/project/);
  assert.deepEqual(d.files, ['src/pages/about.tsx']); assert.equal(d.hookId, 'routes:check');
});
test('removing an in-flight failing hook converges to a complete newer generation and ready diagnostic', options, async () => {
  const f = await project(), entered = gate(), release = gate();
  let block = false;
  try {
    const off = f.host.ctx.react.routes.tap({ id: 'slow', owner: 'test', ownerOrder: 0, run: async routes => {
      if (block) { entered.resolve(); await release.promise; throw new Error('obsolete error'); } return routes;
    } });
    const session = await f.host.ctx.application.prepare(f.request); block = true;
    const revision = session.development!.current().revision;
    const states: DevelopmentState[] = []; session.development!.subscribe(async state => { states.push(state); });
    await f.write('src/pages/new.tsx', 'export default ()=>null'); await entered.promise;
    off(); release.resolve();
    // app.tsx is committed before inspect.jsonc and status delivery; disk visibility alone is not readiness.
    await until(() => session.development!.current().status === 'ready' && session.development!.current().revision > revision);
    assert.match(await readFile(f.entry, 'utf8'), /new\.tsx/);
    assert.deepEqual(readInspection(f.root), session.snapshot);
    assert.equal(states.at(-1)?.status, 'ready');
    assert.ok(states.every((state, index) => index === 0 || state.revision > states[index - 1]!.revision));
    await session.close();
    assert.equal(states.at(-1)?.status, 'ready');
  } finally { release.resolve(); await f.close(); }
});
