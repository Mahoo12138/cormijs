import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, realpath, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectRuntime } from '@cormijs/core';
import { reactPlugin, generateApplication, runtimeContributions } from '@cormijs/plugin-react';
import { type ApplicationRequest } from '@cormijs/plugin-web';
import { fixture, hasCode } from './helpers.js';

async function reactFixture() {
  const f = await fixture(); const root = await realpath(f.root), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'throw new Error("PAGE MUST NOT EXECUTE IN NODE"); export default () => null;');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal, serverOnlyFiles: [] };
  return { root, host, request, file: join(root, '.cormi/app.tsx'), async clean() { try { await host.dispose(); } finally { await f.clean(); } } };
}
async function until(predicate: () => Promise<boolean>) {
  const end = Date.now() + 6000;
  while (Date.now() < end) { if (await predicate()) return; await delay(25); }
  throw new Error('Generation did not settle');
}
test('React compilation requires no builder and never evaluates page sources', async () => {
  const f = await reactFixture();
  try {
    const prepared = await f.host.ctx.application.prepare(f.request);
    assert.match(await readFile(f.file, 'utf8'), /import\("\.\.\/src\/pages\/index.tsx"\)/);
    assert.doesNotMatch(await readFile(f.file, 'utf8'), /PAGE MUST NOT EXECUTE/);
    assert.equal(f.host.ctx.get('builder'), undefined);
    const first = await stat(f.file); await prepared.close();
    const again = await f.host.ctx.application.prepare(f.request); await again.close();
    assert.equal((await stat(f.file)).mtimeMs, first.mtimeMs);
  } finally { await f.clean(); }
});
test('explicit routes suppress conventions; plugin contributions are validated and retain source IDs', async () => {
  const f = await reactFixture();
  try {
    await writeFile(join(f.root, 'src/pages/[id].tsx'), 'export default () => null;');
    await writeFile(join(f.root, 'src/pages/[slug].tsx'), 'export default () => null;');
    f.host.mount('contribution', { inject: ['react'], apply: ctx => {
      ctx.effect(() => ctx.react.routes.tap({ id: 'extra', owner: 'contribution', ownerOrder: 0,
        run: routes => [...routes, { id: 'plugin:extra', path: 'extra', module: { specifier: './src/pages/index.tsx', exportName: 'default' }, source: { pluginId: 'contribution' } }] }));
    } });
    await f.host.ready();
    const prepared = await f.host.ctx.application.prepare({ ...f.request, options: { routes: [] } });
    assert.match(await readFile(f.file, 'utf8'), /plugin:extra/);
    assert.doesNotMatch(await readFile(f.file, 'utf8'), /\[slug\]/);
    await prepared.close();
  } finally { await f.clean(); }
});
test('development route additions regenerate, conflicts keep previous entry, repair recovers and close stops observation', { timeout: 10000 }, async () => {
  const f = await reactFixture();
  try {
    const prepared = await f.host.ctx.application.prepare({ ...f.request, command: 'dev' });
    await writeFile(join(f.root, 'src/pages/about.tsx'), 'export default () => null;');
    await until(async () => (await readFile(f.file, 'utf8')).includes('about.tsx'));
    const old = await readFile(f.file, 'utf8');
    await writeFile(join(f.root, 'src/pages/about.jsx'), 'export default () => null;');
    await delay(450); assert.equal(await readFile(f.file, 'utf8'), old);
    await unlink(join(f.root, 'src/pages/about.jsx')); await unlink(join(f.root, 'src/pages/about.tsx'));
    await until(async () => !(await readFile(f.file, 'utf8')).includes('about.tsx'));
    await prepared.close(); const closed = await readFile(f.file, 'utf8');
    await writeFile(join(f.root, 'src/pages/late.tsx'), 'export default () => null;');
    await delay(300); assert.equal(await readFile(f.file, 'utf8'), closed);
  } finally { await f.clean(); }
});
test('generator escapes quote/Unicode module references and rejects server/private modules', async () => {
  const f = await reactFixture();
  try {
    const filename = 'src/pages/说"hi.tsx'; await writeFile(join(f.root, filename), 'export default () => null;');
    const routes = [{ id: 'quoted', path: 'quoted', module: { specifier: './' + filename, exportName: 'default' }, source: { file: filename } }];
    const output = await generateApplication(f.root, routes, [], '/', 'root');
    assert.ok(output.includes(JSON.stringify('../' + filename)));
    await assert.rejects(generateApplication(f.root, routes, [], '/', 'root', [join(f.root, filename)]), hasCode('CLIENT_MODULE_INVALID'));
    await assert.rejects(generateApplication(f.root, [{ ...routes[0]!, module: { specifier: '@cormijs/core', exportName: 'default' } }], [], '/', 'root'), hasCode('CLIENT_SERVER_IMPORT'));
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    assert.throws(() => runtimeContributions([{ id: 'a', module: { specifier: './runtime.ts', exportName: 'default' }, options: cycle }]), hasCode('RUNTIME_OPTIONS_INVALID'));
  } finally { await f.clean(); }
});
test('preview preparation does not scan pages, generate code, or require a source HTML entry', async () => {
  const f = await reactFixture();
  try {
    await unlink(join(f.root, 'index.html'));
    const prepared = await f.host.ctx.application.prepare({ ...f.request, command: 'preview' });
    assert.equal(prepared.snapshot, null); await prepared.close();
    await assert.rejects(stat(f.file), { code: 'ENOENT' });
  } finally { await f.clean(); }
});
