import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { parseEnvironment, readEnvironment } from '../packages/cormi/src/environment.js';
import { app, cleanLauncher } from './launcher-helpers.js';
import { fixture, hasCode } from './helpers.js';

const bounds = { timeout: 20000 };

test('environment limits apply to assignments and the combined unique-key set rather than each layer independently', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cormi env review '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assignments = Array.from({ length: 512 }, (_, i) => `KEY=${i}`).join('\n');
  assert.equal(parseEnvironment(assignments, '.env').KEY, '511');
  assert.throws(() => parseEnvironment(assignments + '\nKEY=overflow', '.env'), hasCode('ENV_SYNTAX_INVALID'));
  await writeFile(join(root, '.env'), Array.from({ length: 256 }, (_, i) => `A_${i}=a`).join('\n'));
  await writeFile(join(root, '.env.local'), Array.from({ length: 256 }, (_, i) => `B_${i}=b`).join('\n'));
  assert.equal(Object.keys((await readEnvironment(root, 'staging')).values).length, 512);
  await writeFile(join(root, '.env.staging'), 'A_0=override');
  assert.equal((await readEnvironment(root, 'staging')).values.A_0, 'override');
  await writeFile(join(root, '.env.staging.local'), 'ONE_MORE=x');
  await assert.rejects(readEnvironment(root, 'staging'), hasCode('ENV_LIMIT'));
});

test('inherited empty public values win before module evaluation and cannot be changed through the factory snapshot', bounds, async t => {
  const f = await app(t);
  await f.write('.env.staging.local', 'CORMI_PUBLIC_REVIEW=file-value\nNODE_ENV=development');
  await f.write('cormi.config.ts', `const top = process.env.CORMI_PUBLIC_REVIEW;
export default ({env}) => {let immutable=false;try{env.CORMI_PUBLIC_REVIEW='mutation'}catch{immutable=true}
return {plugins:[{id:'probe',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.register('probe',async request=>({kind:'result',data:{top,immutable,node:env.NODE_ENV,value:request.publicEnv.CORMI_PUBLIC_REVIEW,summary:request.configuration.environment}})))}}}]};};`);
  const processResult = spawnSync(process.execPath, [resolve('packages/cormi/dist/cli.js'), 'probe', '--root', f.root, '--mode', 'staging', '--json'], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, CORMI_PUBLIC_REVIEW: '', NODE_ENV: 'development', NODE_PATH: '' },
  });
  assert.equal(processResult.status, 0, processResult.stdout + processResult.stderr);
  const events = processResult.stdout.trim().split('\n').map(line => JSON.parse(line));
  const result = events.find(e => e.type === 'result')?.data;
  assert.equal(result.top, ''); assert.equal(result.value, ''); assert.equal(result.immutable, true); assert.equal(result.node, 'production');
  assert.deepEqual(result.summary.variables.find((v: { name: string }) => v.name === 'CORMI_PUBLIC_REVIEW').history, ['.env.staging.local', 'inherited']);
  assert.doesNotMatch(JSON.stringify(result.summary), /file-value|mutation/);
  await cleanLauncher(f.root);
});

test('a native config hook cannot delete public definitions and silently split dev from build', bounds, async () => {
  const f = await fixture(), host = new ProjectRuntime();
  host.mount('vite', vitePlugin);
  host.mount('remove-definition', { inject: ['vite'], apply(ctx) {
    ctx.effect(() => ctx.vite.add('remove-definition', () => ({ name: 'remove-definition', config(config) {
      delete config.define!['import.meta.env.CORMI_PUBLIC_VALUE'];
    } })));
  } });
  try {
    await host.ready();
    await assert.rejects(host.ctx.builder.build({ ...f.plan, publicEnv: { CORMI_PUBLIC_VALUE: 'EXPECTED_VALUE' } }), hasCode('VITE_RESERVED_CONFIG'));
    assert.deepEqual((await readdir(f.root)).filter(name => name.startsWith('.cormi-vite-')), []);
  } finally { await host.dispose(); await f.clean(); }
});

test('an environment config hook cannot remove an inherited public definition from the client build', bounds, async () => {
  const f = await fixture(), host = new ProjectRuntime();
  host.mount('vite', vitePlugin);
  host.mount('remove-client-definition', { inject: ['vite'], apply(ctx) {
    ctx.effect(() => ctx.vite.add('remove-client-definition', () => ({ name: 'remove-client-definition', configEnvironment(name, config) {
      if (name === 'client') config.define = {};
    } })));
  } });
  await writeFile(join(f.root, 'main.ts'), 'console.log(import.meta.env.CORMI_PUBLIC_VALUE);');
  try {
    await host.ready();
    await assert.rejects(host.ctx.builder.build({ ...f.plan, publicEnv: { CORMI_PUBLIC_VALUE: 'EXPECTED_VALUE' } }), hasCode('VITE_RESERVED_CONFIG'));
    assert.deepEqual((await readdir(f.root)).filter(name => name.startsWith('.cormi-vite-')), []);
  } finally { await host.dispose(); await f.clean(); }
});
