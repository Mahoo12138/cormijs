import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectRuntime, type Plugin } from '@cormijs/core';
import { DevApiService, type DevApiRules } from '@cormijs/plugin-dev-api/service';
import type { DevApiOptions } from '@cormijs/plugin-dev-api';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';
import { vitePlugin } from '@cormijs/plugin-vite';
import { listen, close, gate, hasCode, fixture, assertPortFree } from './helpers.js';

const limits = { timeout: 15000 };
const rule = (path: string, value: unknown) => ({ method: 'GET', path, handle: () => ({ body: value }) });
const contributor = (id: string, rules: DevApiRules): Plugin.Object<void> => ({ name: id, inject: ['devApi'], apply(ctx) { ctx.devApi.add(id, rules); } });
async function api(t: TestContext, options: DevApiOptions = {}) {
  const host = new ProjectRuntime(); host.mount('api', DevApiService, options); await host.ready();
  const service = host.ctx.devApi, handle = service.open();
  const server = createServer((req, res) => handle.middleware(req, res, () => { res.statusCode = 418; res.end('application'); }));
  const port = await listen(server);
  t.after(async () => { try { await handle.close(); await host.dispose(); } finally { await close(server); } });
  return { host, service, handle, url: `http://127.0.0.1:${port}` };
}

test('DevApiService uses the caller scope and native nested plugins, not the provider lifetime', limits, async t => {
  const f = await api(t);
  const parent = f.host.mount('feature', { name: 'feature', apply(ctx) {
    ctx.plugin(contributor('feature:child', { mocks: [rule('/child', 'child')] }));
  } });
  const other = f.host.mount('other', contributor('other', { mocks: [rule('/other', 'other')] }));
  await f.host.ready();
  assert.equal(await (await fetch(f.url + '/api/child')).json(), 'child');
  assert.equal(f.service.summary().contributions.find(x => x.id === 'feature:child')?.owner, 'feature:child');
  await parent.dispose();
  assert.equal((await fetch(f.url + '/api/child')).status, 404);
  assert.equal(await (await fetch(f.url + '/api/other')).json(), 'other');
  await other.dispose(); assert.equal(f.service.summary().contributions.length, 0);
});

test('rule additions on an already-open server are atomic and summaries omit proxy destinations', limits, async t => {
  const f = await api(t);
  f.service.add('first', { mocks: [rule('/hello', 'first')], proxies: [{ path: '/remote', target: 'http://127.0.0.1:9/private-base' }] });
  const before = f.service.summary();
  assert.throws(() => f.service.add('second', { mocks: [rule('/new', true), rule('/hello', false)] }), hasCode('DEV_API_RULE_CONFLICT'));
  assert.throws(() => f.service.add('proxy-conflict', { proxies: [{ path: '/remote', target: 'http://localhost:8' }] }), hasCode('DEV_API_RULE_CONFLICT'));
  assert.deepEqual(f.service.summary(), before);
  assert.equal((await fetch(f.url + '/api/new')).status, 404);
  assert.equal(await (await fetch(f.url + '/api/hello')).json(), 'first');
  assert.doesNotMatch(JSON.stringify(before), /127\.0\.0\.1|private-base|target|handle/);
  assert.throws(() => f.service.add('first', {}), hasCode('DEV_API_ID_CONFLICT'));
  assert.throws(() => f.service.add('../bad', {}), hasCode('DEV_API_ID_INVALID'));
  assert.throws(() => f.service.add('invalid', { prefix: '/steal' } as DevApiRules), hasCode('DEV_API_CONFIG_INVALID'));
});

test('withdrawal cancels one owner, waits for admitted work, and an old disposer cannot erase its replacement', limits, async t => {
  const f = await api(t), entered = gate(), aborted = gate(), release = gate();
  const off = f.service.add('replaceable', { mocks: [{ method: 'GET', path: '/slow', async handle({ signal }) {
    entered.resolve(); signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    await release.promise; return { body: 'obsolete' };
  } }] });
  f.service.add('peer', { mocks: [rule('/peer', 'unaffected')] });
  try {
    const pending = fetch(f.url + '/api/slow'); await entered.promise;
    const retiring = off(); assert.equal(off(), retiring); await aborted.promise;
    let done = false; void retiring.then(() => { done = true; });
    const response = await pending; assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'DEV_API_WITHDRAWN' });
    assert.equal(done, false);
    f.service.add('replaceable', { mocks: [rule('/slow', 'replacement')] });
    assert.equal(await (await fetch(f.url + '/api/slow')).json(), 'replacement');
    assert.equal(await (await fetch(f.url + '/api/peer')).json(), 'unaffected');
    release.resolve(); await retiring; await off();
    assert.equal(await (await fetch(f.url + '/api/slow')).json(), 'replacement');
  } finally { release.resolve(); }
});

