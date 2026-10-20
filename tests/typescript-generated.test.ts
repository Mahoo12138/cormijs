import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { app, cli } from './launcher-helpers.js';
import { diskFiles } from './typescript-helpers.js';
const settings = { timeout: 60000 };
async function project(t: TestContext, include = true, explicit = false) {
  const f = await app(t), source = resolve('examples/basic');
  await cp(source, f.root, { recursive: true, filter: item => !relative(source, item).split(sep).some(part => ['node_modules', '.cormi', '.cormi.lock', 'dist'].includes(part)) });
  const base = JSON.parse(await readFile(join(f.root, 'tsconfig.json'), 'utf8'));
  delete base.compilerOptions.allowImportingTsExtensions;
  base.include = include ? ['src', '.cormi/**/*'] : ['src']; base.exclude = include ? [] : ['.cormi'];
  await f.write('tsconfig.app.json', JSON.stringify(base));
  await f.write('tsconfig.node.json', JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, types: ['node'] }, files: ['cormi.config.ts'] }));
  await f.write('tsconfig.json', JSON.stringify({ files: [], references: [{ path: './tsconfig.node.json' }, { path: './tsconfig.app.json' }] }));
  await f.write('cormi.config.ts', `import {reactPlugin} from '@cormijs/plugin-react';import {typescriptPlugin} from '@cormijs/plugin-typescript';
export default {plugins:[{id:'react',plugin:reactPlugin},{id:'types',plugin:typescriptPlugin,options:${explicit ? "{generatedProject:'tsconfig.app.json'}" : '{}'}}]};`);
  return f;
}
async function command(t: TestContext, root: string, expected = 0) {
  const c = cli(t, root, 'typecheck', ['--startup-timeout', '30000']); assert.equal(await c.finish(30000), expected, JSON.stringify(c.events) + c.stderr);
  assert.equal(existsSync(join(root, '.cormi.lock')), false); return c;
}

test('a solution assigns generated roots to the browser project without contaminating the Node project', settings, async t => {
  const f = await project(t), c = await command(t, f.root), result = c.events.find(e => e.type === 'result')!.data;
  assert.equal(result.mode, 'solution'); assert.equal(result.projects.length, 3);
  assert.deepEqual(result.projects.filter((p: { generated: boolean }) => p.generated).map((p: { config: string }) => p.config), ['tsconfig.app.json']);
  assert.equal(existsSync(join(f.root, 'src/pages/index.js')), false); assert.equal(existsSync(join(f.root, 'tsconfig.app.tsbuildinfo')), false);
});

test('excluded generated roots require an explicit owner and still catch non-component exports', settings, async t => {
  const f = await project(t, false, false);
  const rejected = await command(t, f.root, 1); assert.ok(rejected.events.some(e => e.code === 'TYPECHECK_GENERATED_PROJECT_REQUIRED'));
  await f.write('cormi.config.ts', (await readFile(join(f.root, 'cormi.config.ts'), 'utf8')).replace('options:{}', "options:{generatedProject:'tsconfig.app.json'}"));
  await command(t, f.root);
  await f.write('src/pages/about.tsx', 'export default 123;'); const before = await diskFiles(f.root);
  const invalid = await command(t, f.root, 1); assert.ok(invalid.events.some(e => e.code === 'TYPECHECK_FAILED' && e.message.includes('.cormi/app.tsx')));
  assert.deepEqual(await diskFiles(f.root), before);
});

test('generated route parameter errors remain visible within a project-reference application', settings, async t => {
  const f = await project(t, false, true);
  await f.write('src/route-contract.ts', "import type {RouteParams} from '../.cormi/routes';const p: RouteParams<'file:src/pages/users/[id].tsx'> = {slug:'wrong'};void p;");
  const invalid = await command(t, f.root, 1); assert.ok(invalid.events.some(e => e.code === 'TYPECHECK_FAILED' && e.message.includes('slug')));
  await f.write('src/route-contract.ts', "import type {RouteParams} from '../.cormi/routes';const p: RouteParams<'file:src/pages/users/[id].tsx'> = {id:'42'};void p;");
  await command(t, f.root);
});

test('ambiguous generated ownership is rejected instead of picking the first project in reference order', settings, async t => {
  const f = await project(t);
  await f.write('tsconfig.second.json', await readFile(join(f.root, 'tsconfig.app.json'), 'utf8'));
  await f.write('tsconfig.json', JSON.stringify({ files: [], references: [{ path: './tsconfig.second.json' }, { path: './tsconfig.app.json' }] }));
  const invalid = await command(t, f.root, 1); assert.ok(invalid.events.some(e => e.code === 'TYPECHECK_GENERATED_PROJECT_REQUIRED'));
});

test('explicit generated ownership does not silently widen a composite application rootDir', settings, async t => {
  const f = await project(t, false, true), config = JSON.parse(await readFile(join(f.root, 'tsconfig.app.json'), 'utf8'));
  config.compilerOptions.composite = true; config.compilerOptions.rootDir = 'src'; await f.write('tsconfig.app.json', JSON.stringify(config));
  const invalid = await command(t, f.root, 1); assert.ok(invalid.events.some(e => e.code === 'TYPECHECK_FAILED' && /TS6059/.test(e.message)));
});
