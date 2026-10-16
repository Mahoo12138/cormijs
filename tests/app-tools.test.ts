import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, stat, unlink, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { app, cli } from './launcher-helpers.js';

async function project(t: TestContext) {
  const f = await app(t), source = resolve('examples/basic');
  await cp(source, f.root, { recursive: true, filter: item => !relative(source, item).split(sep).some(part => ['node_modules', '.cormi', '.cormi.lock', 'dist'].includes(part)) });
  return f;
}
async function command(t: TestContext, root: string, name: string, expected = 0) {
  const c = cli(t, root, name, ['--startup-timeout', '30000']);
  assert.equal(await c.finish(30000), expected, JSON.stringify(c.events) + c.stderr);
  assert.equal(existsSync(join(root, '.cormi.lock')), false);
  return c;
}
const options = { timeout: 60000 };

test('typecheck prepares generated roots even when tsconfig excludes .cormi, and does not emit JS', options, async t => {
  const f = await project(t);
  const config = JSON.parse(await readFile(join(f.root, 'tsconfig.json'), 'utf8'));
  config.exclude = ['.cormi']; config.compilerOptions.noEmit = false;
  await f.write('tsconfig.json', JSON.stringify(config));
  const check = await command(t, f.root, 'typecheck');
  const result = check.events.find(event => event.type === 'result')!.data;
  assert.equal(result.compiler, 'typescript'); assert.equal(result.version, '5.9.3');
  assert.deepEqual(result.generatedFiles, ['.cormi/app.tsx', '.cormi/routes.d.ts']);
  assert.match(await readFile(join(f.root, '.cormi/routes.d.ts'), 'utf8'), /RouteParamsById/);
  assert.equal(existsSync(join(f.root, 'src/pages/index.js')), false);
  assert.equal(existsSync(join(f.root, '.cormi/app.js')), false);
});
test('type errors fail despite noCheck and transpilation succeeds independently', options, async t => {
  const f = await project(t);
  await f.write('src/pages/index.tsx', 'const count: number = "wrong"; export default function Page(){return <h1>{count}</h1>}');
  const config = JSON.parse(await readFile(join(f.root, 'tsconfig.json'), 'utf8')); config.compilerOptions.noCheck = true;
  await f.write('tsconfig.json', JSON.stringify(config));
  const check = await command(t, f.root, 'typecheck', 1);
  assert.ok(check.events.some(event => event.code === 'TYPECHECK_FAILED' && /src\/pages\/index.tsx.*TS2322/.test(event.message)));
  await command(t, f.root, 'build'); assert.ok(existsSync(join(f.root, 'dist/index.html')));
});
test('generated route types enforce inherited parameter names and unknown route IDs', options, async t => {
  const f = await project(t);
  await f.write('src/route-contract.ts', `import type { RouteId, RouteParams } from '../.cormi/routes';
const id: RouteId = 'file:src/pages/users/[id].tsx';
const params: RouteParams<typeof id> = { id: '42' };
void params;
`);
  await command(t, f.root, 'typecheck');
  await f.write('src/route-contract.ts', `import type { RouteId, RouteParams } from '../.cormi/routes';
const id: RouteId = 'unknown-route';
const params: RouteParams<'file:src/pages/users/[id].tsx'> = { slug: '42' };
void id; void params;`);
  const check = await command(t, f.root, 'typecheck', 1);
  assert.ok(check.events.some(event => event.code === 'TYPECHECK_FAILED' && event.message.includes('slug')));
});
test('typecheck includes generated lazy imports and rejects a non-component page export', options, async t => {
  const f = await project(t); await f.write('src/pages/about.tsx', 'export default 123;');
  const check = await command(t, f.root, 'typecheck', 1);
  assert.ok(check.events.some(event => event.code === 'TYPECHECK_FAILED' && event.message.includes('.cormi/app.tsx')));
});
test('inspect reads the last successful snapshot without generating or evaluating page sources', options, async t => {
  const f = await project(t); await command(t, f.root, 'prepare');
  const entry = join(f.root, '.cormi/app.tsx'), before = await stat(entry);
  await f.write('src/pages/[id].tsx', 'throw new Error("must not execute"); export default ()=>null;');
  await f.write('src/pages/[slug].tsx', 'throw new Error("must not execute"); export default ()=>null;');
  const inspection = await command(t, f.root, 'inspect');
  const result = inspection.events.find(event => event.type === 'result')!.data;
  assert.equal(result.basis, 'last-successful-generation'); assert.equal(result.freshness, 'source-not-reevaluated');
  assert.ok(result.summary.routes.some((route: { id: string }) => route.id.includes('users/[id]')));
  assert.equal((await stat(entry)).mtimeMs, before.mtimeMs);
  await command(t, f.root, 'prepare', 1);
  await command(t, f.root, 'inspect');
});
test('inspect fails on a mixed generated set instead of reporting it as coherent', options, async t => {
  const f = await project(t); await command(t, f.root, 'prepare');
  const types = join(f.root, '.cormi/routes.d.ts'); await writeFile(types, (await readFile(types, 'utf8')) + '\n// external change');
  const check = await command(t, f.root, 'inspect', 1);
  assert.ok(check.events.some(event => event.code === 'GENERATED_SET_INCONSISTENT'));
  await command(t, f.root, 'prepare'); await command(t, f.root, 'inspect');
});
test('missing inspect snapshot and unowned type file are never silently repaired or overwritten', options, async t => {
  const f = await project(t); const first = await command(t, f.root, 'inspect', 1);
  assert.ok(first.events.some(event => event.code === 'INSPECT_MISSING'));
  assert.equal(existsSync(join(f.root, '.cormi/app.tsx')), false);
  await f.write('.cormi/routes.d.ts', '// user owned');
  const prepare = await command(t, f.root, 'prepare', 1);
  assert.ok(prepare.events.some(event => event.code === 'GENERATED_NOT_OWNED'));
  assert.equal(await readFile(join(f.root, '.cormi/routes.d.ts'), 'utf8'), '// user owned');
});
test('typechecking and inspection are usable without a builder or Vite provider', options, async t => {
  const f = await project(t);
  await f.write('cormi.config.ts', `import { defineConfig } from 'cormijs';
import { reactPlugin } from '@cormijs/plugin-react';
import { typescriptPlugin } from '@cormijs/plugin-typescript';
import { inspectionPlugin } from '@cormijs/plugin-web';
export default defineConfig({plugins:[{id:'react',plugin:reactPlugin},{id:'types',plugin:typescriptPlugin},{id:'inspect',plugin:inspectionPlugin},
{id:'guard',plugin:{apply(ctx){if(ctx.get('builder') || ctx.get('vite')) throw new Error('unexpected builder')}}}]});`);
  await command(t, f.root, 'typecheck'); await command(t, f.root, 'inspect');
  assert.equal(existsSync(join(f.root, 'dist')), false);
});
test('missing tsconfig uses explicit defaults, while referenced solution configs fail clearly', options, async t => {
  const f = await project(t); await unlink(join(f.root, 'tsconfig.json'));
  await command(t, f.root, 'typecheck');
  await f.write('tsconfig.json', JSON.stringify({ files: [], references: [{ path: './referenced' }] }));
  const failed = await command(t, f.root, 'typecheck', 1);
  assert.ok(failed.events.some(event => event.code === 'TYPECHECK_REFERENCES_UNSUPPORTED'));
});
test('development serves the generated app but refuses inspection, type, staging and transaction files', options, async t => {
  const f = await project(t); await command(t, f.root, 'prepare');
  await mkdir(join(f.root, '.cormi-publish-test')); await f.write('.cormi-publish-test/transaction.json', 'PRIVATE-PUBLISH');
  await mkdir(join(f.root, '.cormi-publish.lock')); await f.write('.cormi-publish.lock/owner.json', 'PRIVATE-OWNER');
  const server = cli(t, f.root, 'dev', ['--startup-timeout', '30000']);
  const ready = await server.waitFor(event => event.type === 'ready', 0, 30000);
  for (const path of ['.cormi/inspect.jsonc', '.cormi/routes.d.ts', '.cormi-publish-test/transaction.json', '.cormi-publish.lock/owner.json']) {
    for (const query of ['', '?raw']) {
      const response = await fetch(new URL(path + query, ready.url));
      assert.equal(response.status, 403, path + query);
      assert.doesNotMatch(await response.text(), /PRIVATE-PUBLISH|PRIVATE-OWNER/);
    }
  }
  assert.equal((await fetch(new URL('.cormi/app.tsx', ready.url))).status, 200);
  assert.equal(await server.stop(), 0);
});
test('repeated CLI build replaces managed output and a failed build preserves it', options, async t => {
  const f = await project(t); await command(t, f.root, 'build');
  const second = await command(t, f.root, 'build');
  assert.equal(second.events.find(event => event.type === 'result')!.data.publication.replaced, true);
  const old = await readFile(join(f.root, 'dist/.cormi-build.json'), 'utf8');
  await f.write('src/pages/about.tsx', 'export default ( syntax error');
  await command(t, f.root, 'build', 1);
  assert.equal(await readFile(join(f.root, 'dist/.cormi-build.json'), 'utf8'), old);
  assert.deepEqual((await readdir(f.root)).filter(name => name.startsWith('.cormi-publish')), []);
});
