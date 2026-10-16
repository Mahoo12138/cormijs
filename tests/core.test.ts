import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Context, ProjectRuntime, isActive, type Plugin } from '@cormijs/core';
import { assertPortFree, close, fixture, gate, hasCause, hasCode, listen } from './helpers.js';

const options = { timeout: 8000 };

test('parent waiting for a child that injects its unpublished service times out with a dependency diagnostic', options, async () => {
  const host = new ProjectRuntime(60); const entered = gate(); const release = gate(); let childRan = false;
  host.mount('parent', { name:'parent', apply: async ctx => {
    ctx.provide('late-resource', {});
    ctx.plugin({ name:'dependent-child', inject:['late-resource'], apply: () => { childRan = true; release.resolve(); } });
    entered.resolve(); await release.promise;
  } });
  try {
    await entered.promise;
    await assert.rejects(host.ready(), error => hasCode('PLUGIN_NOT_READY')(error)
      && JSON.stringify((error as {details:unknown}).details).includes('late-resource'));
    assert.equal(childRan, false);
  } finally {
    // Release the deliberately non-cooperative fixture; a timeout is not cancellation.
    release.resolve(); await host.dispose();
  }
});

test('empty host is usable without any application provider and becomes terminal after dispose', options, async () => {
  const host = new ProjectRuntime();
  await host.ready();
  await Promise.all([host.dispose(), host.dispose()]);
  assert.throws(() => host.mount('late', () => {}), hasCode('HOST_CLOSED'));
  await assert.rejects(host.ready(), hasCode('HOST_CLOSED'));
});

test('consumer registered before asynchronous provider activates exactly once', options, async () => {
  const host = new ProjectRuntime(); const start = gate(); let calls = 0;
  host.mount('consumer', { name: 'consumer', inject: ['answer'], apply: ctx => {
    assert.equal(ctx.get('answer').value, 42); calls++;
  } });
  host.mount('provider', { name: 'provider', apply: async ctx => {
    await start.promise; ctx.provide('answer', { value: 42 });
  } });
  try {
    const ready = host.ready();
    await delay(10); assert.equal(calls, 0); start.resolve();
    await ready; assert.equal(calls, 1);
    assert.ok(host.inspect().every(item => item.state === 'ACTIVE'));
  } finally { start.resolve(); await host.dispose(); }
});

test('native await of a pending plugin is not a host readiness barrier', options, async () => {
  const ctx = new Context(); let applied = false;
  const fiber = await ctx.plugin({ inject: ['absent'], apply: () => { applied = true; } });
  assert.equal(applied, false); assert.equal(isActive(fiber), false);
  await ctx.fiber.dispose();
  const host = new ProjectRuntime();
  host.mount('missing', { inject: ['absent'], apply: () => {} });
  try { await assert.rejects(host.ready(), hasCode('SERVICE_MISSING')); }
  finally { await host.dispose(); }
});

test('initialization rejection retains the original cause and cannot report ready', options, async () => {
  const host = new ProjectRuntime(); const cause = new Error('provider initialization failed');
  host.mount('broken', { name: 'broken', apply: async () => { await delay(2); throw cause; } });
  try {
    await assert.rejects(host.ready(), error => hasCode('PLUGIN_FAILED')(error) && hasCause(error, cause));
  } finally { await host.dispose(); }
});

test('nested native plugins participate in required readiness', options, async () => {
  const host = new ProjectRuntime();
  host.mount('parent', { name: 'parent', apply: ctx => {
    ctx.plugin({ name: 'child', inject: ['absent'], apply: () => {} });
  } });
  try { await assert.rejects(host.ready(), hasCode('SERVICE_MISSING')); }
  finally { await host.dispose(); }
});

test('duplicate stable IDs are rejected before mounting a second instance', options, async () => {
  const host = new ProjectRuntime(); let applies = 0;
  try {
    host.mount('same', () => { applies++; });
    assert.throws(() => host.mount('same', () => { applies++; }), hasCode('PLUGIN_ID_CONFLICT'));
    await host.ready(); assert.equal(applies, 1);
  } finally { await host.dispose(); }
});

