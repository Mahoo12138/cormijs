import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function project(t: TestContext, bins: Record<string, string>) {
  const root = await realpath(await mkdtemp(join(process.cwd(), '.cache/tools-')));
  await mkdir(join(root, 'node_modules/.bin'), { recursive: true });
  await writeFile(join(root, 'cormi.config.ts'), `import { defineConfig } from 'cormijs';
import { toolPlugin } from '@cormijs/plugin-react';
export default defineConfig({
  plugins: [{ id: 'tools', plugin: toolPlugin, options: {
    lint: { bin: 'fake-lint' },
    format: { bin: 'fake-format', args: ['--write'] },
  } }],
});
`);
  for (const [name, body] of Object.entries(bins)) {
    const file = join(root, 'node_modules/.bin', name);
    await writeFile(file, body);
    await chmod(file, 0o755);
  }
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = (args: string[], passthrough: string[] = []) => spawnSync(process.execPath,
    ['packages/cormi/dist/cli.js', ...args, '--root', root, ...(passthrough.length ? ['--', ...passthrough] : [])],
    { cwd: process.cwd(), encoding: 'utf8' });
  return { root, run };
}

const fake = (label: string) => `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nconsole.log('${label}:' + args.join(' '));\nif (args.includes('--fail')) process.exit(3);\n`;

test('lint and format run the project binaries with defaults and caller arguments', async t => {
  const f = await project(t, { 'fake-lint': fake('lint'), 'fake-format': fake('format') });
  const lint = f.run(['lint', '--json']);
  assert.equal(lint.status, 0, lint.stderr);
  assert.match(lint.stdout, /"tool":"lint"/);
  assert.match(lint.stderr, /lint:/);
  const format = f.run(['format', '--json'], ['--check', 'src']);
  assert.equal(format.status, 0, format.stderr);
  assert.match(format.stderr, /format:--write --check src/);
});

test('a failing or missing tool fails the command with a coded error', async t => {
  const f = await project(t, { 'fake-lint': fake('lint') });
  const failed = f.run(['lint'], ['--fail']);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /TOOL_FAILED/);
  assert.match(failed.stderr, /code 3/);
  const missing = f.run(['format']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /TOOL_MISSING/);
});
