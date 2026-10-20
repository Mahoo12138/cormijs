import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { aliasPlugin, resolveAliases } from '@cormijs/plugin-react-vite';

test('resolveAliases maps project-relative replacements and rejects escapes and malformed input', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-alias 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(resolveAliases(root, { '@': 'src', shared: 'src/shared' }).map(alias => alias.find), ['@', 'shared']);
  assert.equal(resolveAliases(root, { '@': 'src' })[0]!.replacement, join(root, 'src'));
  for (const input of [{}, { '@': '../outside' }, { '@': '/abs' }, { '@': 1 }, { '': 'src' }]) {
    assert.throws(() => resolveAliases(root, input), (error: any) => error?.code === 'ALIAS_INVALID');
  }
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
