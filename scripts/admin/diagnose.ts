import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Diagnosis } from 'cormijs';
import { appCommand, guardedSource, hash } from './harness.js';

// No UI adaptation: a real installed application verifies command, dependency and metadata boundaries.
const { values } = parseArgs({ strict: true, options: { app: { type: 'string' }, out: { type: 'string' } } });
assert.ok(values.app && values.out, 'Required: --app <dedicated installed application> --out <new directory>');
const app = await realpath(values.app), out = resolve(values.out);
assert.ok(!existsSync(out) && !existsSync(join(app, '.cormi.lock')), 'Use an idle dedicated copy and a new result directory');
await mkdir(out, { recursive: true });
const config = await guardedSource(app, 'cormi.config.ts');
async function hashes(prefixes: string[]) {
  const result: Record<string, string> = {};
  async function visit(path: string): Promise<void> {
    if (!existsSync(path)) return;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name); assert.ok(!entry.isSymbolicLink());
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) result[relative(app, file)] = hash(await readFile(file));
    }
  }
  for (const prefix of prefixes) await visit(join(app, prefix));
  return result;
}
const originalSources = await hashes(['src', 'public']);
const stages: Array<Record<string, unknown>> = [];
const result: Record<string, unknown> = { format: 'cormi:admin-diagnosis-test:1', app, passed: false, stages };
try {
  await writeFile(join(out, 'baseline-typecheck.log'), appCommand(app, 'typecheck'));
  await writeFile(join(out, 'baseline-build.log'), appCommand(app, 'build'));
  const generated = await hashes(['.cormi', 'dist']);
  const original = config.original.toString();
  assert.equal(original.split('export default defineConfig(').length, 2);
  const source = (enabled: boolean, missing = false) => `import { DevApiService } from '@cormijs/plugin-dev-api/service';
import extension from '@cormi-test/dev-extension';
${original.replace('export default defineConfig(', 'const originalConfig = defineConfig(')}
export default defineConfig(({command})=>({...originalConfig,plugins:[...(originalConfig.plugins??[]),
${missing ? '' : "{id:'diagnostic-api',plugin:DevApiService,options:{prefix:'/admin/api'}},"}
{id:'installed-extension',plugin:extension,enabled:${enabled},options:{development:command==='dev',label:'diagnostic',target:'http://127.0.0.1:9/PRIVATE_TARGET'}},
{id:'diagnostic-no-execute',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.use('assert-no-command',async()=>{throw Error('TARGET_COMMAND_MUST_NOT_EXECUTE')}));}}}
]}));`;
  async function run(label: string, command: string, status: number): Promise<Diagnosis> {
    const p = spawnSync(process.execPath, [join(app, 'node_modules/cormijs/dist/cli.js'), 'diagnose', '--for', command, '--json', '--startup-timeout', '30000'],
      { cwd: app, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, encoding: 'utf8', timeout: 40000, maxBuffer: 8 * 1024 ** 2 });
    await writeFile(join(out, label + '.log'), p.stdout + p.stderr);
    assert.equal(p.status, status, p.stdout + p.stderr);
    const events = p.stdout.trim().split('\n').map(line => JSON.parse(line) as { type: string; data?: Diagnosis });
    const report = events.find(e => e.type === (status === 0 ? 'result' : 'diagnosis'))?.data;
    assert.ok(report); assert.equal(report.format, 'cormi:diagnosis:1');
    assert.equal(events.filter(e => e.type === 'ready').length, 0);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TARGET|CORMI_FIXTURE_PRIVATE_NODE_MARKER|TARGET_COMMAND_MUST_NOT_EXECUTE/);
    assert.equal(existsSync(join(app, '.cormi.lock')), false);
    assert.deepEqual(await hashes(['.cormi', 'dist']), generated, 'Diagnose must not prepare or build');
    await writeFile(join(out, label + '.json'), JSON.stringify(report, null, 2)); return report;
  }
  await config.replace(source(true));
  const dev = await run('development', 'dev', 0);
  const api = dev.contributions.find(section => section.id === 'dev-api'); assert.ok(api);
  const contributed = api.records.find(record => record.kind === 'api-contribution'); assert.ok(contributed);
  const nativeOwner = dev.graph.nodes.find(node => node.uid === contributed.ownerUid); assert.ok(nativeOwner);
  assert.equal(nativeOwner.name, 'fixture:extension-api');
  const parent = dev.graph.nodes.find(node => node.id === nativeOwner.parent); assert.equal(parent?.pluginId, 'installed-extension');
  assert.ok(nativeOwner.dependencies.some(dep => dep.name === 'devApi' && dep.resolution === 'bound'));
  assert.ok(dev.contributions.find(section => section.id === 'react-hooks')?.records.some(record => record.kind === 'runtime-hook'));
  stages.push({ id: 'installed-native-parent-service-and-contribution', ownerUid: contributed.ownerUid });
  const production = await run('production', 'build', 0);
  assert.equal(production.contributions.find(section => section.id === 'dev-api')?.records.length, 0);
  assert.ok(production.contributions.find(section => section.id === 'react-hooks')?.records.some(record => record.kind === 'runtime-hook'));
  stages.push({ id: 'production-environment-client-only-without-build' });
  await config.replace(source(false)); const disabled = await run('disabled', 'dev', 0);
  assert.equal(disabled.configured.find(entry => entry.id === 'installed-extension')?.enabled, false);
  assert.equal(disabled.graph.nodes.some(node => node.name === 'fixture:extension-api'), false);
  assert.equal(disabled.contributions.find(section => section.id === 'dev-api')?.records.length, 0);
  stages.push({ id: 'disabled-not-confused-with-pending' });
  await config.replace(source(true, true)); const missing = await run('missing-provider', 'dev', 1);
  assert.equal(missing.readiness.code, 'SERVICE_MISSING');
  assert.equal(missing.graph.nodes.find(node => node.name === 'fixture:extension-api')?.dependencies[0]?.resolution, 'missing');
  stages.push({ id: 'missing-provider-preserves-structured-failure' });
  await config.replace(source(true)); assert.equal((await run('repaired', 'dev', 0)).healthy, true);
  stages.push({ id: 'repair-and-generated-artifacts-unchanged' });
  result.passed = true;
} catch (error) { result.error = error instanceof Error ? error.stack : String(error); }
finally {
  try {
    assert.equal(existsSync(join(app, '.cormi.lock')), false);
    await config.restore(); assert.deepEqual(await hashes(['src', 'public']), originalSources);
    result.businessSourcesUnchanged = true;
  } catch (error) { result.passed = false; result.restoreError = String(error); }
  await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: result.passed, stages: stages.length, out, error: result.error, restoreError: result.restoreError }));
  if (!result.passed) process.exitCode = 1;
}
