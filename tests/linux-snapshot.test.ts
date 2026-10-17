import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourcePath, createSnapshot, verifySnapshot } from '../scripts/linux/snapshot.js';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-snapshot-')));
  await mkdir(join(root, 'src')); await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'package.json'), '{"private":true}');
  await writeFile(join(root, 'scripts/check.ts'), 'export const value = 1;');
  return { root, target: join(root, 'input'), clean: () => rm(root, { recursive: true, force: true }) };
}
test('Linux snapshot selects source only and never sends host caches, references, docs or npm credentials', () => {
  for (const file of ['package.json', 'packages/core/src/index.ts', 'tests/core.test.ts', 'scripts/linux/Dockerfile']) assert.equal(sourcePath(file), true);
  for (const file of ['.npmrc', '.env', 'cordis/packages/core/src/index.ts', 'umi/package.json', '.cache/run/result.json', 'docs/design.md', 'artifacts/result.json']) assert.equal(sourcePath(file), false);
  for (const file of ['../escape', '/absolute', 'C:/path', 'tests/../../escape', 'packages/core/src/.npmrc', 'examples/basic/src/private.key', 'scripts/node_modules/file.js']) assert.throws(() => sourcePath(file));
});
test('Linux snapshot copies independent files, replaces host npm settings, and detects changed source', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, '.npmrc'), '//registry.invalid/:_authToken=private');
    const snapshot = await createSnapshot(f.root, f.target, ['package.json', '.npmrc', 'scripts/check.ts']);
    await verifySnapshot(join(f.target, 'source'), snapshot); await verifySnapshot(f.root, snapshot, true);
    assert.doesNotMatch(await readFile(join(f.target, 'source/.npmrc'), 'utf8'), /private|authToken/);
    await writeFile(join(f.root, 'scripts/check.ts'), 'export const value = 2;');
    assert.match(await readFile(join(f.target, 'source/scripts/check.ts'), 'utf8'), /value = 1/);
    await assert.rejects(verifySnapshot(f.root, snapshot, true), /Source changed/);
    await assert.rejects(createSnapshot(f.root, f.target, ['package.json']), { code: 'EEXIST' });
  } finally { await f.clean(); }
});
test('Linux snapshot refuses symlink files, linked ancestors and hardlinks before admitting output', async () => {
  for (const kind of ['file', 'ancestor', 'hardlink']) {
    const f = await fixture();
    try {
      const source = join(f.root, 'src/value.ts'); await writeFile(source, 'export const secret=1');
      let candidate: string;
      if (kind === 'ancestor') { await symlink(join(f.root, 'src'), join(f.root, 'scripts/linked'), 'dir'); candidate = 'scripts/linked/value.ts'; }
      else { candidate = 'scripts/linked.ts'; if (kind === 'file') await symlink(source, join(f.root, candidate)); else await link(source, join(f.root, candidate)); }
      await assert.rejects(createSnapshot(f.root, f.target, ['package.json', candidate]), /regular independent|must not be a link/);
      await assert.rejects(readFile(join(f.target, 'snapshot.json')), { code: 'ENOENT' });
    } finally { await f.clean(); }
  }
});
