import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pluginManifest, pluginTemplateFiles } from '../packages/create/src/plugin-template.js';
import { templateFiles } from '../packages/create/src/templates.js';
async function fixture(t: TestContext) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'cormi-pack-preflight-')));
  t.after(() => rm(dir, {recursive:true,force:true}));
  for (const [path, text] of Object.entries(pluginTemplateFiles('@example/test'))) { await mkdir(dirname(join(dir,path)),{recursive:true}); await writeFile(join(dir,path),text); }
  const versions = Object.fromEntries(['@cormijs/core','@cormijs/plugin-react','@cormijs/runtime','@cormijs/plugin-dev-api'].map(name=>[name,'0.0.1']));
  await writeFile(join(dir,'package.json'),JSON.stringify(pluginManifest('@example/test',{},versions)));
  return dir;
}
async function rejectPreflight(dir: string, message: RegExp) {
  // This is a preflight test: no compiler or package manager is installed or executed.
  const result = spawnSync(process.execPath,[join(dir,'scripts/pack.mjs')],{cwd:dir,env:{...process.env,npm_execpath:join(dir,'never-executed-pnpm.cjs')},encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined); assert.equal(result.status,1); assert.match(result.stderr,message);
  assert.ok(!(await readdir(dir)).some(name=>name.startsWith('.cormi-package-')||name==='artifacts'));
}
test('plugin packaging refuses an active cormi session before creating a private staging tree', {timeout:10000}, async t => {
  const dir=await fixture(t);await mkdir(join(dir,'.cormi.lock'));await rejectPreflight(dir,/Stop the active cormi session/);
});
test('empty nested directories count toward the author package traversal budget', {timeout:10000}, async t => {
  const dir=await fixture(t);await mkdir(join(dir,'src',...Array<string>(34).fill('nested')),{recursive:true});await rejectPreflight(dir,/Source directory budget exceeded/);
});
test('license links are refused before packaging and the target bytes are not copied', {timeout:10000}, async t => {
  const dir=await fixture(t);await writeFile(join(dir,'private.txt'),'PRIVATE_EXTERNAL_LICENSE');await symlink(join(dir,'private.txt'),join(dir,'LICENSE.md'));
  await rejectPreflight(dir,/Package documentation must be independent regular files/);
});
test('all generated HTML templates declare a local-independent favicon for subpath hosting', () => {
  for(const template of ['react','react-api','plugin-react'] as const) {
    const html=templateFiles(template)['index.html']!;assert.match(html,/<link rel="icon" href="data:,">/);assert.doesNotMatch(html,/href="\/favicon/);
  }
});
