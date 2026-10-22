import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { proLayoutPlugin } from '@cormijs/plugin-antd';
import { isServerModule } from '@cormijs/plugin-react';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('pro layout plugin registers Vite prebundling, validates options and withdraws', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-pro-layout 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = new ProjectRuntime(3000, root);
  host.mount('vite', vitePlugin);
  host.mount('pro-layout', proLayoutPlugin, { id: 'application:pro-layout' });
  await host.ready();
  assert.ok(host.ctx.vite.ids().includes('application:pro-layout'));
  await host.unmount('pro-layout');
  assert.ok(!host.ctx.vite.ids().includes('application:pro-layout'));
  await host.dispose();

  for (const options of [{ id: 42 }, { extra: true }]) {
    const rejecting = new ProjectRuntime(3000, root);
    rejecting.mount('vite', vitePlugin);
    rejecting.mount('invalid', proLayoutPlugin, options as never);
    await assert.rejects(rejecting.ready(), hasCode('PLUGIN_FAILED'));
    await rejecting.dispose();
  }
});

test('the pro layout runtime subpath is a browser module while the package entry stays Node-only', () => {
  assert.equal(isServerModule('@cormijs/plugin-antd/pro-layout'), false);
  assert.equal(isServerModule('@cormijs/plugin-antd/runtime'), false);
  assert.equal(isServerModule('@cormijs/plugin-antd'), true);
});
