import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { applyDefines, definePlugin, mergeDefines, resolveDefines } from '@cormijs/plugin-react-vite';

const invalid = (code: string) => (error: any) => error?.code === code;

test('resolveDefines serializes values, blocks reserved keys and rejects malformed input', async () => {
  const entries = resolveDefines({ APP_NAME: 'cormi', VERSION: 2, FLAGS: { beta: true }, NOTHING: null, 'process.env.APP_MODE': 'dev' });
  assert.deepEqual(entries.map(({ key }) => key), ['APP_NAME', 'FLAGS', 'NOTHING', 'VERSION', 'process.env.APP_MODE']);
  assert.equal(entries.find(({ key }) => key === 'APP_NAME')!.code, '"cormi"');
  assert.equal(entries.find(({ key }) => key === 'VERSION')!.code, '2');
  assert.equal(entries.find(({ key }) => key === 'NOTHING')!.code, 'null');
  assert.equal(entries.find(({ key }) => key === 'process.env.APP_MODE')!.code, '"dev"');
  assert.throws(() => resolveDefines('nope'), invalid('DEFINE_INVALID'));
  assert.throws(() => resolveDefines({}), invalid('DEFINE_INVALID'));
  assert.throws(() => resolveDefines({ APP: undefined }), invalid('DEFINE_INVALID'));
  assert.throws(() => resolveDefines({ APP: () => 1 }), invalid('DEFINE_INVALID'));
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  assert.throws(() => resolveDefines({ APP: cyclic }), invalid('DEFINE_INVALID'));
  for (const key of ['1APP', 'a-b', 'process.env.NODE_ENV', 'process.env', 'import.meta.env.FOO', 'globalThis', 'this.x', 'APP\u0000']) {
    assert.throws(() => resolveDefines({ [key]: 1 }), invalid('DEFINE_INVALID'), key);
  }
  assert.throws(() => resolveDefines({ APP: 1, 'APP.SUB': 2 }), invalid('DEFINE_INVALID'));
  assert.throws(() => resolveDefines(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`K${index}`, 1]))), invalid('DEFINE_INVALID'));
  assert.throws(() => resolveDefines({ APP: 'x'.repeat(5000) }), invalid('DEFINE_INVALID'));
});

test('applyDefines reprints only modules that mention a key and keeps boundaries and non-target files', async () => {
  const defines = { APP_NAME: '"cormi"', FLAGS: '{"beta":true}' };
  const source = 'const label = APP_NAME;\nconst raw = "APP_NAME";\nconst other = APP_NAMEX;\nexport const merged = { FLAGS, raw, other, label };\n';
  const replaced = await applyDefines(defines, source, '/project/src/app.tsx');
  assert.ok(replaced);
  assert.match(replaced.code, /const label = "cormi";/);
  assert.match(replaced.code, /const raw = "APP_NAME";/);
  assert.match(replaced.code, /const other = APP_NAMEX;/);
  assert.match(replaced.code, /FLAGS: /);
  assert.doesNotMatch(replaced.code, /\{ FLAGS,/);
  assert.ok(JSON.parse(replaced.map).version);
  assert.equal(await applyDefines(defines, 'body { color: red }', '/project/src/style.css'), undefined);
  assert.equal(await applyDefines(defines, 'export const plain = 1;\n', '/project/src/plain.ts'), undefined);
});

test('mergeDefines keeps other sources but lets configured defines win', async () => {
  assert.deepEqual(mergeDefines({ OTHER: '"keep"', APP: '"vite"' }, [{ key: 'APP', code: '"cormi"' }]), { OTHER: '"keep"', APP: '"cormi"' });
  assert.deepEqual(mergeDefines(undefined, [{ key: 'APP', code: '1' }]), { APP: '1' });
});

test('define plugin registers its native bridge and withdraws cleanly', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-define-mount 中文-')));
  await mkdir(join(root, 'src'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = new ProjectRuntime(3000, root);
  host.mount('vite', vitePlugin);
  host.mount('define', definePlugin, { values: { APP_NAME: 'cormi' } });
  await host.ready();
  assert.ok(host.ctx.vite.ids().includes('cormi:define'));
  await host.unmount('define');
  assert.ok(!host.ctx.vite.ids().includes('cormi:define'));
  await host.dispose();

  const rejecting = new ProjectRuntime(3000, root);
  rejecting.mount('vite', vitePlugin);
  rejecting.mount('invalid', definePlugin, { values: { 'process.env.NODE_ENV': 'x' }, extra: 1 } as any);
  await assert.rejects(rejecting.ready(), (error: any) => error?.code === 'PLUGIN_FAILED');
  await rejecting.dispose();
});
