import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeTemplates, planGeneration } from '@cormijs/plugin-react';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('generator plans page, component, model, API and mock files with flag parsing', () => {
  assert.deepEqual(planGeneration(['page', 'about-us']).files.map(file => file.path), ['src/pages/about-us.tsx']);
  assert.match(planGeneration(['component', 'profile-card']).files[0]!.content, /export default function ProfileCard\(/);
  assert.equal(planGeneration(['model', 'counter']).files[0]!.path, 'src/models/counter.ts');
  assert.match(planGeneration(['model', 'counter']).files[0]!.content, /export default function useCounter\(/);
  assert.equal(planGeneration(['api', 'health-check']).files[0]!.path, 'src/api/health-check.ts');
  assert.match(planGeneration(['api', 'health-check']).files[0]!.content, /Response\.json\(\{ ok: true, method: request\.method \}\)/);
  assert.equal(planGeneration(['mock', 'health-check']).files[0]!.path, 'mock/health-check.ts');
  assert.match(planGeneration(['mock', 'health-check']).files[0]!.content, /'GET \/api\/health-check'/);
  const custom = normalizeTemplates({ note: { path: 'src/notes/{{kebab}}.md', content: '# {{pascal}} ({{name}})\n' } });
  const note = planGeneration(['note', 'Hello-World'], custom);
  assert.deepEqual(note.files, [{ path: 'src/notes/hello-world.md', content: '# HelloWorld (Hello-World)\n' }]);
  const forced = planGeneration(['page', 'about', '--force', '--dry-run']);
  assert.equal(forced.force, true); assert.equal(forced.dryRun, true);
  for (const templates of [{ page: { path: 'x', content: 'y' } }, { 'bad kind': { path: 'x', content: 'y' } }, { note: { path: '../escape', content: 'x' } }, { note: { path: 'x', content: 1 } }, { note: { path: 'x', content: 'y' }, other: { path: 'x', content: 'y' } }]) {
    if (templates.other) { for (let index = 2; index < 18; index++) (templates as any)[`kind${index}`] = { path: 'x', content: 'y' }; }
    assert.throws(() => normalizeTemplates(templates), hasCode('GENERATE_INVALID'), JSON.stringify(templates));
  }
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
  const api = run(['generate', 'api', 'health']);
  assert.equal(api.status, 0, api.stderr);
  assert.match(await readFile(join(root, 'src/api/health.ts'), 'utf8'), /export default function handler\(request: Request\)/);
  const mock = run(['generate', 'mock', 'health']);
  assert.equal(mock.status, 0, mock.stderr);
  assert.match(await readFile(join(root, 'mock/health.ts'), 'utf8'), /'GET \/api\/health'/);
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
