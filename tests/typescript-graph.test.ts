import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { checkTypes } from '@cormijs/plugin-typescript';
import { CormiError } from '@cormijs/core';
import { solution, diskFiles } from './typescript-helpers.js';
const signal = () => new AbortController().signal;
const has = (code: string) => (error: unknown) => error instanceof CormiError && error.code === code;
const diagnostic = (pattern: RegExp) => (error: unknown) => error instanceof CormiError && error.code === 'TYPECHECK_FAILED' && pattern.test(error.message);

test('fresh in-memory declarations override stale disk output and propagate changed dependency types on each invocation', async t => {
  const f = await solution(t);
  await f.write('lib/dist/index.d.ts', 'export declare const value: { amount: string };');
  await f.write('lib/tsconfig.tsbuildinfo', '{"version":"stale"}');
  const first = await checkTypes(f.root, [], signal()); assert.equal(first.virtualDeclarations, 1); assert.equal(first.projects.length, 4);
  await f.write('lib/src/index.ts', 'export const value: {amount:string} = {amount:"changed"};');
  const before = await diskFiles(f.root);
  await assert.rejects(checkTypes(f.root, [], signal()), diagnostic(/app\/src\/index.ts.*TS2322/));
  assert.deepEqual(await diskFiles(f.root), before);
});

test('solution branches preserve independent lib and ambient environments instead of merging source roots', async t => {
  const f = await solution(t);
  await f.write('tools/tsconfig.tool.json', { extends: '../tsconfig.base.json', compilerOptions: { lib: ['ES2023'], noEmit: true }, include: ['src'] });
  await f.write('tools/src/tool.ts', 'export const title = document.title;');
  await assert.rejects(checkTypes(f.root, [], signal()), diagnostic(/tools\/src\/tool.ts.*TS2584/));
});

test('a broken referenced library fails even when no consumer imports its invalid source', async t => {
  const f = await solution(t); await f.write('lib/src/unused.ts', 'export const broken: number = "not-number";');
  await assert.rejects(checkTypes(f.root, [], signal()), diagnostic(/lib\/src\/unused.ts.*TS2322/));
});

test('nested solutions and diamond references are traversed once and retain native dependency declarations', async t => {
  const f = await solution(t);
  await f.write('tools/tsconfig.tool.json', { extends: '../tsconfig.base.json', compilerOptions: { noEmit: true }, files: ['src/tool.ts'], references: [{ path: '../lib' }] });
  await f.write('tools/src/tool.ts', "import {value} from '../../lib/src/index';export const name = value.amount;");
  await f.write('group/tsconfig.json', { files: [], references: [{ path: '../app' }, { path: '../tools/tsconfig.tool.json' }] });
  await f.write('tsconfig.json', { files: [], references: [{ path: './group' }] });
  const result = await checkTypes(f.root, [], signal()); assert.equal(result.projects.length, 5); assert.equal(result.files, 3); assert.equal(result.virtualDeclarations, 1);
});

test('referenced implementation projects still enforce composite and noEmit dependency constraints', async t => {
  const f = await solution(t);
  const lib = JSON.parse(await readFile(join(f.root, 'lib/tsconfig.json'), 'utf8'));
  lib.compilerOptions.noEmit = true; await f.write('lib/tsconfig.json', lib);
  await assert.rejects(checkTypes(f.root, [], signal()), diagnostic(/TS6310/));
  lib.compilerOptions.noEmit = false; lib.compilerOptions.composite = false; await f.write('lib/tsconfig.json', lib);
  await assert.rejects(checkTypes(f.root, [], signal()), diagnostic(/TS6306/));
});

test('reference cycles and missing project configs fail before any persistent output changes', async t => {
  const f = await solution(t), lib = JSON.parse(await readFile(join(f.root, 'lib/tsconfig.json'), 'utf8'));
  lib.references = [{ path: '../app' }]; await f.write('lib/tsconfig.json', lib);
  let before = await diskFiles(f.root); await assert.rejects(checkTypes(f.root, [], signal()), has('TYPECHECK_REFERENCE_CYCLE')); assert.deepEqual(await diskFiles(f.root), before);
  await f.write('tsconfig.json', { files: [], references: [{ path: './missing.json' }] }); before = await diskFiles(f.root);
  await assert.rejects(checkTypes(f.root, [], signal()), diagnostic(/missing.json/)); assert.deepEqual(await diskFiles(f.root), before);
});

test('project paths cannot escape the application or hide behind a symbolic alias', async t => {
  const f = await solution(t);
  await f.write('tsconfig.json', { files: [], references: [{ path: '../outside/tsconfig.json' }] });
  await assert.rejects(checkTypes(f.root, [], signal()), has('TYPECHECK_PROJECT_INVALID'));
  await symlink(join(f.root, 'lib/tsconfig.json'), join(f.root, 'alias.json'));
  await f.write('tsconfig.json', { files: [], references: [{ path: './alias.json' }] });
  await assert.rejects(checkTypes(f.root, [], signal()), has('TYPECHECK_PROJECT_INVALID'));
});

test('reference graphs have an explicit project budget instead of unbounded traversal', async t => {
  const f = await solution(t);
  for (let i = 0; i < 65; i++) await f.write(`chain/${i}.json`, { files: [], references: i === 64 ? [] : [{ path: `./${i + 1}.json` }] });
  await f.write('tsconfig.json', { files: [], references: [{ path: './chain/0.json' }] });
  await assert.rejects(checkTypes(f.root, [], signal()), has('TYPECHECK_LIMIT'));
});

test('virtual declaration targets cannot overlap another project or overwrite a checked source', async t => {
  const f = await solution(t);
  await f.write('other/tsconfig.json', { extends: '../tsconfig.base.json', compilerOptions: { composite: true, rootDir: 'src', outDir: '../lib/dist' }, include: ['src'] });
  await f.write('other/src/index.ts', 'export const other = 0;');
  await f.write('tsconfig.json', { files: [], references: [{ path: './lib' }, { path: './other' }] });
  const before = await diskFiles(f.root);
  await assert.rejects(checkTypes(f.root, [], signal()), has('TYPECHECK_OUTPUT_CONFLICT')); assert.deepEqual(await diskFiles(f.root), before);
});

test('an already cancelled check performs no output work and preserves the caller cancellation reason', async t => {
  const f = await solution(t), controller = new AbortController(), reason = new Error('TEST_CANCELLED'); controller.abort(reason);
  const before = await diskFiles(f.root); await assert.rejects(checkTypes(f.root, [], controller.signal), error => error === reason); assert.deepEqual(await diskFiles(f.root), before);
});
