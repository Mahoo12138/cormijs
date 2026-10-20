import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { reactPlugin } from '@cormijs/plugin-react';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';
import { hasCode } from './helpers.js';

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-history 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('history selection reaches generated entry and inspection; invalid declarations fail closed', async t => {
  const f = await project(t);
  const browser = await f.host.ctx.application.prepare(f.request); await browser.close();
  assert.doesNotMatch(await f.code(), /history:/);
  assert.equal((readInspection(f.root).summary as { history: string }).history, 'browser');

  const hash = await f.host.ctx.application.prepare({ ...f.request, options: { history: 'hash' } }); await hash.close();
  assert.match(await f.code(), /history:"hash"/);
  assert.equal((readInspection(f.root).summary as { history: string }).history, 'hash');

  const memory = await f.host.ctx.application.prepare({ ...f.request, options: { history: { type: 'memory' } } }); await memory.close();
  assert.match(await f.code(), /history:"memory"/);
  assert.equal((readInspection(f.root).summary as { history: string }).history, 'memory');

  for (const history of ['abstract', { type: 'browser', extra: true }, 42]) {
    await assert.rejects(f.host.ctx.application.prepare({ ...f.request, options: { history } }), hasCode('CONFIG_INVALID'));
  }
});
