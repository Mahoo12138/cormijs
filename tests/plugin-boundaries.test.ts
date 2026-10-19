import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { forbiddenPackages, literalModuleEdges } from '../scripts/plugin-boundaries.js';

const rules: Record<string, string[]> = {
  core: ['cordis'], builder: ['cordis'], cormi: ['@cormijs/core','cordis','esbuild'],
  'plugin-web': ['@cormijs/core','@cormijs/builder','cordis'],
  'plugin-react': ['@cormijs/core','@cormijs/builder','@cormijs/routes','@cormijs/plugin-web','cordis','esbuild'],
  runtime: ['react','react-dom','react-router'],
};
test('core bootstrap and domain compilation keep explicit provider boundaries in manifests and source imports', async () => {
  let inspected = 0;
  for (const [name, packages] of Object.entries(rules)) {
    const allowed = new Set(packages), root = resolve('packages', name), manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });
    assert.deepEqual(forbiddenPackages(dependencies, allowed, name !== 'runtime'), [], name + ' manifest');
    async function walk(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
          inspected++;
          const edges = literalModuleEdges(await readFile(file, 'utf8'), file);
          assert.deepEqual(forbiddenPackages(edges, allowed, name !== 'runtime'), [], file);
          for (const edge of edges.filter(value => value.startsWith('.'))) assert.ok(resolve(directory, edge).startsWith(root + sep), file + ': cross-package relative import');
        }
      }
    }
    await walk(join(root, 'src'));
  }
  assert.ok(inspected > 20);
});
test('boundary gate catches type reexports and literal runtime imports but does not mistake generated code strings for imports', () => {
  const edges = literalModuleEdges(`import type {Config} from 'vite';export {x} from '@cormijs/plugin-react';
const a=import('react');const b=require('node:fs');type T=import('typescript').Type;
const generated="import 'vue'"; // import 'unused'
`, 'probe.ts');
  assert.deepEqual(edges, ['@cormijs/plugin-react','node:fs','react','typescript','vite']);
  assert.deepEqual(forbiddenPackages(edges, new Set(['typescript']), true), ['@cormijs/plugin-react','react','vite']);
  assert.deepEqual(forbiddenPackages(['react/jsx-runtime','node:fs','fs','@cormijs/core'], new Set(['react']), false), ['node:fs','fs','@cormijs/core']);
});
