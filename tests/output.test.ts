import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { outputPlugin, resolveOutputCopy, stableOutputNames } from '@cormijs/plugin-react-vite';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('output copy entries stay project-relative and default to their basename', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-output 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(resolveOutputCopy(root, [{ from: 'static' }, { from: 'static/robots.txt', to: 'seo/robots.txt' }]), [
    { from: 'static', to: 'static' }, { from: 'static/robots.txt', to: 'seo/robots.txt' },
  ]);
  for (const input of [
    [], [{ from: '../outside' }], [{ from: '/abs' }], [{ from: 'node_modules/x' }], [{ from: '.cormi/app.tsx' }],
    [{ from: '.env' }], [{ from: 'static', to: '../escape' }], [{ from: 'static', extra: 1 }], [{ to: 'x' }],
    Array.from({ length: 33 }, () => ({ from: 'static' })),
  ]) assert.throws(() => resolveOutputCopy(root, input), hasCode('OUTPUT_INVALID'), JSON.stringify(input));
  assert.deepEqual(resolveOutputCopy(root, undefined), []);
  assert.deepEqual(stableOutputNames(), { entryFileNames: 'assets/[name].js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' });
});

test('output plugin registers its build bridge, validates options and withdraws', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-output-mount 中文-')));
  await mkdir(join(root, 'static'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = new ProjectRuntime(3000, root);
  host.mount('vite', vitePlugin);
  host.mount('output', outputPlugin, { copy: [{ from: 'static' }], hash: false });
  await host.ready();
  assert.ok(host.ctx.vite.ids().includes('cormi:output'));
  await host.unmount('output');
  assert.ok(!host.ctx.vite.ids().includes('cormi:output'));
  await host.dispose();

  const rejecting = new ProjectRuntime(3000, root);
  rejecting.mount('vite', vitePlugin);
  rejecting.mount('invalid', outputPlugin, {});
  await assert.rejects(rejecting.ready(), (error: any) => error?.code === 'PLUGIN_FAILED' && error?.cause?.code === 'OUTPUT_INVALID');
  await rejecting.dispose();
});
