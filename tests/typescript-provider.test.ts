import test from 'node:test';
import assert from 'node:assert/strict';
import { cp } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { ProjectRuntime, type Plugin } from '@cormijs/core';
import { reactPlugin } from '@cormijs/plugin-react';
import { typecheckCommandPlugin, type TypeChecker, type TypecheckResult } from '@cormijs/plugin-typescript';
import { commandPlugin } from '../packages/cormi/dist/commands.js';
import { app } from './launcher-helpers.js';
import { gate, hasCode } from './helpers.js';
import { until } from '../scripts/reliability/resources.js';

const value = (name: string): TypecheckResult => ({ compiler: name, version: 'test-double', files: 0, generatedFiles: [], mode: 'single', projects: [], virtualDeclarations: 0 });
const request = (root: string, signal = new AbortController().signal) => ({ root, mode: 'test', options: {}, signal });

test('the same typecheck consumer can lose and replace its native checker without fallback or a Vite provider', async t => {
  const f = await app(t), source = resolve('examples/basic');
  await cp(source, f.root, { recursive: true, filter: item => !relative(source, item).split(sep).some(p => ['node_modules','.cormi','.cormi.lock','dist'].includes(p)) });
  const host = new ProjectRuntime(); host.mount('commands', commandPlugin); host.mount('react', reactPlugin); host.mount('consumer', typecheckCommandPlugin);
  const provider = (name: string): Plugin.Object<void> => ({ apply(ctx) { ctx.provide('typechecker', { check: async () => value(name) } satisfies TypeChecker); } });
  try {
    await assert.rejects(host.ready(), hasCode('SERVICE_MISSING'));
    host.mount('checker-a', provider('a')); await host.ready();
    let result = await host.ctx.commands.execute('typecheck', request(f.root));
    assert.equal(result.kind === 'result' && (result.data as TypecheckResult).compiler, 'a');
    await host.unmount('checker-a'); assert.deepEqual(host.ctx.commands.names(), []);
    host.mount('checker-b', provider('b')); await host.ready();
    result = await host.ctx.commands.execute('typecheck', request(f.root));
    assert.equal(result.kind === 'result' && (result.data as TypecheckResult).compiler, 'b');
    assert.equal(host.ctx.get('builder'), undefined); assert.equal(host.ctx.get('vite'), undefined);
  } finally { await host.dispose(); }
});

test('withdrawal cancels and drains an accepted checker before native unmount completes', async t => {
  const f = await app(t), source = resolve('examples/basic');
  await cp(source, f.root, { recursive: true, filter: item => !relative(source, item).split(sep).some(p => ['node_modules','.cormi','.cormi.lock','dist'].includes(p)) });
  const host = new ProjectRuntime(), entered = gate(), release = gate(); let cancelled = false, finished = false;
  host.mount('commands', commandPlugin); host.mount('react', reactPlugin); host.mount('consumer', typecheckCommandPlugin);
  host.mount('checker', { apply(ctx) { ctx.provide('typechecker', { async check(_root, _files, signal) {
    signal.addEventListener('abort', () => { cancelled = true; }, { once: true }); entered.resolve(); await release.promise; return value('late');
  } } satisfies TypeChecker); } });
  try {
    await host.ready(); const work = host.ctx.commands.execute('typecheck', request(f.root));
    const rejected = assert.rejects(work, error => error instanceof Error && error.name === 'AbortError');
    await entered.promise; const unmount = host.unmount('checker').then(() => { finished = true; });
    await until(() => cancelled, 'checker receives native consumer cancellation'); assert.equal(finished, false);
    release.resolve(); await rejected; await unmount; assert.equal(finished, true); assert.deepEqual(host.ctx.commands.names(), []);
  } finally { release.resolve(); await host.dispose(); }
});

test('a prepared application acquired after cancellation is closed without invoking the checker', async t => {
  const f = await app(t), host = new ProjectRuntime(), entered = gate(), release = gate(), controller = new AbortController();
  let closed = 0, checked = 0;
  host.mount('commands', commandPlugin); host.mount('consumer', typecheckCommandPlugin);
  host.mount('services', { apply(ctx) {
    ctx.provide('typechecker', { check: async () => { checked++; return value('unused'); } } satisfies TypeChecker);
    ctx.provide('application', { async prepare() { entered.resolve(); await release.promise; return {
      plan: { root: f.root, entry: 'index.html', outDir: 'dist', mode: 'test', base: '/' }, snapshot: {},
      typecheck: { files: [] }, async close() { closed++; },
    }; } });
  } });
  try {
    await host.ready(); const work = host.ctx.commands.execute('typecheck', request(f.root, controller.signal));
    const rejected = assert.rejects(work, error => error instanceof Error && error.name === 'AbortError');
    await entered.promise; controller.abort(); release.resolve(); await rejected; assert.equal(checked, 0); assert.equal(closed, 1);
  } finally { release.resolve(); await host.dispose(); }
});
