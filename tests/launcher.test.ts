import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, cli, webConfig, cleanLauncher } from './launcher-helpers.js';
import { assertPortFree } from './helpers.js';

const options = { timeout: 20000 };
const echo = `import {defineConfig} from 'cormijs';
export default defineConfig(async environment => ({ app:{answer:42}, plugins:[{id:'echo',plugin:{inject:['commands'],apply:ctx=>{
 ctx.effect(()=>ctx.commands.register('echo',async request=>({kind:'result',data:{...request.options,mode:request.mode,env:process.env.CORMI_TEST_ENV,source:import.meta.url,pid:process.pid}})));
}}}]}));`;

test('CLI loads a TS config factory in a fresh worker and executes a plugin-defined command', options, async t => {
  const f = await app(t); await f.write('cormi.config.ts', echo); await f.write('.env', 'CORMI_TEST_ENV=from-file\n');
  const c = cli(t, f.root, 'echo', ['--mode', 'custom']); assert.equal(await c.finish(), 0, JSON.stringify(c.events) + c.stderr);
  const event = c.events.find(e => e.type === 'result'); assert.ok(event);
  assert.equal(event.data.answer, 42); assert.equal(event.data.mode, 'custom'); assert.equal(event.data.env, 'from-file');
  assert.equal(new URL(event.data.source).pathname, join(f.root, 'cormi.config.ts'));
  assert.notEqual(event.data.pid, c.child.pid); assert.notEqual(process.env.CORMI_TEST_ENV, 'from-file');
  await cleanLauncher(f.root);
});

test('unknown config keys and missing required services exit nonzero and release the lease', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', 'export default { plguins: [] };');
  const bad = cli(t, f.root, 'build'); assert.equal(await bad.finish(), 1); assert.ok(bad.events.some(e => e.code === 'CONFIG_INVALID')); await cleanLauncher(f.root);
  await f.write('cormi.config.ts', `import {webPlugin,webCommandsPlugin} from '@cormijs/plugin-web'; export default {plugins:[{id:'web',plugin:webPlugin},{id:'commands',plugin:webCommandsPlugin}]};`);
  const missing = cli(t, f.root, 'build'); assert.equal(await missing.finish(), 1); assert.ok(missing.events.some(e => e.code === 'SERVICE_MISSING')); await cleanLauncher(f.root);
});

test('real config-driven Vite development serves requests and closes before lease release', options, async t => {
  const f = await app(t); await f.write('settings.ts', 'export const value = "one";'); await f.write('cormi.config.ts', webConfig());
  const c = cli(t, f.root, 'dev'); const ready = await c.waitFor(e => e.type === 'ready');
  assert.equal(await (await fetch(new URL('version', ready.url))).text(), 'one');
  assert.equal((await fetch(new URL('main.ts', ready.url))).status, 200);
  assert.equal(await c.stop(), 0); await assertPortFree(Number(new URL(ready.url).port)); await cleanLauncher(f.root);
});

test('competing command is rejected before evaluation; a different project can run concurrently', options, async t => {
  const f = await app(t); const other = await app(t);
  await f.write('settings.ts', 'export const value = "serving";'); await f.write('cormi.config.ts', webConfig());
  const first = cli(t, f.root, 'dev'); const ready = await first.waitFor(e => e.type === 'ready');
  const cacheBefore = await readdir(join(f.root, '.cormi'));
  const contender = cli(t, f.root, 'build'); assert.equal(await contender.finish(), 1); assert.ok(contender.events.some(e => e.code === 'PROJECT_BUSY'));
  assert.deepEqual(await readdir(join(f.root, '.cormi')), cacheBefore); assert.equal(existsSync(join(f.root, 'dist')), false);
  assert.equal(await (await fetch(new URL('version', ready.url))).text(), 'serving');
  await other.write('cormi.config.ts', echo); const parallel = cli(t, other.root, 'echo'); assert.equal(await parallel.finish(), 0, JSON.stringify(parallel.events));
  await first.stop(); await cleanLauncher(f.root); await cleanLauncher(other.root);
});

test('transitive config dependency changes replace worker and release the old listening port', options, async t => {
  const f = await app(t); await f.write('settings.ts', 'export const value="v1";'); await f.write('cormi.config.ts', webConfig());
  const c = cli(t, f.root, 'dev'); const first = await c.waitFor(e => e.type === 'ready');
  await f.write('settings.ts', 'export const value="v2";'); const second = await c.waitFor(e => e.type === 'ready' && e.generation === 2);
  assert.notEqual(first.pid, second.pid); assert.equal(await (await fetch(new URL('version', second.url))).text(), 'v2');
  if (first.url !== second.url) await assertPortFree(Number(new URL(first.url).port));
  await c.stop(); await cleanLauncher(f.root);
});