test('contributors share admission budget while a withdrawn noncooperative handler is still draining', limits, async t => {
  const f = await api(t, { maxConcurrent: 1 }), entered = gate(), release = gate();
  const off = f.service.add('slow', { mocks: [{ method: 'GET', path: '/slow', async handle() { entered.resolve(); await release.promise; return { body: true }; } }] });
  f.service.add('peer', { mocks: [rule('/peer', true)] });
  try {
    const pending = fetch(f.url + '/api/slow'); await entered.promise;
    const retiring = off(); assert.equal((await pending).status, 503);
    const busy = await fetch(f.url + '/api/peer'); assert.equal(busy.status, 503); assert.deepEqual(await busy.json(), { error: 'DEV_API_BUSY' });
    release.resolve(); await retiring;
    assert.equal((await fetch(f.url + '/api/peer')).status, 200);
  } finally { release.resolve(); }
});

test('cross-owner HEAD specificity, Mock precedence and longest proxy prefix use the shared table', limits, async t => {
  const upstream = createServer((req, res) => res.end(req.url)); const port = await listen(upstream); t.after(() => close(upstream));
  const f = await api(t);
  f.service.add('fallback', { mocks: [rule('/hello', 'get')], proxies: [{ path: '/', target: `http://127.0.0.1:${port}/fallback` }] });
  f.service.add('special', { mocks: [{ method: 'HEAD', path: '/hello', handle: () => ({ headers: { 'x-special': 'head' } }) }], proxies: [{ path: '/remote', target: `http://127.0.0.1:${port}/v1`, stripPrefix: true }] });
  const head = await fetch(f.url + '/api/hello', { method: 'HEAD' }); assert.equal(head.headers.get('x-special'), 'head'); assert.equal(await head.text(), '');
  assert.equal(await (await fetch(f.url + '/api/hello')).json(), 'get');
  assert.equal(await (await fetch(f.url + '/api/remote/a%2Fb?q=%E4%B8%AD')).text(), '/v1/a%2Fb?q=%E4%B8%AD');
  assert.equal(await (await fetch(f.url + '/api/remotely')).text(), '/fallback/remotely');
});

test('withdrawing a proxy owner cancels its real upstream socket but not another contributor', limits, async t => {
  const entered = gate(), disconnected = gate();
  const upstream = createServer((_req, res) => { entered.resolve(); res.once('close', () => disconnected.resolve()); });
  const port = await listen(upstream); t.after(() => close(upstream)); const f = await api(t);
  const off = f.service.add('upstream', { proxies: [{ path: '/upstream', target: `http://127.0.0.1:${port}`, stripPrefix: true }] });
  f.service.add('peer', { mocks: [rule('/peer', true)] });
  const pending = fetch(f.url + '/api/upstream/wait'); await entered.promise; await off();
  assert.equal((await pending).status, 503); await disconnected.promise;
  assert.equal((await fetch(f.url + '/api/peer')).status, 200);
});

test('withdrawal retains a response lease until a backpressured response is terminated', limits, async t => {
  const f = await api(t, { maxConcurrent: 1, maxResponseBytes: 16 * 1024 * 1024 });
  const off = f.service.add('large', { mocks: [rule('/large', 'x'.repeat(12 * 1024 * 1024))] });
  f.service.add('peer', { mocks: [rule('/peer', true)] });
  const outgoing = request(f.url + '/api/large'); outgoing.on('error', () => {});
  const pending = new Promise<IncomingMessage>((resolve, reject) => { outgoing.once('response', resolve); outgoing.once('error', reject); });
  outgoing.end(); const paused = await pending; paused.pause(); paused.on('error', () => {});
  try {
    const busy = await fetch(f.url + '/api/peer'); assert.equal(busy.status, 503); await busy.arrayBuffer();
    await off();
    assert.equal((await fetch(f.url + '/api/peer')).status, 200);
    assert.equal((await fetch(f.url + '/api/large')).status, 404);
  } finally { paused.destroy(); outgoing.destroy(); }
});

