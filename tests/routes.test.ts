import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { routesFromFiles, scanPages, validateRoutes, moduleRef } from '@cormijs/routes';
import { fixture, hasCode } from './helpers.js';
const files = (...paths: string[]) => paths.map(path => 'src/pages/' + path);

test('conventions retain nested layouts, directory indexes, parameters and splats', () => {
  const routes = routesFromFiles(files('_layout.tsx', 'index.tsx', 'users/_layout.tsx', 'users/index.tsx', 'users/[id].tsx', 'docs/[...rest].tsx'));
  const byFile = new Map(routes.map(route => [route.source.file, route]));
  assert.equal(byFile.get('src/pages/users/[id].tsx')?.path, ':id');
  assert.equal(byFile.get('src/pages/users/[id].tsx')?.parentId, 'file:src/pages/users/_layout.tsx');
  assert.equal(byFile.get('src/pages/users/index.tsx')?.index, true);
  assert.equal(byFile.get('src/pages/docs/[...rest].tsx')?.path, 'docs/*');
  assert.ok(Object.isFrozen(routes) && Object.isFrozen(routes[0]) && Object.isFrozen(routes[0]?.module));
});
test('file and directory-index routes conflict; dynamic names and casing cannot hide ambiguity', () => {
  for (const set of [files('users.tsx', 'users/index.tsx'), files('[id].tsx', '[slug].tsx'), files('About.tsx', 'about.tsx'), files('index.tsx', 'index.jsx')]) {
    assert.throws(() => routesFromFiles(set), hasCode('ROUTE_CONFLICT'));
  }
});
test('layout IDs and paths are deterministic across input order', () => {
  const input = files('z.tsx', 'index.tsx', '_layout.tsx', 'a/_layout.tsx', 'a/[id].tsx');
  assert.deepEqual(routesFromFiles(input), routesFromFiles([...input].reverse()));
});
test('explicit route graph rejects parent cycles, missing parents and index children', () => {
  assert.throws(() => validateRoutes([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }]), hasCode('ROUTE_PARENT_CYCLE'));
  assert.throws(() => validateRoutes([{ id: 'a', parentId: 'missing' }]), hasCode('ROUTE_PARENT_MISSING'));
  assert.throws(() => validateRoutes([{ id: 'a', index: true }, { id: 'b', parentId: 'a', path: 'b' }]), hasCode('ROUTE_INVALID'));
  assert.throws(() => validateRoutes([{ id: 'a', index: true, path: '' }]), hasCode('ROUTE_INVALID'));
});
test('malformed and nonterminal route patterns are rejected', () => {
  for (const path of ['../x', '/absolute', 'a//b', 'a/*/b', ':id/:id', '[id]', ':id?', 'a#x']) {
    assert.throws(() => validateRoutes([{ id: 'bad', path }]), hasCode('ROUTE_PATH_INVALID'));
  }
  assert.throws(() => routesFromFiles(files('docs/[...rest]/nested.tsx')), hasCode('ROUTE_PATH_INVALID'));
});
test('static and dynamic routes may coexist; route modules cannot be executable expressions', () => {
  assert.equal(validateRoutes([{ id: 'a', path: 'users/new' }, { id: 'b', path: 'users/:id' }]).length, 2);
  for (const specifier of ['node:fs', 'file:///tmp/a', 'https://example.com/a', './page?raw', './a#b']) assert.throws(() => moduleRef({ specifier, exportName: 'default' }), hasCode('ROUTE_MODULE_INVALID'));
});
test('page scanner never evaluates modules and ignores helper/test directories', async () => {
  const f = await fixture();
  try {
    for (const file of ['index.tsx', '_layout.tsx', '_components/a.tsx', '.hidden/a.tsx', 'a.test.tsx', 'a.spec.jsx', 'types.d.ts']) {
      const path = join(f.root, 'src/pages', file); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, 'throw new Error("MUST NOT EXECUTE")');
    }
    assert.equal((await scanPages(f.root)).length, 2);
    assert.deepEqual(await scanPages(f.root, 'absent/pages'), []);
  } finally { await f.clean(); }
});
test('scanner rejects page symlinks and traversal without reading the target', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, 'src/pages'), { recursive: true });
    await symlink(join(f.root, 'main.ts'), join(f.root, 'src/pages/link.tsx'));
    await assert.rejects(scanPages(f.root), hasCode('ROUTE_SYMLINK'));
    await assert.rejects(scanPages(f.root, '../outside'), hasCode('ROUTE_PATH_INVALID'));
  } finally { await f.clean(); }
});