test('syntax failure keeps the old worker serving without a restart storm; a fix recovers', options, async t => {
  const f = await app(t); await f.write('settings.ts', 'export const value="stable";'); const source = webConfig(); await f.write('cormi.config.ts', source);
  const c = cli(t, f.root, 'dev'); const first = await c.waitFor(e => e.type === 'ready');
  await f.write('cormi.config.ts', 'export default { invalid syntax');
  await c.waitFor(e => e.code === 'CONFIG_COMPILE_FAILED' && e.servingPrevious === true);
  const failures = c.events.filter(e => e.type === 'error').length; await delay(600);
  assert.equal(c.events.filter(e => e.type === 'error').length, failures);
  assert.equal(await (await fetch(new URL('version', first.url))).text(), 'stable');
  await f.write('cormi.config.ts', source); const fixed = await c.waitFor(e => e.type === 'ready' && e.generation === 2);
  assert.equal(await (await fetch(new URL('version', fixed.url))).text(), 'stable'); await c.stop(); await cleanLauncher(f.root);
});

test('creating a missing dependency recovers an initially invalid configuration', options, async t => {
  const f = await app(t); await f.write('cormi.config.ts', webConfig());
  const c = cli(t, f.root, 'dev'); await c.waitFor(e => e.code === 'CONFIG_COMPILE_FAILED');
  await f.write('settings.ts', 'export const value="created";');
  const ready = await c.waitFor(e => e.type === 'ready');
  assert.equal(await (await fetch(new URL('version', ready.url))).text(), 'created'); await c.stop(); await cleanLauncher(f.root);
});

test('changes received during worker initialization are not swallowed by a late ready result', options, async t => {
  const f = await app(t); await f.write('settings.ts', 'export const value="old";');
  await f.write('cormi.config.ts', webConfig('await new Promise(resolve => setTimeout(resolve, 400));'));
  const c = cli(t, f.root, 'dev'); await c.waitFor(e => e.type === 'starting');
  await f.write('settings.ts', 'export const value="new";');
  const latest = await c.waitFor(e => e.type === 'ready' && e.generation >= 2);
  assert.equal(await (await fetch(new URL('version', latest.url))).text(), 'new'); await c.stop(); await cleanLauncher(f.root);
});

test('no-watch starts once and ignores later configuration edits', options, async t => {
  const f = await app(t); await f.write('settings.ts', 'export const value="fixed";'); await f.write('cormi.config.ts', webConfig());
  const c = cli(t, f.root, 'dev', ['--no-watch']); const ready = await c.waitFor(e => e.type === 'ready');
  await f.write('settings.ts', 'export const value="changed";'); await delay(650);
  assert.equal(c.events.filter(e => e.type === 'starting').length, 1);
  assert.equal(await (await fetch(new URL('version', ready.url))).text(), 'fixed'); await c.stop();
});

test('build and preview run in separate command workers; failed rebuild does not overwrite output', options, async t => {
  const f = await app(t); await f.write('settings.ts', 'export const value="build";'); await f.write('cormi.config.ts', webConfig('', `{base:'/demo/'}`));
  const build = cli(t, f.root, 'build'); assert.equal(await build.finish(), 0, JSON.stringify(build.events));
  const html = await readFile(join(f.root, 'dist/index.html'), 'utf8');
  await f.write('main.ts', 'const broken: = ;');
  const second = cli(t, f.root, 'build'); assert.equal(await second.finish(), 1); assert.ok(second.events.some(e => e.type === 'error'));
  assert.equal(await readFile(join(f.root, 'dist/index.html'), 'utf8'), html);
  const preview = cli(t, f.root, 'preview'); const ready = await preview.waitFor(e => e.type === 'ready');
  assert.equal((await fetch(new URL('/demo/nested/path', ready.url))).status, 200);
  assert.equal(await preview.stop(), 0); await cleanLauncher(f.root);
});

test('a CPU-blocked configuration is bounded by the supervisor and only the owned child is terminated', options, async t => {
  const f = await app(t); await f.write('cormi.config.ts', 'while (true) {}\nexport default {};');
  const c = cli(t, f.root, 'echo', ['--startup-timeout','600','--shutdown-timeout','200']);
  assert.equal(await c.finish(5000), 1); assert.ok(c.events.some(e => e.code === 'WORKER_START_TIMEOUT'));
  const pid = c.events.find(e => e.type === 'starting')?.pid; assert.equal(typeof pid, 'number');
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); await cleanLauncher(f.root);
});

test('cache directory symlinks are rejected without changing their targets', options, async t => {
  const f = await app(t); const other = await app(t); await f.write('cormi.config.ts', echo);
  await symlink(other.root, join(f.root, '.cormi'), 'dir');
  const c = cli(t, f.root, 'echo'); assert.equal(await c.finish(), 1); assert.ok(c.events.some(e => e.code === 'CACHE_PATH_INVALID'));
  assert.equal(existsSync(join(other.root, 'index.html')), true); assert.equal(existsSync(join(f.root, '.cormi.lock')), false);
});
