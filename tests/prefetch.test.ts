import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { reactPlugin, routePrefetchPlugin } from '@cormijs/plugin-react';
import type { ApplicationRequest } from '@cormijs/plugin-web';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-prefetch 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  await writeFile(join(root, 'src/pages/guide.tsx'), 'export default () => null;');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: { routes: [
    { id: 'home', index: true, module: { specifier: './src/pages/index.tsx', exportName: 'default' }, source: {} },
    { id: 'guide', path: 'guide', module: { specifier: './src/pages/guide.tsx', exportName: 'default' }, source: {} },
  ] }, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('the generated entry exposes a lazy prefetch registry per page route', async t => {
  const f = await project(t);
  const session = await f.host.ctx.application.prepare(f.request); await session.close();
  const code = await f.code();
  assert.match(code, /const prefetch = \{[^}]*"home":\(\)=>import\("\.\.\/src\/pages\/index\.tsx"\)/);
  assert.match(code, /const prefetch = \{[^}]*"guide":\(\)=>import\("\.\.\/src\/pages\/guide\.tsx"\)/);
  assert.match(code, /mountApplication\(\{element,routes,plugins,prefetch,base:/);
  assert.doesNotMatch(code, /prefetchRuntime/);
});

test('prefetch plugin contributes its provider and validates options', async t => {
  const f = await project(t);
  f.host.mount('prefetch', routePrefetchPlugin, { id: 'app:prefetch', mode: 'idle' }); await f.host.ready();
  const session = await f.host.ctx.application.prepare(f.request); await session.close();
  const code = await f.code();
  assert.match(code, /plugin:runtime0\["prefetchRuntime"\],options:\{"mode":"idle"\}/);
  await f.host.unmount('prefetch');
  const removed = await f.host.ctx.application.prepare(f.request); await removed.close();
  assert.doesNotMatch(await f.code(), /prefetchRuntime/);

  const rejecting = new ProjectRuntime(3000, f.root);
  rejecting.mount('react', reactPlugin); rejecting.mount('bad', routePrefetchPlugin, { mode: 'later' } as never);
  await assert.rejects(rejecting.ready(), (error: any) => error?.code === 'PLUGIN_FAILED' && error?.cause?.code === 'PREFETCH_INVALID');
  await rejecting.dispose();
});
