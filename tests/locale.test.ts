import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { appRuntimePlugin, localePlugin, reactPlugin } from '@cormijs/plugin-react';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-locale 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  await writeFile(join(root, 'src/app.tsx'), 'import { defineApp } from "@cormijs/runtime"; export default defineApp({ locale: { default: "en", messages: { en: { hello: "Hello" } } } });');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('locale plugin contributes its key and provider, then withdraws', async t => {
  const f = await project(t);
  f.host.mount('app', appRuntimePlugin); f.host.mount('locale', localePlugin, { id: 'app:locale' }); await f.host.ready();
  const session = await f.host.ctx.application.prepare(f.request); await session.close();
  const code = await f.code();
  assert.match(code, /localeRuntime/); assert.match(code, /\["locale"\]/);
  const inspection = readInspection(f.root).summary as { appRuntime: { keys: string[] }, runtime: Array<{ id: string }> };
  assert.ok(inspection.appRuntime.keys.includes('locale'));
  assert.ok(inspection.runtime.some(item => item.id === 'app:locale'));
  await f.host.unmount('locale');
  const removed = await f.host.ctx.application.prepare(f.request); await removed.close();
  assert.doesNotMatch(await f.code(), /localeRuntime/);
});

test('invalid locale plugin options fail plugin activation', async t => {
  const f = await project(t);
  f.host.mount('bad', localePlugin, { id: 42 } as never);
  await assert.rejects(f.host.ready(), (error: any) => error?.code === 'PLUGIN_FAILED' && error?.cause?.code === 'LOCALE_INVALID');
});
