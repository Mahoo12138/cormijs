import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderedHooks } from '@cormijs/plugin-web';
import { gate, hasCode, hasCause } from './helpers.js';

const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(x => typeof x === 'string');
const options = { timeout: 3000 };

test('explicit hook edges override stage and owner order deterministically', options, async () => {
  for (const reverse of [false, true]) {
    const hooks = new OrderedHooks<string[], string[]>('routes');
    const list = [
      { id: 'a', owner: 'a', ownerOrder: 0, stage: 10, before: ['b'], run: (v: string[]) => [...v, 'a'] },
      { id: 'b', owner: 'b', ownerOrder: 1, stage: -10, run: async (v: string[]) => [...v, 'b'] },
    ];
    for (const hook of reverse ? list.reverse() : list) hooks.tap(hook);
    assert.deepEqual(await hooks.reduce([], stringArray), ['a', 'b']);
  }
});

test('duplicate hook IDs and missing order targets are diagnosed', options, () => {
  const hooks = new OrderedHooks<void, void>('check');
  const hook = { id: 'a', owner: 'p', ownerOrder: 0, before: ['absent'], run: () => {} };
  hooks.tap(hook);
  assert.throws(() => hooks.tap(hook), hasCode('HOOK_ID_CONFLICT'));
  assert.throws(() => hooks.snapshot(), hasCode('HOOK_TARGET_MISSING'));
});

test('hook order cycles are rejected instead of using registration order', options, () => {
  const hooks = new OrderedHooks<void, void>('check');
  hooks.tap({ id: 'a', owner: 'p', ownerOrder: 0, after: ['b'], run: () => {} });
  hooks.tap({ id: 'b', owner: 'p', ownerOrder: 1, after: ['a'], run: () => {} });
  assert.throws(() => hooks.snapshot(), hasCode('HOOK_ORDER_CYCLE'));
});

test('an in-flight snapshot is unchanged by unregister/register during await', options, async () => {
  const hooks = new OrderedHooks<string[], string[]>('routes'); const entered = gate(); const release = gate();
  hooks.tap({ id: 'a', owner: 'a', ownerOrder: 0, run: async v => { entered.resolve(); await release.promise; return [...v, 'a']; } });
  const off = hooks.tap({ id: 'b', owner: 'b', ownerOrder: 1, run: v => [...v, 'b'] });
  const old = hooks.reduce([], stringArray); await entered.promise;
  off(); hooks.tap({ id: 'c', owner: 'c', ownerOrder: 2, run: v => [...v, 'c'] });
  release.resolve(); assert.deepEqual(await old, ['a', 'b']);
  assert.deepEqual(await hooks.reduce([], stringArray), ['a', 'c']);
});

test('stale unregister handles cannot delete replacement hook identities', options, async () => {
  const hooks = new OrderedHooks<void, readonly number[]>('collect');
  const old = hooks.tap({ id: 'same', owner: 'p', ownerOrder: 0, run: () => [1] });
  old(); hooks.tap({ id: 'same', owner: 'p', ownerOrder: 0, run: () => [2] }); old();
  assert.deepEqual(await hooks.collect(undefined), [2]);
});

test('series executes every step and does not use Cordis bail semantics', options, async () => {
  const hooks = new OrderedHooks<void, void>('check'); const calls: string[] = [];
  hooks.tap({ id: 'a', owner: 'a', ownerOrder: 0, run: () => { calls.push('a'); } });
  hooks.tap({ id: 'b', owner: 'b', ownerOrder: 1, run: async () => { calls.push('b'); } });
  await hooks.series(undefined); assert.deepEqual(calls, ['a', 'b']);
});

test('invalid reducer output is rejected with hook provenance', options, async () => {
  const hooks = new OrderedHooks<string[], string[]>('routes');
  hooks.tap({ id: 'bad', owner: 'bad-plugin', ownerOrder: 0, run: () => 42 as unknown as string[] });
  await assert.rejects(hooks.reduce([], stringArray), error => hasCode('HOOK_RETURN_INVALID')(error)
    && (error as { details: { pluginId: string } }).details.pluginId === 'bad-plugin');
});

test('async hook error retains the cause', options, async () => {
  const hooks = new OrderedHooks<void, void>('check'); const cause = new Error('check failed');
  hooks.tap({ id: 'bad', owner: 'p', ownerOrder: 0, run: async () => { throw cause; } });
  await assert.rejects(hooks.series(undefined), error => hasCode('HOOK_FAILED')(error) && hasCause(error, cause));
});
