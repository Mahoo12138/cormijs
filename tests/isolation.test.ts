import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

test('compiled core and its runtime dependencies work in a physical isolated consumer with no Vite', { timeout: 15000 }, async () => {
  // A real copy outside the workspace: no symlink or ancestor node_modules can supply Vite.
  const temp = await mkdtemp(join(tmpdir(), 'cormi-isolated-'));
  const copied = new Set<string>();
  async function copyPackage(path: string): Promise<void> {
    const source = await realpath(path);
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as { name: string; dependencies?: Record<string, string> };
    if (copied.has(manifest.name)) return;
    copied.add(manifest.name);
    const destination = join(temp, 'node_modules', manifest.name);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, dereference: true, filter: item => {
      const parts = relative(source, item).split(sep);
      return !parts.includes('node_modules') && !parts.includes('.git') && !parts.includes('.cache');
    } });
    const require = createRequire(join(source, 'package.json'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      const candidate = require.resolve.paths(dependency)?.map(parent => join(parent, dependency))
        .find(path => existsSync(join(path, 'package.json')));
      assert.ok(candidate, `Missing runtime dependency ${dependency}`);
      await copyPackage(candidate);
    }
  }
  try {
    await copyPackage(resolve('packages/core'));
    assert.deepEqual([...copied].sort(), ['@cormijs/core', '@standard-schema/spec', 'cordis', 'cosmokit']);
    await writeFile(join(temp, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ProjectRuntime } from '@cormijs/core';
const require = createRequire(import.meta.url);
assert.throws(() => require.resolve('vite'), { code: 'MODULE_NOT_FOUND' });
const host = new ProjectRuntime();
host.mount('provider', ctx => { ctx.provide('value', 42); });
host.mount('consumer', { inject: ['value'], apply: ctx => { assert.equal(ctx.get('value'), 42); } });
await host.ready(); await host.dispose();
console.log('ISOLATED_CORE_OK');
`);
    const child = await exec(process.execPath, [join(temp, 'smoke.mjs')], { cwd: temp, timeout: 8000, env: { ...process.env, NODE_PATH: '' } });
    assert.match(child.stdout, /ISOLATED_CORE_OK/);
    await writeFile(join(temp, 'types.mts'), `import { ProjectRuntime, type Context } from '@cormijs/core';\nconst host: ProjectRuntime = new ProjectRuntime();\nconst ctx: Context = host.ctx;\nctx.provide('answer', 42);\nawait host.ready();\n`);
    const compiler = resolve('node_modules/typescript/bin/tsc');
    await exec(process.execPath, [compiler, '--noEmit', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', 'types.mts'], { cwd: temp, timeout: 8000 });
  } finally { await rm(temp, { recursive: true, force: true }); }
});
