import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { app, cli, cleanLauncher } from './launcher-helpers.js';
import type { Diagnosis } from '../packages/cormi/src/diagnose.js';

const options = { timeout: 30000 };
const sample = `import {defineConfig,definePreset} from 'cormijs';
export default defineConfig(({command,mode})=>({presets:[definePreset({id:'team',plugins:[
{id:'provider',plugin:{name:'public-provider',apply(ctx){ctx.provide('value',{secret:'PRIVATE_VALUE'});}}},
{id:'consumer',options:{secret:'PRIVATE_OPTION'},plugin:{name:'public-consumer',inject:['value','commands'],apply(ctx){
ctx.effect(()=>ctx.commands.register('build',async()=>{throw Error('TARGET_COMMAND_MUST_NOT_RUN')}));
ctx.effect(()=>ctx.commands.use('block',async()=>{throw Error('MIDDLEWARE_MUST_NOT_RUN')}));
ctx.get('diagnostics').add('environment',()=>[{kind:'environment',id:command+':'+mode+':'+process.env.NODE_ENV}]);
}}}]} )],plugins:[{id:'disabled',enabled:false,plugin:{apply(){throw Error('DISABLED_MUST_NOT_RUN')}}}]}));`;

test('diagnose joins preset origins, disabled entries, native services and contributions without executing the target', options, async t => {
  const f = await app(t); await f.write('cormi.config.ts', sample);
  await mkdir(join(f.root, '.cormi')); await writeFile(join(f.root, '.cormi/app.tsx'), 'USER FILE');
  const c = cli(t, f.root, 'diagnose', ['--for', 'build', '--mode', 'staging']); assert.equal(await c.finish(), 0, c.stderr + JSON.stringify(c.events));
  const r = c.events.find(e => e.type === 'result')?.data as Diagnosis;
  assert.equal(r.format, 'cormi:diagnosis:1'); assert.equal(r.healthy, true); assert.equal(r.command, 'build'); assert.equal(r.mode, 'staging');
  assert.equal(r.configured.find(x => x.id === 'provider')?.source, 'preset(team).plugins');
  assert.deepEqual(r.configured.find(x => x.id === 'disabled'), { id: 'disabled', enabled: false, source: 'plugins', node: null });
  const consumer = r.graph.nodes.find(n => n.pluginId === 'consumer')!;
  const binding = consumer.dependencies.find(d => d.name === 'value')!;
  assert.equal(binding.resolution, 'bound');
  const service = r.graph.services.find(s => s.id === binding.committedProvider)!;
  assert.equal(r.graph.nodes.find(n => n.id === service.provider)?.pluginId, 'provider');
  assert.equal(r.contributions.find(s => s.id === 'environment')?.records[0]?.id, 'build:staging:production');
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_VALUE|PRIVATE_OPTION|TARGET_COMMAND_MUST_NOT_RUN|MIDDLEWARE_MUST_NOT_RUN/);
  assert.equal(c.events.filter(e => e.type === 'ready').length, 0); assert.equal(existsSync(join(f.root, 'dist')), false);
  assert.equal(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), 'USER FILE');
  assert.equal(existsSync(join(f.root, '.cormi.lock')), false);
});

test('missing nested dependencies produce a failed diagnosis snapshot and nonzero exit instead of a successful report', options, async t => {
  const f = await app(t); await f.write('cormi.config.ts', `export default {plugins:[{id:'parent',plugin:{name:'parent',apply(ctx){ctx.plugin({name:'nested',inject:['missing'],apply(){throw Error('never')}})}}}]};`);
  const c = cli(t, f.root, 'diagnose'); assert.equal(await c.finish(), 1);
  const r = c.events.find(e => e.type === 'diagnosis')?.data as Diagnosis;
  assert.equal(r.healthy, false); assert.equal(r.readiness.code, 'SERVICE_MISSING');
  const nested = r.graph.nodes.find(n => n.name === 'nested')!;
  assert.equal(nested.dependencies[0]?.resolution, 'missing');
  assert.equal(r.graph.nodes.find(n => n.id === nested.parent)?.pluginId, 'parent');
  assert.ok(c.events.some(e => e.code === 'DIAGNOSIS_UNHEALTHY')); assert.equal(c.events.filter(e => e.type === 'result').length, 0);
  await cleanLauncher(f.root);
});

