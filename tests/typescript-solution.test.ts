import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTypes } from '@cormijs/plugin-typescript';
import { CormiError } from '@cormijs/core';
import { solution, diskFiles } from './typescript-helpers.js';
const signal = () => new AbortController().signal;

test('solution typechecking checks referenced projects from clean sources without emitting onto disk', async t => {
  const f = await solution(t), before = await diskFiles(f.root);
  const result = await checkTypes(f.root, [], signal());
  assert.equal(result.compiler, 'typescript'); assert.equal(result.files, 3);
  assert.deepEqual(await diskFiles(f.root), before);
});

test('a solution leaf cannot silently skip its own errors through noCheck or a reference-only root', async t => {
  const f = await solution(t);
  await f.write('tools/tsconfig.tool.json', { extends: '../tsconfig.base.json', compilerOptions: { noEmit: true, noCheck: true }, include: ['src'] });
  await f.write('tools/src/tool.ts', 'export const name: string = 42;');
  const before = await diskFiles(f.root);
  await assert.rejects(checkTypes(f.root, [], signal()), error => error instanceof CormiError && error.code === 'TYPECHECK_FAILED'
    && /tools\/src\/tool.ts.*TS2322/.test(error.message));
  assert.deepEqual(await diskFiles(f.root), before);
});
