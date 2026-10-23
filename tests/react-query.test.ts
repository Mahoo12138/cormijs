import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { reactPlugin } from '@cormijs/plugin-react';
import { reactQueryPlugin } from '@cormijs/plugin-react-query';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('react query plugin contributes its provider, validates defaults and withdraws', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-react-query 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = new ProjectRuntime(3000, root);
  host.mount('vite', vitePlugin);
  host.mount('react', reactPlugin);
  host.mount('query', reactQueryPlugin, { id: 'application:react-query', defaults: { staleTime: 1000, retry: 0 } });
  await host.ready();
  const contributions = await host.ctx.react.runtime.collect(undefined);
  assert.ok(contributions.some(item => item.id === 'application:react-query:runtime' && item.module.exportName === 'reactQueryRuntime'));
  await host.unmount('query');
  assert.ok(!(await host.ctx.react.runtime.collect(undefined)).some(item => item.id === 'application:react-query:runtime'));
  await host.dispose();

  for (const options of [{ id: 42 }, { extra: true }, { defaults: { retry: 11 } }, { defaults: { staleTime: -1 } }, { defaults: { refetchOnWindowFocus: 'yes' } }]) {
    const rejecting = new ProjectRuntime(3000, root);
    rejecting.mount('vite', vitePlugin);
    rejecting.mount('react', reactPlugin);
    rejecting.mount('invalid', reactQueryPlugin, options as never);
    await assert.rejects(rejecting.ready(), hasCode('PLUGIN_FAILED'));
    await rejecting.dispose();
  }
});
