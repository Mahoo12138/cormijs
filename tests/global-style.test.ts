import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import type { ApplicationRequest } from '@cormijs/plugin-web';
import { globalStylePlugin, reactPlugin, resolveGlobalStyles, styleContributions } from '@cormijs/plugin-react';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

function readInspection(root: string) {
  return readFile(join(root, '.cormi/inspect.jsonc'), 'utf8').then(text => JSON.parse(text.replace(/^\/\/.*\n/gm, '')) as { summary: { styles: Array<{ owner: string; file: string }> } });
}

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-global-style 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  host.mount('react', reactPlugin); await host.ready();
  const page = { specifier: './src/pages/index.tsx', exportName: 'default' } as const;
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test',
    options: { routes: [{ id: 'home', index: true, module: page, source: {} }] }, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('style contributions validate candidate lists and ids', async () => {
  assert.deepEqual(styleContributions([{ id: 'app:styles', files: ['src/global.css'] }]), [{ id: 'app:styles', files: ['src/global.css'] }]);
  assert.throws(() => styleContributions([{ id: 'app:styles', files: ['src/global.txt'] }]), hasCode('STYLE_INVALID'));
  assert.throws(() => styleContributions([{ id: 'app:styles', files: ['/src/global.css'] }]), hasCode('STYLE_INVALID'));
  assert.throws(() => styleContributions([{ id: 'app:styles', files: ['../outside.css'] }]), hasCode('STYLE_INVALID'));
  assert.throws(() => styleContributions([{ id: 'app:styles', files: [] }]), hasCode('STYLE_INVALID'));
  assert.throws(() => styleContributions([{ id: 'bad id', files: ['src/global.css'] }]), hasCode('STYLE_INVALID'));
  assert.throws(() => styleContributions([{ id: 'a', files: ['src/global.css'] }, { id: 'a', files: ['src/global.less'] }]), hasCode('STYLE_INVALID'));
  assert.throws(() => styleContributions(Array.from({ length: 9 }, (_, index) => ({ id: 'plugin' + index, files: ['src/global.css'] }))), hasCode('STYLE_INVALID'));
});

test('resolveGlobalStyles picks the first candidate per contribution and rejects duplicates and links', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-style-resolve 中文-')));
  await mkdir(join(root, 'src'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await resolveGlobalStyles(root, styleContributions([{ id: 'a', files: ['src/global.scss', 'src/global.css'] }])), []);
  await writeFile(join(root, 'src/global.css'), ':root { --x: 1; }');
  await writeFile(join(root, 'src/global.scss'), '$x: 1;');
  assert.deepEqual(await resolveGlobalStyles(root, styleContributions([{ id: 'a', files: ['src/global.scss', 'src/global.css'] }])),
    [{ owner: 'a', file: 'src/global.scss', extension: 'scss' }]);
  assert.deepEqual(await resolveGlobalStyles(root, styleContributions([{ id: 'a', files: ['src/global.css'] }])),
    [{ owner: 'a', file: 'src/global.css', extension: 'css' }]);
  await assert.rejects(resolveGlobalStyles(root, styleContributions([{ id: 'a', files: ['src/global.css'] }, { id: 'b', files: ['src/global.css'] }])), hasCode('STYLE_CONFLICT'));
  await symlink(join(root, 'src/global.css'), join(root, 'src/global-linked.css'));
  await assert.rejects(resolveGlobalStyles(root, styleContributions([{ id: 'a', files: ['src/global-linked.css'] }])), hasCode('STYLE_INVALID'));
});

test('global style plugin imports the discovered stylesheet and withdraws cleanly', async t => {
  const f = await project(t);
  const plain = await f.host.ctx.application.prepare(f.request); await plain.close();
  assert.doesNotMatch(await f.code(), /src\/global\.css/);

  f.host.mount('styles', globalStylePlugin, { id: 'app:styles' }); await f.host.ready();
  const missing = await f.host.ctx.application.prepare(f.request); await missing.close();
  assert.doesNotMatch(await f.code(), /src\/global\.css/);
  assert.deepEqual((await readInspection(f.root)).summary.styles, []);

  await writeFile(join(f.root, 'src/global.css'), '[data-global]{color:rgb(1,2,3)}');
  const enabled = await f.host.ctx.application.prepare(f.request); await enabled.close();
  const code = await f.code();
  assert.match(code, /\nimport "\.\.\/src\/global\.css";\nimport \{ mountApplication/);
  const inspection = await readInspection(f.root);
  assert.deepEqual(inspection.summary.styles, [{ owner: 'app:styles', file: 'src/global.css' }]);

  await writeFile(join(f.root, 'src/global.less'), '.a{color:red}');
  const second = await f.host.ctx.application.prepare(f.request); await second.close();
  assert.match(await f.code(), /global\.css/);

  f.host.mount('more', globalStylePlugin, { id: 'app:styles2', files: ['src/global.less'] }); await f.host.ready();
  const stacked = await f.host.ctx.application.prepare(f.request); await stacked.close();
  const both = await f.code(), order = (await readInspection(f.root)).summary.styles.map(style => style.file);
  assert.deepEqual(order.map(file => file.split('/').pop()), ['global.less', 'global.css'], 'imports follow the resolved styles hook order');
  assert.ok(both.indexOf(order[0]!) < both.indexOf(order[1]!), 'emitted import order matches the reported hook order');

  f.host.mount('clash', globalStylePlugin, { id: 'app:styles3', files: ['src/global.css'] }); await f.host.ready();
  await assert.rejects(f.host.ctx.application.prepare(f.request), hasCode('STYLE_CONFLICT'));
  await f.host.unmount('clash'); await f.host.unmount('more'); await f.host.unmount('styles');
  const removed = await f.host.ctx.application.prepare(f.request); await removed.close();
  assert.doesNotMatch(await f.code(), /src\/global/);
  assert.deepEqual((await readInspection(f.root)).summary.styles, []);
});