test('separate Cordis projects do not share contribution identities or withdrawal', limits, async t => {
  const first = await api(t), second = await api(t);
  const off = first.service.add('same', { mocks: [rule('/value', 'first')] });
  second.service.add('same', { mocks: [rule('/value', 'second')] });
  assert.equal(await (await fetch(first.url + '/api/value')).json(), 'first');
  assert.equal(await (await fetch(second.url + '/api/value')).json(), 'second');
  await off(); assert.equal((await fetch(first.url + '/api/value')).status, 404);
  assert.equal(await (await fetch(second.url + '/api/value')).json(), 'second');
});

test('native provider replacement reactivates consumers and closes old session handles', limits, async () => {
  const host = new ProjectRuntime(); let starts = 0;
  const consumer = host.mount('consumer', { name: 'consumer', inject: ['devApi'], apply(ctx) { starts++; ctx.devApi.add('consumer', { mocks: [rule('/value', starts)] }); } });
  const provider = host.mount('provider', DevApiService); await host.ready();
  const old = host.ctx.devApi, oldHandle = old.open(); assert.equal(starts, 1);
  await host.unmount('provider'); assert.equal(old.summary().contributions.length, 0);
  assert.throws(() => old.add('late', {})); await oldHandle.close();
  host.mount('replacement', DevApiService); await host.ready(); assert.equal(starts, 2);
  assert.deepEqual(host.ctx.devApi.summary().contributions.map(x => x.id), ['consumer']);
  await consumer.dispose(); await host.dispose();
});

test('noncooperative withdrawal reports its deadline rather than pretending resource cleanup succeeded', limits, async t => {
  const f = await api(t), entered = gate(), release = gate();
  const off = f.service.add('hang', { mocks: [{ method: 'GET', path: '/hang', async handle() { entered.resolve(); await release.promise; return { body: true }; } }] });
  try {
    const pending = fetch(f.url + '/api/hang'); await entered.promise;
    const retiring = off(); assert.equal((await pending).status, 503);
    await assert.rejects(retiring, hasCode('DEV_API_CLEANUP_TIMEOUT'));
    release.resolve(); await delay(20);
  } finally { release.resolve(); }
});

test('service closure refuses reentrant registration from an abort callback', limits, async t => {
  const f = await api(t), entered = gate(); let rejected = false;
  f.service.add('owner', { mocks: [{ method: 'GET', path: '/slow', async handle({ signal }) {
    entered.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => {
      try { f.service.add('reentrant', {}); } catch { rejected = true; } resolve();
    }, { once: true })); return { body: true };
  } }] });
  const pending = fetch(f.url + '/api/slow'); await entered.promise; await f.service.close();
  assert.equal((await pending).status, 503); assert.equal(rejected, true); assert.equal(f.service.summary().contributions.length, 0);
});

test('Vite composition shares the service with independent consumers and retracts without server restart', limits, async () => {
  const f = await fixture('/admin/'), host = new ProjectRuntime(); host.mount('vite', vitePlugin); host.mount('api', devApiVitePlugin, {});
  const one = host.mount('one', contributor('one', { mocks: [rule('/one', true)] }));
  host.mount('two', contributor('two', { mocks: [rule('/two', true)] }));
  try {
    await host.ready(); const server = await host.ctx.builder.dev(f.plan);
    assert.equal((await fetch(new URL('/api/one', server.url))).status, 200);
    await one.dispose(); assert.equal((await fetch(new URL('/api/one', server.url))).status, 404);
    assert.equal((await fetch(new URL('/api/two', server.url))).status, 200);
    assert.equal((await fetch(server.url)).status, 200);
    await server.close(); await assertPortFree(Number(new URL(server.url).port));
    await host.ctx.builder.build(f.plan); const preview = await host.ctx.builder.preview(f.plan);
    assert.doesNotMatch(await (await fetch(new URL('/api/two', preview.url))).text(), /true/);
    await preview.close();
  } finally { await host.dispose(); await f.clean(); }
});
