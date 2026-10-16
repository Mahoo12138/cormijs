import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { app, cli, webConfig, cleanLauncher } from './launcher-helpers.js';
import { assertPortFree } from './helpers.js';

const options = { timeout: 20000 };
test('dev server denies config sources, transitive inputs, compiled private cache and lock metadata', options, async t => {
  const f = await app(t); await f.write('settings.ts', 'export const value="private-marker-config";'); await f.write('cormi.config.ts', webConfig());
  const c = cli(t, f.root, 'dev'); const ready = await c.waitFor(e => e.type === 'ready');
  const generation = (await readdir(join(f.root, '.cormi'))).find(name => name.startsWith('run-')); assert.ok(generation);
  for (const path of ['/cormi.config.ts', '/settings.ts?raw', `/.cormi/${generation}/config.mjs`, '/.cormi.lock/owner.json', `/@fs/${f.root}/settings.ts`]) {
    const response = await fetch(new URL(path, ready.url)); const body = await response.text();
    assert.equal(response.status, 403, `${path}: ${body.slice(0, 150)}`); assert.equal(body.includes('private-marker-config'), false);
  }
  assert.equal((await fetch(new URL('main.ts', ready.url))).status, 200);
  await c.stop(); await cleanLauncher(f.root);
});

test('runtime config failure stops the old worker but allows repair without a restart storm', options, async t => {
  const f = await app(t); await f.write('settings.ts', 'export const value="stable";'); await f.write('cormi.config.ts', webConfig());
  const c = cli(t, f.root, 'dev'); const first = await c.waitFor(e => e.type === 'ready');
  await f.write('cormi.config.ts', webConfig('', '{typo:true}'));
  await c.waitFor(e => e.type === 'watching' && e.generation === 2);
  assert.ok(c.events.some(e => e.code === 'CONFIG_INVALID' && e.servingPrevious === false));
  await assertPortFree(Number(new URL(first.url).port));
  const starts = c.events.filter(e => e.type === 'starting').length; await delay(500);
  assert.equal(c.events.filter(e => e.type === 'starting').length, starts);
  await f.write('cormi.config.ts', webConfig()); const recovered = await c.waitFor(e => e.type === 'ready' && e.generation === 3);
  assert.equal(await (await fetch(new URL('version', recovered.url))).text(), 'stable');
  await c.stop(); await cleanLauncher(f.root);
});

test('shutdown failure is observable, bounded, and does not report successful exit', options, async t => {
  const f = await app(t); await f.write('settings.ts', 'export const value="hanging-cleanup";');
  await f.write('cormi.config.ts', webConfig('ctx.effect(()=>()=>new Promise(()=>{}));'));
  const c = cli(t, f.root, 'dev', ['--shutdown-timeout','400']); const ready = await c.waitFor(e => e.type === 'ready');
  assert.equal(await c.stop(), 1);
  assert.ok(c.events.some(e => ['CLEANUP_INCOMPLETE','WORKER_STOP_TIMEOUT'].includes(e.code)));
  await assertPortFree(Number(new URL(ready.url).port)); await cleanLauncher(f.root);
});
