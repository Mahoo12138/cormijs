import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { redirect } from 'react-router';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { ssrPlugin } from '@cormijs/plugin-react-vite';
import { renderServerApplication, type ServerApplication } from '@cormijs/runtime/server';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('renderServerApplication renders routes and loader data, and returns redirects as responses', async () => {
  const app: ServerApplication = { routes: [
    { id: 'home', path: '/', Component: () => createElement('main', null, createElement('h1', null, 'SSR unit')), loader: async () => ({ answer: 42 }) },
    { id: 'old', path: '/old', loader: () => { throw redirect('/'); } },
  ] };
  const rendered = await renderServerApplication(app, new Request('http://localhost/'));
  assert.ok(!(rendered instanceof Response));
  assert.match(rendered.html, /<h1>SSR unit<\/h1>/);
  assert.match(rendered.html, /__staticRouterHydrationData/);
  assert.equal(rendered.status, 200);
  const moved = await renderServerApplication(app, new Request('http://localhost/old'));
  assert.ok(moved instanceof Response);
  assert.equal(moved.status, 302);
  assert.equal(moved.headers.get('location'), '/');
});

test('ssr plugin registers its Vite bridge, validates options and withdraws', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-ssr 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = new ProjectRuntime(3000, root);
  host.mount('vite', vitePlugin);
  host.mount('ssr', ssrPlugin);
  await host.ready();
  assert.ok(host.ctx.vite.ids().includes('cormi:ssr'));
  await host.unmount('ssr');
  assert.ok(!host.ctx.vite.ids().includes('cormi:ssr'));
  await host.dispose();

  for (const options of [{ mountId: '9bad' }, { mountId: 1 }, { extra: true }]) {
    const rejecting = new ProjectRuntime(3000, root);
    rejecting.mount('vite', vitePlugin);
    rejecting.mount('invalid', ssrPlugin, options as never);
    await assert.rejects(rejecting.ready(), hasCode('PLUGIN_FAILED'));
    await rejecting.dispose();
  }
});