test('disposal during asynchronous initialization drains and rejects late use', options, async () => {
  const host = new ProjectRuntime(); const entered = gate(); const release = gate(); let cleaned = false;
  const fiber = host.mount('slow', { apply: async ctx => {
    ctx.effect(() => () => { cleaned = true; }); entered.resolve(); await release.promise;
  } });
  await entered.promise;
  const disposing = host.dispose();
  release.resolve(); await disposing;
  assert.equal(cleaned, true); assert.equal(fiber.uid, null); assert.equal(isActive(fiber), false);
  assert.equal(host.inspect()[0]?.state, 'DISPOSED');
});

test('initialization deadline is bounded; releasing the test gate allows real cleanup', options, async () => {
  const host = new ProjectRuntime(30); const release = gate();
  host.mount('never-ready', { apply: async () => { await release.promise; } });
  try { await assert.rejects(host.ready(), hasCode('PLUGIN_NOT_READY')); }
  finally { release.resolve(); await host.dispose(); }
});

test('provider remains usable while consumer teardown drains', options, async () => {
  const host = new ProjectRuntime(); const release = gate(); const entered = gate(); const timeline: string[] = [];
  host.mount('provider', { name: 'resource', apply: ctx => {
    ctx.provide('resource', { read: () => timeline.push('read') });
    ctx.effect(() => () => { timeline.push('provider-closed'); });
  } });
  host.mount('consumer', { name: 'reader', inject: ['resource'], apply: ctx => {
    const injected = ctx as Context & { resource: { read(): void } };
    ctx.effect(() => async () => {
      entered.resolve(); await release.promise;
      // get() is an ACTIVE-only lookup; property access retains the injected binding during teardown.
      assert.equal(ctx.get('resource'), undefined);
      injected.resource.read(); timeline.push('consumer-closed');
    });
  } });
  await host.ready();
  const stopping = host.unmount('provider');
  try {
    await entered.promise; assert.deepEqual(timeline, []); release.resolve(); await stopping;
    assert.deepEqual(timeline, ['read', 'consumer-closed', 'provider-closed']);
  } finally { release.resolve(); await host.dispose(); }
});

test('one failing disposer does not omit other cleanup and host reports failure', options, async () => {
  const host = new ProjectRuntime(); const cause = new Error('cleanup injection'); let second = false;
  host.mount('cleanup', { apply: ctx => {
    ctx.effect(() => () => { throw cause; });
    ctx.effect(() => async () => { await delay(5); second = true; });
  } });
  await host.ready();
  await assert.rejects(host.dispose(), error => hasCode('CLEANUP_INCOMPLETE')(error) && hasCause(error, cause));
  assert.equal(second, true);
});

test('cleanup timeout is not claimed as cancellation; late task is explicitly drained', options, async () => {
  const host = new ProjectRuntime(25); const release = gate(); let cleaned = false;
  const fiber = host.mount('slow-close', { apply: ctx => {
    ctx.effect(() => async () => { await release.promise; cleaned = true; });
  } });
  await host.ready();
  try { await assert.rejects(host.dispose(), hasCode('CLEANUP_INCOMPLETE')); assert.equal(cleaned, false); }
  finally { release.resolve(); await fiber.await(); }
  assert.equal(cleaned, true);
});

test('independent hosts never share a service instance', options, async () => {
  const a = new ProjectRuntime(); const b = new ProjectRuntime();
  a.mount('value', ctx => { ctx.provide('value', { name: 'a' }); });
  b.mount('value', ctx => { ctx.provide('value', { name: 'b' }); });
  try { await Promise.all([a.ready(), b.ready()]); assert.equal(a.ctx.get('value').name, 'a'); assert.equal(b.ctx.get('value').name, 'b'); }
  finally { await Promise.all([a.dispose(), b.dispose()]); }
});

test('real watcher and TCP listener are released by plugin teardown', options, async () => {
  const f = await fixture(); const host = new ProjectRuntime(); const server = createServer(); let count = 0;
  let port = 0; const changed = gate();
  const plugin: Plugin.Object<void> = { apply: async ctx => {
    const watcher = watch(f.root, () => { count++; changed.resolve(); });
    ctx.effect(() => () => watcher.close());
    port = await listen(server);
    ctx.effect(() => () => close(server));
  } };
  host.mount('io', plugin);
  try {
    await host.ready(); await writeFile(join(f.root, 'watched'), 'first');
    await changed.promise; await host.dispose(); const after = count;
    await writeFile(join(f.root, 'watched'), 'second'); await delay(30);
    assert.equal(count, after); await assertPortFree(port);
  } finally { await host.dispose(); await f.clean(); }
});
