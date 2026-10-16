import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectRuntime } from '@cormijs/core';
import { commandPlugin } from '../packages/cormi/dist/commands.js';
import { hasCode } from './helpers.js';

test('command registrations are scoped; duplicate names fail and unregister removes dispatch', async () => {
  const host = new ProjectRuntime(); host.mount('registry', commandPlugin);
  host.mount('custom', { inject: ['commands'], apply: ctx => {
    ctx.effect(() => ctx.commands.register('hello', async () => ({ kind:'result', data:'ok' })));
  } });
  try {
    await host.ready(); const request = { root:'/project', mode:'test', options:{}, signal:new AbortController().signal };
    assert.deepEqual(await host.ctx.commands.execute('hello', request), {kind:'result',data:'ok'});
    assert.throws(() => host.ctx.commands.register('hello', async () => ({kind:'result',data:0})), hasCode('COMMAND_CONFLICT'));
    await host.unmount('custom'); assert.deepEqual(host.ctx.commands.names(), []);
    await assert.rejects(host.ctx.commands.execute('hello', request), hasCode('COMMAND_MISSING'));
  } finally { await host.dispose(); }
});
