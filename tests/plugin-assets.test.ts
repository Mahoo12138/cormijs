import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, symlink, link, unlink, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginTemplateFiles, pluginManifest } from '../packages/create/src/plugin-template.js';

interface Tools {
  collectPluginSource(root: string): Promise<Map<string, Buffer>>;
  copyPluginResources(source: Map<string, Buffer>, target: string): Promise<{resources:number;sourceFiles:number}>;
}
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-plugin-assets-')));
  t.after(() => rm(root, {recursive:true,force:true}));
  const files = pluginTemplateFiles('@example/assets');
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(root,path)), {recursive:true}); await writeFile(join(root,path),text); }
  const tools: Tools = await import(pathToFileURL(join(root,'scripts/resources.mjs')).href);
  return {root,dist:join(root,'dist'),...tools};
}
const bounds={timeout:10000};

test('plugin resources preserve CSS, declarations and binary bytes in their source-relative output paths', bounds, async t => {
  const f=await fixture(t);
  const binary=Buffer.from([0,255,128,13,10,0,1,2]);
  for(const ext of ['png','woff2','woff','ttf','otf','avif','jpg','jpeg','gif','webp','ico']) await writeFile(join(f.root,'src/assets/sample.'+ext),binary);
  await writeFile(join(f.root,'src/assets/图示 space.svg'),'<svg>示例</svg>');
  const source=await f.collectPluginSource(f.root);const result=await f.copyPluginResources(source,f.dist);
  assert.ok(result.resources>=15);
  for(const [path,bytes] of source) if(!/\.(?:tsx?|jsx?)$/.test(path)||path.endsWith('.d.ts')) assert.deepEqual(await readFile(join(f.dist,path.slice(4))),bytes);
  await assert.rejects(readFile(join(f.dist,'index.ts')),{code:'ENOENT'});
  await writeFile(join(f.root,'src/assets/sample.png'), 'new bytes');
  assert.deepEqual(await readFile(join(f.dist,'assets/sample.png')),binary);
});

test('unchanged resource builds do not rewrite assets or their ownership manifest', bounds, async t => {
  const f=await fixture(t),source=await f.collectPluginSource(f.root);await f.copyPluginResources(source,f.dist);
  const paths=['page.module.css','.cormi-plugin-assets.json'];
  for(const p of paths) await utimes(join(f.dist,p),1000000000,1000000000);
  await f.copyPluginResources(source,f.dist);
  for(const p of paths) assert.equal((await stat(join(f.dist,p))).mtimeMs,1000000000000);
});

test('resource updates remove only previously owned missing assets and keep unrelated compiled output', bounds, async t => {
  const f=await fixture(t);await writeFile(join(f.root,'src/assets/old.svg'),'<svg/>');await f.copyPluginResources(await f.collectPluginSource(f.root),f.dist);
  await writeFile(join(f.dist,'untouched.js'),'USER_OUTPUT');
  await unlink(join(f.root,'src/assets/old.svg'));await writeFile(join(f.root,'src/page.module.css'),'.panel { border: 4px solid; }');
  await f.copyPluginResources(await f.collectPluginSource(f.root),f.dist);
  await assert.rejects(readFile(join(f.dist,'assets/old.svg')),{code:'ENOENT'});
  assert.equal(await readFile(join(f.dist,'untouched.js'),'utf8'),'USER_OUTPUT');
  assert.equal(await readFile(join(f.dist,'page.module.css'),'utf8'),'.panel { border: 4px solid; }');
});

test('a modified owned asset rejects the whole planned resource update before overwriting other assets', bounds, async t => {
  const f=await fixture(t);await f.copyPluginResources(await f.collectPluginSource(f.root),f.dist);
  const css=await readFile(join(f.dist,'page.module.css'));
  await writeFile(join(f.dist,'assets/plugin-mark.svg'),'USER_CHANGE');await writeFile(join(f.root,'src/page.module.css'),'NEW_CSS');
  await assert.rejects(f.copyPluginResources(await f.collectPluginSource(f.root),f.dist),/Previously generated resource changed/);
  assert.deepEqual(await readFile(join(f.dist,'page.module.css')),css);assert.equal(await readFile(join(f.dist,'assets/plugin-mark.svg'),'utf8'),'USER_CHANGE');
});

test('unowned resources and compiled declaration collisions are never silently adopted', bounds, async t => {
  const f=await fixture(t);await mkdir(f.dist);await writeFile(join(f.dist,'assets.d.ts'),'USER_DECLARATION');
  await assert.rejects(f.copyPluginResources(await f.collectPluginSource(f.root),f.dist),/not owned/);
  assert.equal(await readFile(join(f.dist,'assets.d.ts'),'utf8'),'USER_DECLARATION');
  await assert.rejects(readFile(join(f.dist,'page.module.css')),{code:'ENOENT'});
});

test('asset symlinks and hard links are refused while the linked original remains unchanged', bounds, async t => {
  const f=await fixture(t),file=join(f.root,'original.svg');await writeFile(file,'ORIGINAL');
  const linked=join(f.root,'src/assets/link.svg');await symlink(file,linked);
  await assert.rejects(f.collectPluginSource(f.root),/Links/);await unlink(linked);await link(file,linked);
  await assert.rejects(f.collectPluginSource(f.root),/independent/);assert.equal(await readFile(file,'utf8'),'ORIGINAL');
});

