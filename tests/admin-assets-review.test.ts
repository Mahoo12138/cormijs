import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptAssetReferences } from '../scripts/admin/assets.js';

const helperImport = "import { publicAsset } from 'src/utils/public-asset';\n";

test('asset migration refuses shadowing declarations including parameters, destructuring and foreign imports', () => {
  const sources = [
    'let publicAsset = (x: string) => x; const a="/assets/a.svg";',
    'var publicAsset = (x: string) => x; const a="/assets/a.svg";',
    'function view(publicAsset: unknown) { return "/assets/a.svg"; }',
    'const view = ({ publicAsset }: {publicAsset:unknown}) => "/assets/a.svg";',
    'import { other as publicAsset } from "other"; const a="/assets/a.svg";',
    helperImport + 'function view(publicAsset: unknown) { return "/assets/a.svg"; }',
  ];
  for (const source of sources) assert.throws(() => adaptAssetReferences('view.ts', source), /Conflicting asset helper binding/, source);
});

test('asset migration never turns module specifiers into public asset function calls', () => {
  for (const source of [
    'const a=import("/assets/a.js");',
    'const a=require("/assets/a.js");',
    'const a=require.resolve("/assets/a.js");',
    'const a=import.meta.resolve("/assets/a.js");',
    'type A=import("/assets/a.js").A;',
  ]) assert.throws(() => adaptAssetReferences('view.ts', source), /separate migration/, source);
});

test('an incremental migration reuses its verified helper import instead of duplicating the binding', () => {
  const first = adaptAssetReferences('view.ts', 'const a="/assets/a.svg";');
  const next = adaptAssetReferences('view.ts', first.code + '\nconst b="/assets/b.svg";');
  assert.equal(next.code.split(helperImport).length - 1, 1);
  assert.equal(next.edits.length, 1);
  assert.ok(next.code.includes('publicAsset("/assets/b.svg")'));
  assert.equal(adaptAssetReferences('view.ts', next.code).code, next.code);
});

test('helper-looking comments and text are not treated as bindings', () => {
  const source='// function publicAsset() is documentation only\nconst text="class publicAsset is only text";const a="/assets/a.svg";';
  const result=adaptAssetReferences('view.ts', source);
  assert.equal(result.edits.length, 1);
  assert.ok(result.code.includes('// function publicAsset() is documentation only'));
  assert.ok(result.code.includes('"class publicAsset is only text"'));
});

test('a same-named unbound or foreign helper call is not silently accepted as an earlier migration', () => {
  for (const source of [
    'const a=publicAsset("/assets/a.svg");',
    'import {publicAsset} from "other";const a=publicAsset("/assets/a.svg");',
    'import type {publicAsset} from "src/utils/public-asset";const a=publicAsset("/assets/a.svg");',
  ]) assert.throws(() => adaptAssetReferences('view.ts', source), /helper binding/, source);
  const good=helperImport+'const a=publicAsset("/assets/a.svg");';
  assert.deepEqual(adaptAssetReferences('view.ts', good), {code:good,edits:[]});
});
