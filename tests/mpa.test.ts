import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { mpaEntrySource, mpaHtml, mpaPlugin, resolveMpaEntries } from '@cormijs/plugin-react-vite';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;
const options = { directory: 'src/pages', mountElementId: 'root' } as const;

test('resolveMpaEntries maps page directories to standalone entries', () => {
  const entries = resolveMpaEntries([
    { name: 'home', file: 'src/pages/home/index.tsx', title: 'Home' },
    { name: 'admin', file: 'src/pages/admin/index.jsx', mountElementId: 'app' },
  ], options);
  assert.deepEqual(entries.map(entry => [entry.name, entry.title, entry.mountElementId, entry.html]), [
    ['admin', 'admin', 'app', '.cormi/mpa/admin.html'],
    ['home', 'Home', 'root', '.cormi/mpa/home.html'],
  ]);
  assert.match(mpaEntrySource(entries[1]!), /document\.getElementById\("root"\)/);
  assert.match(mpaEntrySource(entries[1]!), /import Page from '\/src\/pages\/home\/index\.tsx'/);
  assert.match(mpaHtml({ ...entries[1]!, title: 'A "quoted" <title>' }), /<title>A &quot;quoted&quot; &lt;title&gt;<\/title>/);
  const wrapped = resolveMpaEntries([{ name: 'home', file: 'src/pages/home/index.tsx', layout: 'src/Layout.tsx' }], options);
  assert.equal(wrapped[0]!.layout, 'src/Layout.tsx');
  assert.match(mpaEntrySource(wrapped[0]!), /import Layout from '\/src\/Layout\.tsx'/);
  assert.match(mpaEntrySource(wrapped[0]!), /<Layout><Page \/><\/Layout>/);
});

test('resolveMpaEntries rejects reserved names, unsafe paths, invalid mounts and duplicates', () => {
  const entry = (overrides: Record<string, unknown>) => ({ name: 'home', file: 'src/pages/home/index.tsx', ...overrides });
  for (const candidate of [entry({ name: 'index' }), entry({ name: '_home' }), entry({ name: 'bad/name' }), entry({ file: 'src/other/index.tsx' }), entry({ file: '../escape.tsx' }), entry({ title: 1 }), entry({ mountElementId: '9bad' }), entry({ layout: '../Layout.tsx' }), entry({ layout: '/src/Layout.tsx' }), entry({ layout: 'src/layout.txt' }), entry({ layout: 'node_modules/x.tsx' }), entry({ layout: '.cormi/x.tsx' })]) {
    assert.throws(() => resolveMpaEntries([candidate as never], options), hasCode('MPA_INVALID'));
  }
  assert.throws(() => resolveMpaEntries([entry({}), entry({})], options), hasCode('MPA_INVALID'));
  assert.throws(() => resolveMpaEntries(Array.from({ length: 33 }, (_, index) => entry({ name: `page${index}` })), options), hasCode('MPA_INVALID'));
});

test('mpa plugin registers its Vite bridge, validates options and withdraws', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-mpa-mount 中文-')));
  await mkdir(join(root, 'src/pages/home'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = new ProjectRuntime(3000, root);
  host.mount('vite', vitePlugin);
  host.mount('mpa', mpaPlugin);
  await host.ready();
  assert.ok(host.ctx.vite.ids().includes('cormi:mpa'));
  await host.unmount('mpa');
  assert.ok(!host.ctx.vite.ids().includes('cormi:mpa'));
  await host.dispose();

  for (const invalid of [{ directory: '../pages' }, { directory: '/pages' }, { mountElementId: '9bad' }, { extra: true }]) {
    const rejecting = new ProjectRuntime(3000, root);
    rejecting.mount('vite', vitePlugin);
    rejecting.mount('invalid', mpaPlugin, invalid as never);
    await assert.rejects(rejecting.ready(), hasCode('PLUGIN_FAILED'));
    await rejecting.dispose();
  }
});
