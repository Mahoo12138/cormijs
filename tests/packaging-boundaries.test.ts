import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReactConsumer, validatePacked, type LocalKit, type PackageManifest } from '../scripts/packaging.js';

function packed() {
  const manifest: PackageManifest = { name: '@cormijs/test', version: '0.0.1', private: true, type: 'module',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } };
  const files = new Map([['package.json', Buffer.from(JSON.stringify(manifest))],
    ['dist/index.js', Buffer.from('export const value=1;')], ['dist/index.d.ts', Buffer.from('export declare const value: number;')]]);
  return { manifest, files, versions: new Map([[manifest.name, manifest.version]]) };
}
function kit(): LocalKit {
  return { format: 'cormi:local-kit:1', packages: ['cormijs', '@cormijs/core', '@cormijs/runtime', '@cormijs/preset-react-vite']
    .map(name => ({ name, version: '0.0.1', file: 'tarballs/' + name.replace(/[@/]/g, '-') + '.tgz', sha256: '', contentSha256: '', files: 0, bytes: 0 })),
    compatibility: { package: 'cordis@4.0.0-rc.11', patch: 'compatibility/cordis.patch', sha256: '', runtimeModified: false },
    publicationEligible: false, blockers: [] };
}
async function template() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-pack-boundary-')));
  const base = join(root, 'examples/basic'); await mkdir(join(base, 'src'), { recursive: true });
  await writeFile(join(base, 'src/index.tsx'), 'export default () => null;');
  await writeFile(join(base, 'index.html'), '<div id="root"></div>');
  await writeFile(join(base, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  return { root, base, output: join(root, 'app'), async close() { await rm(root, { recursive: true, force: true }); } };
}

test('packed source trees reject package-manager secrets and private key files', () => {
  for (const name of ['src/.npmrc', 'src/.yarnrc.yml', 'src/id_rsa', 'src/client.pem', 'src/client.pfx', 'src/.cormi/run-a/config.mjs']) {
    const f = packed(); f.files.set(name, Buffer.from('PRIVATE_SENTINEL'));
    assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /Private|Sensitive/, name);
  }
});
test('the archive version must match the workspace version recorded in the kit', () => {
  const f = packed(); f.manifest.version = '9.9.9';
  assert.throws(() => validatePacked(f.manifest, f.files, f.versions), /version/i);
});
test('React trial templates reject private files before creating the destination', async () => {
  const f = await template();
  try {
    await writeFile(join(f.base, 'src/.env.local'), 'PRIVATE_SENTINEL');
    await assert.rejects(createReactConsumer(f.root, kit(), f.output), /Private|Sensitive/);
    assert.equal(existsSync(f.output), false);
    assert.equal(await readFile(join(f.base, 'src/.env.local'), 'utf8'), 'PRIVATE_SENTINEL');
  } finally { await f.close(); }
});
test('React trial templates reject a symlinked source root instead of delivering workspace links', async () => {
  const f = await template();
  try {
    await rm(join(f.base, 'src'), { recursive: true });
    const external = join(f.root, 'original-source'); await mkdir(external);
    await writeFile(join(external, 'index.tsx'), 'export default () => null;');
    await symlink(external, join(f.base, 'src'), 'dir');
    await assert.rejects(createReactConsumer(f.root, kit(), f.output), /link|directory/i);
    assert.equal(existsSync(f.output), false);
    assert.equal(await readFile(join(external, 'index.tsx'), 'utf8'), 'export default () => null;');
  } finally { await f.close(); }
});
test('an ordinary React trial template copies independent files and refuses an existing destination', async () => {
  const f = await template();
  try {
    await createReactConsumer(f.root, kit(), f.output);
    assert.equal(await readFile(join(f.output, 'src/index.tsx'), 'utf8'), 'export default () => null;');
    await writeFile(join(f.base, 'src/index.tsx'), 'changed source');
    assert.equal(await readFile(join(f.output, 'src/index.tsx'), 'utf8'), 'export default () => null;');
    await assert.rejects(createReactConsumer(f.root, kit(), f.output), { code: 'EEXIST' });
  } finally { await f.close(); }
});
