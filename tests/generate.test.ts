import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planGeneration } from '@cormijs/plugin-react';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('generator plans page, component and model files with flag parsing', () => {
  assert.deepEqual(planGeneration(['page', 'about-us']).files.map(file => file.path), ['src/pages/about-us.tsx']);
  assert.match(planGeneration(['component', 'profile-card']).files[0]!.content, /export default function ProfileCard\(/);
  assert.equal(planGeneration(['model', 'counter']).files[0]!.path, 'src/models/counter.ts');
  assert.match(planGeneration(['model', 'counter']).files[0]!.content, /export default function useCounter\(/);
  const forced = planGeneration(['page', 'about', '--force', '--dry-run']);
  assert.equal(forced.force, true); assert.equal(forced.dryRun, true);
  for (const input of [[], ['page'], ['widget', 'x'], ['page', '2bad'], ['page', 'a/b'], ['page', 'ok', '--clean'], ['page', 'ok', '--force', '--force']]) {
    assert.throws(() => planGeneration(input), hasCode('GENERATE_INVALID'), JSON.stringify(input));
  }
});

test('the generate command writes files once and only overwrites with --force', async t => {
  const root = await realpath(await mkdtemp(join(process.cwd(), '.cache/generate-cli-')));
  await writeFile(join(root, 'cormi.config.ts'), `import { defineConfig } from 'cormijs';
import { generatorPlugin } from '@cormijs/plugin-react';
export default defineConfig({ plugins: [{ id: 'app:generator', plugin: generatorPlugin }] });
`);
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = (args: string[], passthrough: string[] = []) => spawnSync(process.execPath,
    ['packages/cormi/dist/cli.js', ...args, '--root', root, ...(passthrough.length ? ['--', ...passthrough] : [])],
    { cwd: process.cwd(), encoding: 'utf8' });

  const first = run(['generate', 'page', 'about']);
  assert.equal(first.status, 0, first.stderr);
  assert.match(await readFile(join(root, 'src/pages/about.tsx'), 'utf8'), /export default function AboutPage\(\)/);
  const again = run(['generate', 'page', 'about']);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /GENERATE_EXISTS/);
  const forced = run(['generate', 'page', 'about'], ['--force']);
  assert.equal(forced.status, 0, forced.stderr);
  const dry = run(['generate', 'page', 'dry-run-only'], ['--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  await assert.rejects(readFile(join(root, 'src/pages/dry-run-only.tsx')), /ENOENT/);
  const bad = run(['generate', 'widget', 'x']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /GENERATE_INVALID/);
  const unknownFlag = run(['generate', 'page', 'about', '--force']);
  assert.equal(unknownFlag.status, 1, 'global flags stay strict unless passed after --');
});
