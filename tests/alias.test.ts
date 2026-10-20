import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { aliasEntries, aliasPlugin, resolveAliases } from '@cormijs/plugin-react-vite';

test('resolveAliases maps project-relative replacements and rejects escapes and malformed input', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-alias 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(resolveAliases(root, { '@': 'src', shared: 'src/shared' }).map(alias => alias.find), ['@', 'shared']);
  assert.equal(resolveAliases(root, { '@': 'src' })[0]!.replacement, join(root, 'src'));
  for (const input of [{}, { '@': '../outside' }, { '@': '/abs' }, { '@': 1 }, { '': 'src' }]) {
    assert.throws(() => resolveAliases(root, input), (error: any) => error?.code === 'ALIAS_INVALID');
  }
});

test('aliasEntries appends the builtin @ below explicit aliases and can run alone', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-alias-builtins 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const joined = join(root, 'src');
  assert.deepEqual(aliasEntries(root, { builtins: true }).map(alias => alias.find), ['@']);
  assert.equal(aliasEntries(root, { builtins: true })[0]!.replacement, joined);
  const explicit = aliasEntries(root, { aliases: { '@': 'src/app' }, builtins: true });
  assert.deepEqual(explicit.map(alias => alias.find), ['@']);
  assert.equal(explicit[0]!.replacement, join(root, 'src/app'));
  assert.deepEqual(aliasEntries(root, { aliases: { '@shared': 'src/shared' }, builtins: true }).map(alias => alias.find), ['@shared', '@']);
  assert.throws(() => aliasEntries(root, { aliases: {} , builtins: true }), (error: any) => error?.code === 'ALIAS_INVALID');
});

test('alias plugin registers its resolver and withdraws cleanly', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-alias-mount 中文-')));
  await mkdir(join(root, 'src'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = new ProjectRuntime(3000, root);
  host.mount('vite', vitePlugin);
  host.mount('alias', aliasPlugin, { aliases: { '@': 'src' } });
  await host.ready();
  assert.ok(host.ctx.vite.ids().includes('cormi:alias'));
  await host.unmount('alias');
  assert.ok(!host.ctx.vite.ids().includes('cormi:alias'));
  await host.dispose();
});
