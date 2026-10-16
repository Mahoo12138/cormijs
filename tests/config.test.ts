import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, defineConfig, definePreset } from '../packages/cormi/dist/config.js';
import { compileConfig, ConfigCompileError } from '../packages/cormi/dist/compiler.js';
import { writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { hasCode, fixture } from './helpers.js';

const plugin = { apply: () => {} };
test('preset composition preserves explicit identities, replaces arrays and freezes application data', () => {
  const config = defineConfig({ presets: [definePreset({ id: 'outer',
    presets: [{ id: 'inner', defaults: { server: { host: '127.0.0.1', port: 1 }, list: [1, 2] } }],
    plugins: [{ id: 'one', plugin }, { id: 'disabled', plugin, enabled: false }],
    defaults: { server: { port: 2 } },
  })], plugins: [{ id: 'two', plugin }], app: { list: [3], server: { port: 3 } } });
  const normalized = normalizeConfig(config, '/project');
  assert.deepEqual(normalized.plugins.map(p => p.id), ['one', 'two']);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.app)), { server: { host: '127.0.0.1', port: 3 }, list: [3] });
  assert.equal(Object.isFrozen(normalized.app.server), true);
  assert.deepEqual(config.app.list, [3]);
});

test('configuration rejects unknown fields, duplicate IDs, invalid plugins and non-JSON app data', () => {
  for (const input of [null, [], { plguins: [] }, { app: { a: NaN } }, { app: { fn() {} } },
    { plugins: [{ id: 'same', plugin }, { id: 'same', plugin }] }, { plugins: [{ id: 'bad', plugin: 1 }] },
    { plugins: [{ id: 'cormi:commands', plugin }] }, { watch: ['../outside.ts'] },
    { app: JSON.parse('{"__proto__":{"polluted":true}}') }]) {
    assert.throws(() => normalizeConfig(input, '/project'), hasCode('CONFIG_INVALID'));
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('cyclic presets and cyclic app objects fail without recursion overflow', () => {
  const preset: any = { id: 'cycle', presets: [] }; preset.presets.push(preset);
  assert.throws(() => normalizeConfig({ presets: [preset] }, '/project'), hasCode('CONFIG_INVALID'));
  const app: any = {}; app.self = app;
  assert.throws(() => normalizeConfig({ app }, '/project'), hasCode('CONFIG_INVALID'));
});

test('static config compilation follows local dependencies without evaluating top-level user code', { timeout: 8000 }, async () => {
  const f = await fixture(); const root = await realpath(f.root);
  try {
    await writeFile(join(root, 'settings.ts'), 'export const value: string = "v1";');
    await writeFile(join(root, 'cormi.config.ts'), `import {value} from './settings'; throw new Error('must not execute'); export default {app:{value, source:import.meta.url}};`);
    const result = await compileConfig(root);
    assert.ok(result.files.includes(join(root, 'settings.ts')));
    assert.match(result.code, /v1/); assert.match(result.code, /cormi.config.ts/);
    assert.equal(result.fingerprint.length, 64);
  } finally { await f.clean(); }
});

test('failed resolution retains missing file candidates for later recovery', { timeout: 8000 }, async () => {
  const f = await fixture(); const root = await realpath(f.root);
  try {
    await writeFile(join(root, 'cormi.config.ts'), `import {value} from './missing'; export default {app:{value}};`);
    await assert.rejects(compileConfig(root), error => error instanceof ConfigCompileError && error.files.includes(join(root, 'missing.ts')));
  } finally { await f.clean(); }
});
