import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { fixture, hasCode } from './helpers.js';

for (const command of ['dev', 'build', 'preview'] as const) {
  test(`Vite ${command} rejects a native plugin changing the application base before serving or publishing`, { timeout: 20000 }, async () => {
    const f = await fixture('/admin/'), h = new ProjectRuntime(); h.mount('vite', vitePlugin);
    let original: Buffer | undefined;
    try {
      await h.ready();
      if (command === 'preview') { await h.ctx.builder.build(f.plan); original = await readFile(join(f.root, 'dist/index.html')); }
      h.ctx.vite.add('bad-base', () => ({ name: 'bad-base', config: () => ({ base: '/different/' }) }));
      await assert.rejects(h.ctx.builder[command](f.plan), hasCode('VITE_RESERVED_CONFIG'));
      assert.deepEqual((await readdir(f.root)).filter(name => name.startsWith('.cormi-vite-')), []);
      if (original) assert.deepEqual(await readFile(join(f.root, 'dist/index.html')), original);
    } finally { await h.dispose(); await f.clean(); }
  });
}
test('a native extension agreeing with the application base remains valid', { timeout: 20000 }, async () => {
  const f = await fixture('/admin/'), h = new ProjectRuntime(); h.mount('vite', vitePlugin);
  try {
    await h.ready(); h.ctx.vite.add('same-base', () => ({ name: 'same-base', config: () => ({ base: '/admin/' }) }));
    const dev = await h.ctx.builder.dev(f.plan); assert.equal(new URL(dev.url).pathname, '/admin/');
    assert.equal((await fetch(dev.url)).status, 200); await dev.close();
  } finally { await h.dispose(); await f.clean(); }
});
