import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { webPlugin, applicationCommandsPlugin, type ApplicationRequest, type PreparedApplication } from '@cormijs/plugin-web';
import type { DevelopmentState } from '@cormijs/builder/development';
import { commandPlugin } from '../packages/cormi/dist/commands.js';
import { copyDevelopmentState } from '../packages/plugin-vite/dist/development.js';
import { fixture, hasCode, assertPortFree } from './helpers.js';

const initial: DevelopmentState = { revision: 1, status: 'error', hasOutput: false,
  diagnostic: { code: 'ROUTE_CONFLICT', phase: 'routes', message: 'Fix duplicate routes.', files: ['src/pages/index.jsx'] } };
const options = { timeout: 15000 };
test('diagnostic payload copies only the bounded wire schema', () => {
  const copy = copyDevelopmentState({ ...initial, privateValue: 'secret', diagnostic: { ...initial.diagnostic!, cause: 'secret' } } as DevelopmentState);
  assert.doesNotMatch(JSON.stringify(copy), /secret|cause|privateValue/);
  assert.throws(() => copyDevelopmentState({ ...initial, revision: -1 }), hasCode('DEVELOPMENT_STATE_INVALID'));
  assert.throws(() => copyDevelopmentState({ ...initial, diagnostic: { ...initial.diagnostic!, files: Array(9).fill('x') } }), hasCode('DEVELOPMENT_STATE_INVALID'));
});
test('real dev transport rejects conflicting revisions, ignores stale updates, and closes without keeping the port', options, async () => {
  const f = await fixture(), host = new ProjectRuntime(); host.mount('web', webPlugin); host.mount('vite', vitePlugin);
  try {
    await host.ready(); const server = await host.ctx.web.dev({ ...f.plan, development: { entry: '.cormi/app.tsx', initial } });
    assert.ok(server.setDevelopmentState); const url = new URL('@id/__x00__cormi:development-client', server.url);
    const first = await (await fetch(url)).text(); assert.match(first, /Fix duplicate routes/);
    const generated = new URL('.cormi/app.tsx', server.url);
    const fallback = await fetch(generated); assert.equal(fallback.status, 200);
    assert.match((await fallback.text()).split('//# sourceMappingURL')[0]!.trim(), /^export\s*\{\s*\};?$/);
    await mkdir(join(f.root, '.cormi'));
    await writeFile(join(f.root, '.cormi/app.tsx'), 'export const recovered = "cormi-recovered";');
    const updated: DevelopmentState = { revision: 2, status: 'ready', hasOutput: true };
    await server.setDevelopmentState(updated); await server.setDevelopmentState(initial);
    await server.invalidate!(['.cormi/app.tsx']);
    assert.match(await (await fetch(generated)).text(), /cormi-recovered/);
    assert.doesNotMatch(await (await fetch(url)).text(), /Fix duplicate routes/);
    await assert.rejects(server.setDevelopmentState({ ...initial, revision: 2 }), hasCode('DEVELOPMENT_STATE_CONFLICT'));
    const port = Number(new URL(server.url).port); await server.close(); await assertPortFree(port);
    await assert.rejects(server.setDevelopmentState(updated), hasCode('SERVER_CLOSED'));
  } finally { await host.dispose(); await f.clean(); }
});
test('a backend without diagnostic support fails clearly and releases both prepared and server sessions', options, async () => {
  const host = new ProjectRuntime(); const closed: string[] = [];
  host.mount('commands', commandPlugin);
  host.mount('providers', ctx => {
    ctx.provide('application', { async prepare(request: ApplicationRequest): Promise<PreparedApplication> {
      return { plan: { root: request.root, entry: 'index.html', outDir: 'dist', base: '/', mode: 'test' }, snapshot: undefined,
        development: { entry: '.cormi/app.tsx', current: () => initial, subscribe: () => () => {} }, async close() { closed.push('compiler'); } };
    } });
    ctx.provide('web', { async dev() { return { url: 'http://127.0.0.1:1', async close() { closed.push('server'); } }; } });
  });
  host.mount('application-commands', applicationCommandsPlugin);
  try {
    await host.ready(); await assert.rejects(host.ctx.commands.execute('dev', { root: '/project', mode: 'test', options: {}, signal: new AbortController().signal }), hasCode('BUILDER_DIAGNOSTICS_UNSUPPORTED'));
    assert.deepEqual(closed, ['compiler', 'server']);
  } finally { await host.dispose(); }
});
