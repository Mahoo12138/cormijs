import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectRuntime, type Plugin } from '@cormijs/core';
import { webPlugin } from '@cormijs/plugin-web';
import { fakeBuilder, fixture, gate, hasCode } from './helpers.js';
import type { Builder } from '@cormijs/builder';

const options = { timeout: 6000 };

test('unchanged Web consumer uses a fake provider and can replace it without core edits', options, async () => {
  const f = await fixture(); const host = new ProjectRuntime(); const calls: string[] = [];
  host.mount('web', webPlugin); host.mount('provider', fakeBuilder('first', calls));
  try {
    await host.ready(); const oldWeb = host.ctx.web;
    assert.equal((await oldWeb.build(f.plan)).backend, 'first');
    await host.unmount('provider');
    await assert.rejects(oldWeb.build(f.plan), hasCode('PLUGIN_INACTIVE'));
    host.mount('provider', fakeBuilder('second', calls)); await host.ready();
    assert.equal((await host.ctx.web.build(f.plan)).backend, 'second');
    assert.deepEqual(calls, ['first', 'second']);
  } finally { await host.dispose(); await f.clean(); }
});

test('unloading only the Web consumer closes its sessions, leaving provider alive', options, async () => {
  const host = new ProjectRuntime(); const f = await fixture(); const closed: string[] = [];
  host.mount('provider', fakeBuilder('fake', [], closed)); host.mount('web', webPlugin);
  try {
    await host.ready(); const handle = await host.ctx.web.dev(f.plan);
    await host.unmount('web'); await handle.close();
    assert.deepEqual(closed, ['fake']); assert.equal(host.inspect()[0]?.state, 'ACTIVE');
  } finally { await host.dispose(); await f.clean(); }
});

test('two providers of the same capability cannot silently override each other', options, async () => {
  const host = new ProjectRuntime();
  host.mount('one', fakeBuilder('first', [])); host.mount('two', fakeBuilder('second', []));
  try { await assert.rejects(host.ready(), hasCode('PLUGIN_FAILED')); }
  finally { await host.dispose(); }
});

test('native backend-specific bridge fails clearly when its backend is absent', options, async () => {
  const host = new ProjectRuntime();
  host.mount('bridge', { name: 'requires-vite', inject: ['vite'], apply: () => {} });
  try { await assert.rejects(host.ready(), hasCode('SERVICE_MISSING')); }
  finally { await host.dispose(); }
});

test('a non-cooperative late session is closed rather than returned after consumer unload', options, async () => {
  const f = await fixture(); const host = new ProjectRuntime(); const entered = gate(); const release = gate(); let closes = 0;
  const provider: Plugin.Object<void> = { apply: ctx => {
    ctx.provide('builder', {
      name: 'slow', dev: async () => { entered.resolve(); await release.promise; return { url: 'http://127.0.0.1:1/', close: async () => { closes++; } }; },
      preview: async () => { throw new Error('not used'); }, build: async p => ({ backend: 'slow', outDir: p.outDir }),
    } satisfies Builder);
  } };
  host.mount('slow', provider); host.mount('web', webPlugin); await host.ready();
  try {
    const starting = host.ctx.web.dev(f.plan);
    const rejected = assert.rejects(starting, hasCode('PLUGIN_INACTIVE'));
    await entered.promise; const stop = host.unmount('web'); release.resolve();
    await Promise.all([rejected, stop]); assert.equal(closes, 1);
  } finally { release.resolve(); await host.dispose(); await f.clean(); }
});