test('initialization failures remain failures, expose native FAILED state and omit raw exception text from the report', options, async t => {
  const f = await app(t); await f.write('cormi.config.ts', `export default {plugins:[{id:'broken',plugin:{apply(){throw Error('PRIVATE_ERROR_TOKEN')}}}]};`);
  const c = cli(t, f.root, 'diagnose'); assert.equal(await c.finish(), 1);
  const r = c.events.find(e => e.type === 'diagnosis')?.data as Diagnosis;
  assert.equal(r.readiness.code, 'PLUGIN_FAILED'); assert.equal(r.graph.nodes.find(n => n.pluginId === 'broken')?.state, 'FAILED');
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_ERROR_TOKEN|stack|cause/); await cleanLauncher(f.root);
});

test('diagnostic collectors cannot serialize private structures or silently turn a collection error into healthy', options, async t => {
  const f = await app(t); await f.write('cormi.config.ts', `export default {plugins:[{id:'bad-report',plugin:{apply(ctx){ctx.get('diagnostics').add('bad',()=>[{kind:'extension',id:'visible',token:'PRIVATE_EXTRA'}]);}}}]};`);
  const c = cli(t, f.root, 'diagnose'); assert.equal(await c.finish(), 1);
  const r = c.events.find(e => e.type === 'diagnosis')?.data as Diagnosis;
  assert.equal(r.readiness.status, 'ready'); assert.equal(r.contributions.find(x => x.id === 'bad')?.status, 'failed');
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_EXTRA/); await cleanLauncher(f.root);
});

test('cleanup failure prevents diagnose from emitting a successful result', options, async t => {
  const f = await app(t); await f.write('cormi.config.ts', `export default {plugins:[{id:'bad-close',plugin:{apply(ctx){ctx.effect(()=>()=>{throw Error('close failure')});}}}]};`);
  const c = cli(t, f.root, 'diagnose'); assert.equal(await c.finish(), 1);
  assert.equal(c.events.filter(e => e.type === 'result').length, 0);
  assert.ok(c.events.some(e => e.code === 'CLEANUP_INCOMPLETE')); await cleanLauncher(f.root);
});

test('diagnose does not claim to inspect a running session, bypass a project lock or reconstruct an unevaluated config', options, async t => {
  const f = await app(t); await f.write('cormi.config.ts', 'export default { broken:');
  const syntax = cli(t, f.root, 'diagnose'); assert.equal(await syntax.finish(), 1);
  assert.equal(syntax.events.filter(e => e.type === 'diagnosis' || e.type === 'result').length, 0);
  assert.ok(syntax.events.some(e => e.code === 'CONFIG_COMPILE_FAILED')); await cleanLauncher(f.root);
  await f.write('cormi.config.ts', sample); await mkdir(join(f.root, '.cormi.lock'));
  const busy = cli(t, f.root, 'diagnose'); assert.equal(await busy.finish(), 1);
  assert.ok(busy.events.some(e => e.code === 'PROJECT_BUSY')); assert.equal(existsSync(join(f.root, '.cormi.lock')), true);
});

test('text diagnosis identifies the missing dependency and owns no application server', options, async t => {
  const f = await app(t); await f.write('cormi.config.ts', `export default {plugins:[{id:'my-feature',plugin:{name:'feature',inject:['database'],apply(){}}}]};`);
  const p = spawnSync(process.execPath, [resolve('packages/cormi/dist/cli.js'), 'diagnose', '--root', f.root], { encoding: 'utf8', timeout: 15000 });
  assert.equal(p.status, 1); assert.match(p.stdout, /requires database: missing/); assert.match(p.stdout, /my-feature/);
  assert.match(p.stdout, /not the running dev server/); assert.doesNotMatch(p.stdout, /cormi ready/); await cleanLauncher(f.root);
});
