import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePacked, validateDeclarationPatch, packagePath, consumerManifest, packWorkspace, contentDigest, type LocalKit, type PackageManifest } from '../scripts/packaging.js';

function fixture() {
  const manifest: PackageManifest = { name: '@cormijs/test', version: '0.0.1', private: true, type: 'module', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } };
  const files = new Map([['package.json', Buffer.from(JSON.stringify(manifest))], ['dist/index.js', Buffer.from('export const answer=42;')], ['dist/index.d.ts', Buffer.from('export declare const answer: number;')]]);
  return { manifest, files, versions: new Map([['@cormijs/test', '0.0.1']]) };
}
test('package inspection accepts closed exports and rejects missing entry points and workspace dependency leakage', () => {
  const f = fixture(); validatePacked(f.manifest, f.files, f.versions);
  f.files.delete('dist/index.js'); assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /Missing export/);
  const g = fixture(); g.manifest.dependencies = { other: 'workspace:*' }; assert.throws(() => validatePacked(g.manifest, g.files, g.versions), /Unconverted dependency/);
});
test('source maps cannot point to absent or escaping sources', () => {
  const f = fixture(); f.files.set('dist/index.js.map', Buffer.from(JSON.stringify({ sources: ['../src/index.ts'] })));
  assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /Broken source map/);
  f.files.set('src/index.ts', Buffer.from('export const answer=42;')); validatePacked(f.manifest, f.files, f.versions);
  f.files.set('dist/index.js.map', Buffer.from(JSON.stringify({ sources: ['../../secret'] })));
  assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /Invalid package path/);
});
test('absolute source-map references are rejected even when embedded source text is present', () => {
  const f = fixture();
  for (const source of ['/private/source.ts', 'C:/source.ts', 'file:///private/source.ts']) {
    f.files.set('dist/index.js.map', Buffer.from(JSON.stringify({ sources: [source], sourcesContent: ['code'] })));
    assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /Absolute source map/);
  }
});
test('local kit creation refuses an existing destination without modifying its contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cormi-pack-admission-'));
  try {
    const output = join(root, 'delivery'); await mkdir(output); await writeFile(join(output, 'keep.txt'), 'user data');
    await assert.rejects(packWorkspace(root, output), { code: 'EEXIST' });
    assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'user data');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('compiled imports require declared dependencies, not workspace devDependencies', () => {
  const f = fixture(); f.files.set('dist/index.js', Buffer.from("export { value } from 'undeclared';")); f.manifest.devDependencies = { undeclared: '1.0.0' };
  assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /Undeclared dependency/);
  f.manifest.dependencies = { undeclared: '1.0.0' }; validatePacked(f.manifest, f.files, f.versions);
  f.files.set('dist/index.js', Buffer.from("export {value} from './missing.js'")); assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /Missing relative module/);
});
test('package file names reject traversal, secrets, build debris and accidental public-release changes', () => {
  for (const path of ['../bad', '/absolute', 'a/../../bad', 'a\\b', 'a\nfile']) assert.throws(() => packagePath(path));
  const f = fixture(); f.files.set('src/.env.local', Buffer.from('secret')); assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /Private/);
  f.files.delete('src/.env.local'); f.manifest.private = false; assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /publishing guard/);
});
test('CLI bin requires a real executable Node entry with a shebang', () => {
  const f = fixture(); f.manifest.bin = { cormi: './dist/cli.js' }; assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /shebang/);
  f.files.set('dist/cli.js', Buffer.from('#!/usr/bin/env node\nconsole.log(42)')); validatePacked(f.manifest, f.files, f.versions);
});
test('Cordis compatibility patch is constrained to declaration extension repairs', async () => {
  const patch = await readFile('patches/cordis@4.0.0-rc.11.patch', 'utf8'); assert.equal(validateDeclarationPatch(patch), 9);
  assert.throws(() => validateDeclarationPatch(patch.replace('+++ b/lib/utils.d.ts', '+++ b/lib/index.js')));
  assert.throws(() => validateDeclarationPatch(patch.replace("+import type { Context, Service } from './index.js';", "+export const hacked = true;")), /only add NodeNext/);
});
test('semantic package fingerprints normalize dependency order but preserve export-condition order', () => {
  const f = fixture(), a = new Map(f.files), b = new Map(f.files);
  a.set('package.json', Buffer.from(JSON.stringify({...f.manifest, dependencies: {alpha: '1', beta: '2'}})));
  b.set('package.json', Buffer.from(JSON.stringify({...f.manifest, dependencies: {beta: '2', alpha: '1'}})));
  assert.equal(contentDigest(a), contentDigest(b));
  b.set('package.json', Buffer.from(JSON.stringify({...f.manifest, exports: {'.': {import: './dist/index.js', types: './dist/index.d.ts'}}, dependencies: {alpha: '1', beta: '2'}})));
  assert.notEqual(contentDigest(a), contentDigest(b));
});
test('consumer profile keeps transitive packages transitive and makes the root patch explicit', () => {
  const kit = { packages: ['cormijs', '@cormijs/core', '@cormijs/runtime', '@cormijs/preset-react-vite'].map(name => ({name,file:'tarballs/'+name.replace('/', '-')+'.tgz'})), compatibility: {package:'cordis@4.0.0-rc.11',patch:'compatibility/cordis.patch'} } as LocalKit;
  const full = consumerManifest(kit, 'react'); assert.equal(full.dependencies['@cormijs/core'], undefined);
  assert.ok(full.pnpm.overrides['@cormijs/core']); assert.ok(full.pnpm.patchedDependencies);
  assert.equal(consumerManifest(kit, 'core', false).pnpm.patchedDependencies, undefined);
});
