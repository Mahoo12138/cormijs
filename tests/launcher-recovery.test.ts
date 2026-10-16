import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, cli, webConfig, cleanLauncher } from './launcher-helpers.js';
import { assertPortFree } from './helpers.js';

const options = { timeout: 20000 };
test('explicit watched files are reloaded, including edits immediately after readiness', options, async t => {
  const f = await app(t); await f.write('state.json', '{"value":"first"}');
  const source = webConfig('', '{}', `import {readFileSync} from 'node:fs'; const value = JSON.parse(readFileSync(new URL('./state.json',import.meta.url),'utf8')).value;`)
    .replace('app: {},', "watch:['state.json'], app: {},");
  await f.write('cormi.config.ts', source);
  const c = cli(t, f.root, 'dev'); const first = await c.waitFor(e => e.type === 'ready');
  await f.write('state.json', '{"value":"second"}');
  const second = await c.waitFor(e => e.type === 'ready' && e.generation === 2);
  assert.notEqual(first.pid, second.pid);
  assert.equal(await (await fetch(new URL('version', second.url))).text(), 'second');
  await c.stop(); await cleanLauncher(f.root);
});

test('dotenv changes take effect in a fresh worker and do not leak into the parent', options, async t => {
  const f = await app(t); await f.write('.env', 'CORMI_RELOAD_TEST=before\n');
  await f.write('cormi.config.ts', webConfig('', '{}', `const value = process.env.CORMI_RELOAD_TEST;`));
  const c = cli(t, f.root, 'dev'); const first = await c.waitFor(e => e.type === 'ready');
  assert.equal(await (await fetch(new URL('version', first.url))).text(), 'before');
  await f.write('.env', 'CORMI_RELOAD_TEST=after\n'); const second = await c.waitFor(e => e.type === 'ready' && e.generation === 2);
  assert.equal(await (await fetch(new URL('version', second.url))).text(), 'after');
  assert.equal(process.env.CORMI_RELOAD_TEST, undefined);
  await c.stop(); await cleanLauncher(f.root);
});

test('abrupt launcher death disconnects its cooperative worker but deliberately retains the stale lock', options, async t => {
  const f = await app(t); await f.write('settings.ts', 'export const value="owned";'); await f.write('cormi.config.ts', webConfig());
  const c = cli(t, f.root, 'dev'); const first = await c.waitFor(e => e.type === 'ready');
  c.child.kill('SIGKILL'); await c.finish();
  const end = Date.now() + 5000; let gone = false;
  while (Date.now() < end) {
    try { process.kill(first.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') { gone = true; break; } throw error; }
    await delay(30);
  }
  assert.equal(gone, true, 'cooperative worker must exit after IPC disconnection');
  await assertPortFree(Number(new URL(first.url).port));
  assert.equal(existsSync(join(f.root, '.cormi.lock/owner.json')), true);
  const contender = cli(t, f.root, 'build'); assert.equal(await contender.finish(), 1);
  assert.ok(contender.events.some(e => e.code === 'PROJECT_BUSY'));
});
