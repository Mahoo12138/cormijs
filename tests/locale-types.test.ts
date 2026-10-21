import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { generateLocaleTypes, localePlugin, reactPlugin } from '@cormijs/plugin-react';
import type { ApplicationRequest } from '@cormijs/plugin-web';

test('locale types list sorted codes and keys with JSON string literals', () => {
  const text = generateLocaleTypes([
    { locale: 'zh-CN', messages: { title: '标题', 'menu.team': '团队' } },
    { locale: 'en', messages: { greeting: 'Hello' } },
  ]);
  assert.match(text, /declare namespace CormiLocale \{/);
  assert.match(text, /type Code = "en" \| "zh-CN";/);
  assert.match(text, /type MessageKey = "greeting" \| "menu\.team" \| "title";/);
  assert.match(generateLocaleTypes([]), /type Code = never;\n  type MessageKey = never;/);
  assert.match(generateLocaleTypes([{ locale: 'en', messages: { 'quote"key': 'x' } }]), /"quote\\"key"/);
});

async function app(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-locale-types 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  host.mount('react', reactPlugin); host.mount('locale', localePlugin, { id: 'app:locale', directory: 'src/locales' });
  await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request };
}

test('catalog directories also publish .cormi/locale.d.ts and remove it with the plugin', async t => {
  const f = await app(t);
  await mkdir(join(f.root, 'src/locales'), { recursive: true });
  await writeFile(join(f.root, 'src/locales/en.json'), JSON.stringify({ greeting: 'Hello' }));
  await writeFile(join(f.root, 'src/locales/zh-CN.json'), JSON.stringify({ greeting: '你好', title: '标题' }));
  const session = await f.host.ctx.application.prepare(f.request); await session.close();
  const text = await readFile(join(f.root, '.cormi/locale.d.ts'), 'utf8');
  assert.match(text, /type Code = "en" \| "zh-CN";/);
  assert.match(text, /type MessageKey = "greeting" \| "title";/);
  await f.host.unmount('locale');
  const removed = await f.host.ctx.application.prepare(f.request); await removed.close();
  assert.match(await readFile(join(f.root, '.cormi/locale.d.ts'), 'utf8'), /type MessageKey = never;/);
});
