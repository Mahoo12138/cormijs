import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectRuntime } from '@cormijs/core';
import { applicationCommandsPlugin, type ApplicationRequest, type PreparedApplication } from '@cormijs/plugin-web';
import { commandPlugin } from '../packages/cormi/dist/commands.js';
import { gate, hasCode } from './helpers.js';

function setup(invalidation = true, pause?: ReturnType<typeof gate>) {
  const host = new ProjectRuntime(), timeline: string[] = [], entered = gate();
  let notify: ((files: readonly string[]) => Promise<void>) | undefined;
  host.mount('registry', commandPlugin);
  host.mount('providers', { apply: ctx => {
    ctx.provide('application', { async prepare(request: ApplicationRequest): Promise<PreparedApplication> {
      timeline.push('prepare'); entered.resolve(); await pause?.promise;
      return { plan: { root: request.root, entry: 'index.html', outDir: 'dist', base: '/', mode: request.mode }, snapshot: {},
        updates: { files: ['.cormi/app.tsx'], subscribe(listener) { notify = listener; return () => { timeline.push('unsubscribe'); notify = undefined; }; } },
        async close() { timeline.push('prepared:closed'); } };
    } });
    const open = async () => {
      timeline.push('server:opened');
      return { url: 'http://127.0.0.1:1/', async close() { timeline.push('server:closed'); },
        ...(invalidation ? { async invalidate(files: readonly string[]) { timeline.push('invalidate:' + files.join(',')); } } : {}) };
    };
    ctx.provide('web', { dev: open, preview: open, async build() { return { backend: 'fake', outDir: 'dist' }; } });
  } });
  host.mount('application-commands', applicationCommandsPlugin);
  const request = { root: '/project', mode: 'test', options: {}, signal: new AbortController().signal };
  return { host, timeline, entered, request, async notify() { await notify?.(['.cormi/app.tsx']); } };
}

test('application command unload removes invalidation subscriptions and closes owned sessions without unloading providers', async () => {
  const f = setup();
  try {
    await f.host.ready(); const result = await f.host.ctx.commands.execute('dev', f.request); assert.equal(result.kind, 'server');
    await f.notify(); await f.host.unmount('application-commands');
    assert.deepEqual(f.timeline, ['prepare', 'server:opened', 'invalidate:.cormi/app.tsx', 'invalidate:.cormi/app.tsx', 'unsubscribe', 'prepared:closed', 'server:closed']);
    assert.ok(f.host.ctx.get('web')); assert.deepEqual(f.host.ctx.commands.names(), []);
    if (result.kind === 'server') await result.handle.close();
    assert.equal(f.timeline.filter(x => x === 'server:closed').length, 1);
  } finally { await f.host.dispose(); }
});
test('generated development applications reject backends without invalidation and release provisional resources', async () => {
  const f = setup(false);
  try {
    await f.host.ready(); await assert.rejects(f.host.ctx.commands.execute('dev', f.request), hasCode('BUILDER_INVALIDATION_UNSUPPORTED'));
    assert.deepEqual(f.timeline, ['prepare', 'server:opened', 'prepared:closed', 'server:closed']);
  } finally { await f.host.dispose(); }
});
test('command unload during noncooperative preparation closes the late compiler session without starting a server', async () => {
  const release = gate(), f = setup(true, release);
  try {
    await f.host.ready(); const task = f.host.ctx.commands.execute('dev', f.request); const rejected = assert.rejects(task);
    await f.entered.promise; const stopping = f.host.unmount('application-commands'); release.resolve();
    await Promise.all([rejected, stopping]); assert.deepEqual(f.timeline, ['prepare', 'prepared:closed']);
  } finally { release.resolve(); await f.host.dispose(); }
});
