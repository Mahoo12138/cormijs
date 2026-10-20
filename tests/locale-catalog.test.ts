import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { localeCatalogSources, localePlugin, readLocaleCatalogs, reactPlugin, mergeLocaleCatalogs } from '@cormijs/plugin-react';
import type { ApplicationRequest } from '@cormijs/plugin-web';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('catalog sources are validated and directories stay inactive when missing', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-locale-catalog 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(localeCatalogSources([{ id: 'app:locale', directory: 'src/locales' }]), [{ id: 'app:locale', directory: 'src/locales' }]);
  assert.throws(() => localeCatalogSources([{ id: 'app:locale', directory: '../locales' }]), hasCode('LOCALE_INVALID'));
  assert.throws(() => localeCatalogSources([{ id: 'app:locale' }, { id: 'app:locale' }]), hasCode('LOCALE_INVALID'));

  assert.deepEqual(await readLocaleCatalogs(root, localeCatalogSources([{ id: 'a', directory: 'src/locales' }])), []);
  await mkdir(join(root, 'src/locales'), { recursive: true });
  await writeFile(join(root, 'src/locales/zh-CN.json'), JSON.stringify({ greeting: '你好' }));
  await writeFile(join(root, 'src/locales/en.json'), JSON.stringify({ greeting: 'hello' }));
  const catalogs = await readLocaleCatalogs(root, localeCatalogSources([{ id: 'a', directory: 'src/locales' }]));
  assert.deepEqual(catalogs.map(item => item.locale), ['en', 'zh-CN']);
  assert.deepEqual(catalogs.find(item => item.locale === 'zh-CN')?.messages, { greeting: '你好' });

  await writeFile(join(root, 'src/locales/bad name.json'), '{}');
  await assert.rejects(readLocaleCatalogs(root, localeCatalogSources([{ id: 'a', directory: 'src/locales' }])), hasCode('LOCALE_INVALID'));
  await rm(join(root, 'src/locales/bad name.json'));
  await writeFile(join(root, 'src/locales/en.json'), '{');
  await assert.rejects(readLocaleCatalogs(root, localeCatalogSources([{ id: 'a', directory: 'src/locales' }])), hasCode('LOCALE_INVALID'));
  await writeFile(join(root, 'src/locales/en.json'), JSON.stringify({ nested: { a: 1 } }));
  await assert.rejects(readLocaleCatalogs(root, localeCatalogSources([{ id: 'a', directory: 'src/locales' }])), hasCode('LOCALE_INVALID'));
});

test('mergeLocaleCatalogs combines locales and refuses duplicate keys across sources', async () => {
  assert.deepEqual(mergeLocaleCatalogs([
    { locale: 'en', messages: { a: '1' } }, { locale: 'en', messages: { b: '2' } }, { locale: 'fr', messages: { a: '3' } },
  ]), [{ locale: 'en', messages: { a: '1', b: '2' } }, { locale: 'fr', messages: { a: '3' } }]);
  assert.throws(() => mergeLocaleCatalogs([
    { locale: 'en', messages: { a: '1' } }, { locale: 'en', messages: { a: '2' } },
  ]), hasCode('LOCALE_CONFLICT'));
});

async function app(t: TestContext, directory: string | undefined) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-locale-app 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  await writeFile(join(root, 'src/app.tsx'), 'import { defineApp } from "@cormijs/runtime"; export default defineApp({ locale: { default: "en", messages: { en: { greeting: "configured" } } } });');
  host.mount('react', reactPlugin);
  host.mount('locale', localePlugin, directory === undefined ? {} : { directory });
  await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('catalog directories reach the generated entry and the app configuration still wins', async t => {
  const disabled = await app(t, undefined);
  const plain = await disabled.host.ctx.application.prepare(disabled.request); await plain.close();
  assert.doesNotMatch(await disabled.code(), /applyLocaleCatalogs/);

  const enabled = await app(t, 'src/locales');
  await mkdir(join(enabled.root, 'src/locales'), { recursive: true });
  await writeFile(join(enabled.root, 'src/locales/en.json'), JSON.stringify({ farewell: 'bye' }));
  await writeFile(join(enabled.root, 'src/locales/zh-CN.json'), JSON.stringify({ greeting: '你好', farewell: '再见' }));
  const session = await enabled.host.ctx.application.prepare(enabled.request); await session.close();
  const code = await enabled.code();
  assert.match(code, /applyLocaleCatalogs\(resolveAppConfig\(/);
  assert.match(code, /\[\{"locale":"en","messages":\{"farewell":"bye"\}\},\{"locale":"zh-CN"/);
  const manifest = JSON.parse((await readFile(join(enabled.root, '.cormi/inspect.jsonc'), 'utf8')).replace(/^\/\/.*\n/gm, '')) as { summary: { localeCatalogs: Array<{ locale: string; keys: number }> } };
  assert.deepEqual(manifest.summary.localeCatalogs, [{ locale: 'en', keys: 1 }, { locale: 'zh-CN', keys: 2 }]);

  await enabled.host.unmount('locale');
  const removed = await enabled.host.ctx.application.prepare(enabled.request); await removed.close();
  assert.doesNotMatch(await enabled.code(), /applyLocaleCatalogs|localeRuntime/);
});