test('private files, unsupported preprocessors and oversized binary assets fail source admission', bounds, async t => {
  const f=await fixture(t);
  for(const [name,data,pattern] of [
    ['.env',Buffer.from('SECRET'),/Private/],['unsupported.scss',Buffer.from('$x: 1;'),/supported CSS/],['large.woff2',Buffer.alloc(1024*1024+1),/budget/],
  ] as const) {const p=join(f.root,'src/assets',name);await writeFile(p,data);await assert.rejects(f.collectPluginSource(f.root),pattern);await unlink(p);}
});

test('resource output symlinks and forged ownership paths cannot cause writes outside the build directory', bounds, async t => {
  const f=await fixture(t),other=join(f.root,'outside');await mkdir(other);await symlink(other,f.dist);
  await assert.rejects(f.copyPluginResources(await f.collectPluginSource(f.root),f.dist),/cannot be a link/);await unlink(f.dist);await mkdir(f.dist);
  await writeFile(join(f.dist,'.cormi-plugin-assets.json'),JSON.stringify({format:'cormi:plugin-resources:1',files:{'../outside/secret.svg':'a'.repeat(64)}}));
  await assert.rejects(f.copyPluginResources(await f.collectPluginSource(f.root),f.dist),/Invalid resource ownership/);
});

test('plugin template retains stylesheet side effects and keeps assets inside the package rather than public', () => {
  const files=pluginTemplateFiles('@example/assets');
  assert.match(files['src/page.tsx']!,/import styles from '\.\/page\.module\.css'/);
  assert.match(files['src/page.tsx']!,/import illustration from '\.\/assets\/plugin-mark.svg'/);
  assert.doesNotMatch(files['src/page.tsx']!,/new URL\(/);
  assert.deepEqual(pluginManifest('@example/assets',{},{}).sideEffects,['**/*.css']);
  assert.ok(!Object.keys(files).some(p=>p.startsWith('public/')));
});

test('plugin build rejects a linked output directory before invoking its compiler', bounds, async t => {
  const f=await fixture(t),outside=join(f.root,'outside');await mkdir(outside);await symlink(outside,f.dist);
  // Compiler sentinel checks admission order, not TypeScript behavior (covered by real package tests).
  const compiler=join(f.root,'node_modules/typescript/bin/tsc');await mkdir(dirname(compiler),{recursive:true});
  await writeFile(compiler,"require('node:fs').writeFileSync('compiler-ran.txt','BAD');");
  const result=spawnSync(process.execPath,[join(f.root,'scripts/build.mjs')],{cwd:f.root,encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);
  await assert.rejects(readFile(join(f.root,'compiler-ran.txt')),{code:'ENOENT'});
});

test('removing a source resource cannot delete a manually modified owned output or partially apply siblings', bounds, async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'src/assets/retired.svg'), '<svg/>');
  await f.copyPluginResources(await f.collectPluginSource(f.root), f.dist);
  const manifest = await readFile(join(f.dist, '.cormi-plugin-assets.json'));
  const css = await readFile(join(f.dist, 'page.module.css'));
  await unlink(join(f.root, 'src/assets/retired.svg'));
  await writeFile(join(f.dist, 'assets/retired.svg'), 'USER_REPLACEMENT');
  await writeFile(join(f.root, 'src/page.module.css'), '.panel { border: 9px solid; }');
  await writeFile(join(f.root, 'src/assets/new.svg'), '<svg/>');
  await assert.rejects(f.copyPluginResources(await f.collectPluginSource(f.root), f.dist), /Previously generated resource changed/);
  assert.equal(await readFile(join(f.dist, 'assets/retired.svg'), 'utf8'), 'USER_REPLACEMENT');
  assert.deepEqual(await readFile(join(f.dist, 'page.module.css')), css);
  assert.deepEqual(await readFile(join(f.dist, '.cormi-plugin-assets.json')), manifest);
  await assert.rejects(readFile(join(f.dist, 'assets/new.svg')), { code: 'ENOENT' });
});

test('the aggregate resource budget rejects many individually admissible files', bounds, async t => {
  const f = await fixture(t);
  for (let i = 0; i < 9; i++) await writeFile(join(f.root, `src/assets/budget-${i}.png`), Buffer.alloc(1024 * 1024));
  await assert.rejects(f.collectPluginSource(f.root), /Source budget exceeded/);
  await assert.rejects(stat(f.dist), { code: 'ENOENT' });
});

test('source changes during compilation are rejected before copying mixed-generation resources', bounds, async t => {
  const f = await fixture(t);
  await f.copyPluginResources(await f.collectPluginSource(f.root), f.dist);
  const css = await readFile(join(f.dist, 'page.module.css'));
  const manifest = await readFile(join(f.dist, '.cormi-plugin-assets.json'));
  const compiler = join(f.root, 'node_modules/typescript/bin/tsc');
  await mkdir(dirname(compiler), { recursive: true });
  // Deterministic interleaving probe: real TypeScript is exercised by the independent consumer suite.
  await writeFile(compiler, "require('node:fs').writeFileSync('src/page.module.css', '.panel { border: 7px solid; }');");
  const result = spawnSync(process.execPath, [join(f.root, 'scripts/build.mjs')], { cwd: f.root, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Plugin source changed during build/);
  assert.deepEqual(await readFile(join(f.dist, 'page.module.css')), css);
  assert.deepEqual(await readFile(join(f.dist, '.cormi-plugin-assets.json')), manifest);
});
