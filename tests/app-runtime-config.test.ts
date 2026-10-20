import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { defineApp, resolveAppConfig, runAppRender, copyClientRoutes, APP_RUNTIME_KEYS, type RuntimeConfig } from '../packages/runtime/src/app-config.js';
import { APP_RUNTIME_KEYS as nodeKeys } from '../packages/plugin-react/src/app-runtime.js';
import { gate } from './helpers.js';

test('named, default and synchronous defineApp factories resolve once without a mutable module singleton', () => {
  let calls = 0; const fn = () => {}; const value = { setup: fn };
  const factory = defineApp(() => { calls++; return value; });
  assert.equal(calls, 0); const config = resolveAppConfig({ default: factory });
  assert.equal(calls, 1); assert.equal(config.setup, fn); assert.ok(Object.isFrozen(config)); assert.notEqual(config, value);
  assert.equal(resolveAppConfig(value).setup, fn); assert.equal(resolveAppConfig({ default: defineApp(value) }).setup, fn);
  assert.deepEqual(APP_RUNTIME_KEYS, nodeKeys);
});
test('unknown, mixed and invalid runtime exports fail instead of silently dropping configuration', () => {
  const unchecked = resolveAppConfig as (module: unknown, keys?: readonly string[]) => Readonly<RuntimeConfig>;
  assert.throws(() => unchecked({ default: {}, setup() {} }), /APP_RUNTIME_MIXED_EXPORTS/);
  assert.throws(() => unchecked({ typo: true }), /APP_RUNTIME_UNKNOWN_KEY/);
  assert.throws(() => unchecked({ rootContainer: 42 }), /APP_RUNTIME_INVALID/);
  assert.throws(() => unchecked({ default: () => null }), /APP_RUNTIME_INVALID/);
  assert.throws(() => unchecked({ default: async () => { throw new Error('observed rejection'); } }), /must be synchronous/);
  assert.deepEqual(unchecked({ banner: 'hello' }, ['banner']), { banner: 'hello' });
  for (const keys of [['setup'], ['banner','banner'], ['__proto__']]) assert.throws(() => unchecked({}, keys), /APP_RUNTIME_KEY_CONFLICT/);
});
test('render callback can defer first render and cannot render twice or after its scope ends', async () => {
  let next!: () => Promise<void>, calls = 0, finished = false;
  const task = runAppRender(callback => { next = callback; }, { signal: new AbortController().signal, basename: '/' }, async () => { calls++; });
  void task.then(() => { finished = true; }); await immediate();
  assert.equal(calls, 0); assert.equal(finished, false);
  const rendering = next(); assert.throws(next, /APP_RENDER_NEXT_INVALID/); await rendering; await task;
  assert.equal(calls, 1); assert.throws(next, /APP_RENDER_NEXT_INVALID/);
});
test('async render preserves before-render-after sequence and original failures', async () => {
  const trace: string[] = [], context = { signal: new AbortController().signal, basename: '/site/' };
  await runAppRender(async next => { trace.push('before'); await next(); trace.push('after'); }, context, async () => { trace.push('render'); });
  assert.deepEqual(trace, ['before','render','after']);
  const original = new Error('original');
  await assert.rejects(runAppRender(() => { throw original; }, context, async () => { throw new Error('not entered'); }), error => error === original);
  await assert.rejects(runAppRender(undefined, context, async () => { throw original; }), error => error === original);
});
test('cancelling a deferred continuation forbids late render and entered render is drained', async () => {
  const controller = new AbortController(); let next!: () => Promise<void>;
  const pending = runAppRender(callback => { next = callback; }, { signal: controller.signal, basename: '/' }, async () => { throw new Error('must not render'); });
  const failed = assert.rejects(pending, /cancel-before-next/); controller.abort(new Error('cancel-before-next')); await failed;
  assert.throws(next, /APP_RENDER_NEXT_INVALID/);
  const active = new AbortController(), entered = gate(), release = gate(); let finished = false;
  const task = runAppRender(undefined, { signal: active.signal, basename: '/' }, async () => { entered.resolve(); await release.promise; });
  const rejected = assert.rejects(task, /cancel-active/).then(() => { finished = true; });
  await entered.promise; active.abort(new Error('cancel-active')); await immediate(); assert.equal(finished, false);
  release.resolve(); await rejected;
});
test('pre-render route copies isolate structural changes and reject cyclic children', () => {
  const source = [{ id: 'parent', path: '', children: [{ id: 'child', path: 'a' }] }];
  const copy = copyClientRoutes(source); copy[0]!.children![0]!.path = 'b';
  assert.equal(source[0]!.children[0]!.path, 'a');
  const cycle: typeof source = []; cycle.push({ id:'cycle', path:'', children: cycle });
  assert.throws(() => copyClientRoutes(cycle), /APP_ROUTES_INVALID/);
});
