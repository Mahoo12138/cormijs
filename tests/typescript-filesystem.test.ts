import test from 'node:test';
import assert from 'node:assert/strict';
import * as ts from 'typescript';
import { join } from 'node:path';
import { checkingSystem } from '../packages/plugin-typescript/src/filesystem.js';
import { solution, diskFiles } from './typescript-helpers.js';
import { hasCode } from './helpers.js';

const fresh = (root: string) => checkingSystem(ts, root, new AbortController().signal);

test('a previously absent module-resolution candidate cannot appear unnoticed before acceptance', async t => {
  const f = await solution(t), io = fresh(f.root), candidate = join(f.root, 'lib/src/preferred.ts');
  assert.equal(io.system.fileExists(candidate), false);
  await f.write('lib/src/preferred.ts', 'export const invalid: number = "changed";');
  assert.throws(() => io.verify(), hasCode('TYPECHECK_INPUT_CHANGED'));
});

test('typecheck input observation rejects changed source text and inherited config text', async t => {
  const f = await solution(t), io = fresh(f.root);
  io.system.readFile(join(f.root, 'lib/src/index.ts'));
  await f.write('lib/src/index.ts', 'export const changed = true;');
  assert.throws(() => io.verify(), hasCode('TYPECHECK_INPUT_CHANGED'));
  const inherited = fresh(f.root); inherited.system.readFile(join(f.root, 'tsconfig.base.json'));
  await f.write('tsconfig.base.json', { compilerOptions: { strict: false } });
  assert.throws(() => inherited.verify(), hasCode('TYPECHECK_INPUT_CHANGED'));
});

test('absent compiler inputs and glob membership changes invalidate a typecheck snapshot', async t => {
  const f = await solution(t), absent = fresh(f.root);
  assert.equal(absent.system.readFile(join(f.root, 'new-config.json')), undefined);
  await f.write('new-config.json', {});
  assert.throws(() => absent.verify(), hasCode('TYPECHECK_INPUT_CHANGED'));
  const io = fresh(f.root); io.system.readDirectory(join(f.root, 'lib/src'), ['.ts'], [], ['**/*']);
  await f.write('lib/src/added.ts', 'export const invalid: string = 1;');
  assert.throws(() => io.verify(), hasCode('TYPECHECK_INPUT_CHANGED'));
});

test('virtual writes support directory resolution, isolate invocations, and never touch original files', async t => {
  const f = await solution(t), before = await diskFiles(f.root), io = fresh(f.root), file = join(f.root, 'lib/dist/index.d.ts');
  io.system.writeFile(file, 'export declare const value: number;');
  assert.equal(io.system.readFile(file), 'export declare const value: number;');
  assert.ok(io.system.directoryExists(join(f.root, 'lib/dist')));
  assert.ok(io.system.getDirectories(join(f.root, 'lib')).includes('dist'));
  assert.equal(fresh(f.root).system.fileExists(file), false);
  assert.deepEqual(await diskFiles(f.root), before);
  assert.throws(() => io.system.deleteFile?.(file), hasCode('TYPECHECK_WRITE_FORBIDDEN'));
});

test('virtual output cannot overwrite a read input or escape the application root', async t => {
  const f = await solution(t), io = fresh(f.root), input = join(f.root, 'lib/src/index.ts');
  io.system.readFile(input);
  assert.throws(() => io.system.writeFile(input, 'replacement'), hasCode('TYPECHECK_OUTPUT_CONFLICT'));
  assert.throws(() => io.system.writeFile(join(f.root, '../outside.d.ts'), 'replacement'), hasCode('TYPECHECK_OUTPUT_CONFLICT'));
});
