import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, symlink, link, rm, realpath } from 'node:fs/promises';
import { existsSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import type { BuildPlan, BuildResult } from '@cormijs/builder';
import { publishBuild } from '../packages/plugin-web/dist/publication.js';
import { fixture, gate, hasCode } from './helpers.js';

const build = (value: string) => async (plan: BuildPlan): Promise<BuildResult> => {
  const dir = resolve(plan.root, plan.outDir); await mkdir(dir);
  await writeFile(join(dir, 'index.html'), value);
  await mkdir(join(dir, 'assets')); await writeFile(join(dir, 'assets/app.js'), `/* ${value} */`);
  return { backend: 'test', outDir: dir };
};
async function clean(root: string) { assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.cormi-publish')), []); }

test('publication replaces only an unchanged managed output, removing obsolete files', async t => {
  const f = await fixture(); t.after(f.clean);
  const first = await publishBuild(f.plan, build('v1')); assert.equal(first.publication.replaced, false);
  const old = await readFile(join(first.outDir, '.cormi-build.json'), 'utf8');
  const second = await publishBuild(f.plan, async plan => {
    const result = await build('v2')(plan); await rm(join(result.outDir, 'assets'), { recursive: true }); return result;
  });
  assert.equal(second.publication.replaced, true); assert.equal(await readFile(join(second.outDir, 'index.html'), 'utf8'), 'v2');
  assert.equal(existsSync(join(second.outDir, 'assets')), false);
  assert.notEqual(await readFile(join(second.outDir, '.cormi-build.json'), 'utf8'), old); await clean(f.root);
});
test('partial build failure and late cancellation retain the exact previous output', async t => {
  const f = await fixture(); t.after(f.clean); const first = await publishBuild(f.plan, build('stable'));
  const marker = await readFile(join(first.outDir, '.cormi-build.json'), 'utf8');
  await assert.rejects(publishBuild(f.plan, async plan => { await build('partial')(plan); throw new Error('compiler failed'); }), /compiler failed/);
  const cancel = new AbortController();
  await assert.rejects(publishBuild(f.plan, async plan => { const result = await build('late')(plan); cancel.abort(); return result; }, cancel.signal));
  assert.equal(await readFile(join(first.outDir, 'index.html'), 'utf8'), 'stable');
  assert.equal(await readFile(join(first.outDir, '.cormi-build.json'), 'utf8'), marker); await clean(f.root);
});
test('unknown output and edited managed output fail before invoking the builder', async t => {
  const f = await fixture(); t.after(f.clean); let calls = 0;
  const counting = async (plan: BuildPlan) => { calls++; return build('next')(plan); };
  await mkdir(join(f.root, 'dist')); await writeFile(join(f.root, 'dist/user.txt'), 'keep');
  await assert.rejects(publishBuild(f.plan, counting), hasCode('OUTPUT_NOT_OWNED')); assert.equal(calls, 0);
  await rm(join(f.root, 'dist'), { recursive: true }); await publishBuild(f.plan, build('owned'));
  await writeFile(join(f.root, 'dist/user.txt'), 'keep');
  await assert.rejects(publishBuild(f.plan, counting), hasCode('OUTPUT_MODIFIED')); assert.equal(calls, 0);
  assert.equal(await readFile(join(f.root, 'dist/user.txt'), 'utf8'), 'keep'); await clean(f.root);
});
test('output content changes during build are not overwritten', async t => {
  const f = await fixture(); t.after(f.clean); await publishBuild(f.plan, build('old'));
  await assert.rejects(publishBuild(f.plan, async plan => {
    const result = await build('new')(plan); await writeFile(join(f.root, 'dist/index.html'), 'external edit'); return result;
  }), hasCode('OUTPUT_MODIFIED'));
  assert.equal(await readFile(join(f.root, 'dist/index.html'), 'utf8'), 'external edit'); await clean(f.root);
});
test('a second low-level publication cannot enter while the first builder is blocked', async t => {
  const f = await fixture(); t.after(f.clean); const entered = gate(), release = gate();
  const first = publishBuild(f.plan, async plan => { entered.resolve(); await release.promise; return build('first')(plan); });
  try { await entered.promise; await assert.rejects(publishBuild(f.plan, build('second')), hasCode('PUBLISH_BUSY')); }
  finally { release.resolve(); await first; }
  await clean(f.root);
});
test('cutover failure restores the previous directory without changing its metadata', async t => {
  const f = await fixture(); t.after(f.clean); await publishBuild(f.plan, build('old'));
  const old = await readFile(join(f.root, 'dist/.cormi-build.json'), 'utf8');
  let count = 0;
  await assert.rejects(publishBuild(f.plan, build('new'), undefined, { rename(from, to) {
    if (++count === 2) throw new Error('injected rename failure'); renameSync(from, to);
  } }), hasCode('PUBLISH_FAILED'));
  assert.equal(count, 3); assert.equal(await readFile(join(f.root, 'dist/index.html'), 'utf8'), 'old');
  assert.equal(await readFile(join(f.root, 'dist/.cormi-build.json'), 'utf8'), old); await clean(f.root);
});
test('failed rollback retains a journal and the complete backup and blocks new publications', async t => {
  const f = await fixture(); t.after(f.clean); await publishBuild(f.plan, build('old')); let count = 0;
  await assert.rejects(publishBuild(f.plan, build('new'), undefined, { rename(from, to) {
    if (++count >= 2) throw new Error('injected storage failure'); renameSync(from, to);
  } }), hasCode('PUBLISH_ROLLBACK_FAILED'));
  const work = (await readdir(f.root)).find(name => name.startsWith('.cormi-publish-'))!;
  assert.ok(work); assert.equal(await readFile(join(f.root, work, 'previous/index.html'), 'utf8'), 'old');
  assert.ok(JSON.parse(await readFile(join(f.root, work, 'transaction.json'), 'utf8')).previous);
  assert.equal(existsSync(join(f.root, 'dist')), false);
  await assert.rejects(publishBuild(f.plan, build('third')), hasCode('PUBLISH_BUSY'));
});
test('unsafe paths and output symlinks never replace user directories', async t => {
  const f = await fixture(); t.after(f.clean); const outside = await fixture(); t.after(outside.clean);
  for (const outDir of ['..', '../outside', 'src', '.cormi', 'dist/child']) await assert.rejects(publishBuild({ ...f.plan, outDir }, build('bad')), hasCode('OUTPUT_PATH_INVALID'));
  await symlink(outside.root, join(f.root, 'dist'), 'dir');
  await assert.rejects(publishBuild(f.plan, build('bad')), hasCode('OUTPUT_PATH_INVALID'));
  assert.ok(existsSync(join(outside.root, 'index.html'))); await clean(f.root);
});
test('a builder cannot publish symlinks, hard links, a missing entry, or its own ownership marker', async t => {
  const f = await fixture(); t.after(f.clean);
  for (const mode of ['symlink', 'hardlink', 'missing', 'marker']) {
    await assert.rejects(publishBuild(f.plan, async plan => {
      const result = await build('invalid')(plan);
      if (mode === 'symlink') await symlink(join(f.root, 'index.html'), join(result.outDir, 'linked'));
      if (mode === 'hardlink') await link(join(f.root, 'index.html'), join(result.outDir, 'linked'));
      if (mode === 'missing') await rm(join(result.outDir, 'index.html'));
      if (mode === 'marker') await writeFile(join(result.outDir, '.cormi-build.json'), '{}');
      return result;
    }));
    assert.equal(existsSync(join(f.root, 'dist')), false); await clean(f.root);
  }
});
test('a killed publisher retains its journal and blocks automatic retry without changing the old output', { timeout: 10000 }, async t => {
  const f = await fixture(); t.after(f.clean); await publishBuild(f.plan, build('stable'));
  const module = pathToFileURL(resolve('packages/plugin-web/dist/publication.js')).href;
  const source = `import { publishBuild } from ${JSON.stringify(module)};
await publishBuild(${JSON.stringify(f.plan)}, async () => { process.stdout.write('entered\\n'); await new Promise(()=>setInterval(()=>{},1000)); });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('close', resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Publisher did not enter staging')), 4000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    child.kill('SIGKILL'); await exited;
    const work = (await readdir(f.root)).find(name => name.startsWith('.cormi-publish-'))!;
    assert.ok(work); assert.ok(existsSync(join(f.root, work, 'transaction.json')));
    assert.equal(await readFile(join(f.root, 'dist/index.html'), 'utf8'), 'stable');
    await assert.rejects(publishBuild(f.plan, build('retry')), hasCode('PUBLISH_BUSY'));
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; }
});
test('already-aborted publication creates no workspace or output', async t => {
  const f = await fixture(); t.after(f.clean); const controller = new AbortController(); controller.abort();
  await assert.rejects(publishBuild(f.plan, build('never'), controller.signal));
  assert.equal(existsSync(join(f.root, 'dist')), false); await clean(f.root);
});
