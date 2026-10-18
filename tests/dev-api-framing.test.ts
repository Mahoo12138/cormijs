import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage } from 'node:http';
import { DevApiSession, type DevApiOptions } from '@cormijs/plugin-dev-api';
import { listen, close, gate } from './helpers.js';

async function api(t: TestContext, options: DevApiOptions) {
  const session = new DevApiSession(options);
  const server = createServer((req, res) => session.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  const port = await listen(server);
  t.after(async () => { try { await session.close(); } finally { await close(server); } });
  return { url: `http://127.0.0.1:${port}`, session };
}
const limits = { timeout: 12000 };

test('Mock response framing omits 204 Content-Length and suppresses 205 content', limits, async t => {
  const f = await api(t, { mocks: [204, 205, 304].map(status => ({ method: 'GET', path: '/status' + status,
    handle: () => ({ status, body: 'must not be sent' }) })) });
  const empty = await fetch(f.url + '/api/status204');
  assert.equal(empty.status, 204); assert.equal(empty.headers.get('content-length'), null); assert.equal(await empty.text(), '');
  const reset = await fetch(f.url + '/api/status205');
  assert.equal(reset.status, 205); assert.equal(reset.headers.get('content-length'), '0'); assert.equal(await reset.text(), '');
  const cached = await fetch(f.url + '/api/status304');
  assert.equal(cached.status, 304); assert.equal(cached.headers.get('content-length'), null); assert.equal(await cached.text(), '');
});

test('proxy preserves representation length on HEAD and 304 without inventing an empty representation', limits, async t => {
  const upstream = createServer((req, res) => {
    if (req.url === '/cached') { res.writeHead(304, { 'content-length': '321', etag: '"v1"' }); res.end(); }
    else { res.setHeader('content-length', '123'); res.end(req.method === 'HEAD' ? undefined : 'x'.repeat(123)); }
  });
  const port = await listen(upstream); t.after(() => close(upstream));
  const f = await api(t, { proxies: [{ path: '/', target: `http://127.0.0.1:${port}` }] });
  const head = await fetch(f.url + '/api/item', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '123'); assert.equal(await head.text(), '');
  const cached = await fetch(f.url + '/api/cached');
  assert.equal(cached.status, 304); assert.equal(cached.headers.get('content-length'), '321'); assert.equal(await cached.text(), '');
  const get = await fetch(f.url + '/api/item'); assert.equal((await get.text()).length, 123);
});

test('Mock Connection tokens are case insensitive and cannot forward nominated hop headers', limits, async t => {
  const f = await api(t, { mocks: [{ method: 'GET', path: '/headers', handle: () => ({ body: true,
    headers: { Connection: 'X-Internal', 'X-Internal': 'private-hop-value', 'X-Public': 'visible' } }) }] });
  const response = await fetch(f.url + '/api/headers');
  assert.equal(response.headers.get('x-internal'), null); assert.equal(response.headers.get('x-public'), 'visible');
  assert.equal(await response.json(), true);
});

test('a paused response retains its concurrency slot until disconnected, not just until the handler returns', limits, async t => {
  const f = await api(t, { maxConcurrent: 1, maxResponseBytes: 16 * 1024 * 1024, mocks: [
    { method: 'GET', path: '/large', handle: () => ({ body: 'x'.repeat(12 * 1024 * 1024) }) },
    { method: 'GET', path: '/ping', handle: () => ({ body: 'pong' }) },
  ] });
  const outgoing = request(f.url + '/api/large'); outgoing.on('error', () => {});
  const response = new Promise<IncomingMessage>((resolve, reject) => { outgoing.once('response', resolve); outgoing.once('error', reject); });
  outgoing.end(); const paused = await response; paused.pause(); paused.on('error', () => {});
  try {
    const contender = await fetch(f.url + '/api/ping');
    assert.equal(contender.status, 503); assert.deepEqual(await contender.json(), { error: 'DEV_API_BUSY' });
  } finally { paused.destroy(); outgoing.destroy(); }
  // Wait for an observed response, not a fixed sleep: the prior socket may still be closing.
  let status = 503; const until = Date.now() + 3000;
  while (Date.now() < until && status === 503) {
    const next = await fetch(f.url + '/api/ping'); status = next.status; await next.arrayBuffer();
  }
  assert.equal(status, 200);
});

test('the total deadline terminates a backpressured response and releases its admission', limits, async t => {
  const ended = gate();
  const session = new DevApiSession({ timeoutMs: 400, maxConcurrent: 1, maxResponseBytes: 16 * 1024 * 1024, mocks: [
    { method: 'GET', path: '/large', handle: () => ({ body: 'x'.repeat(12 * 1024 * 1024) }) },
    { method: 'GET', path: '/ping', handle: () => ({ body: 'pong' }) },
  ] });
  const server = createServer((req, res) => {
    if (req.url === '/api/large') res.once('close', () => ended.resolve());
    session.middleware(req, res, () => res.end());
  });
  const port = await listen(server); t.after(async () => { try { await session.close(); } finally { await close(server); } });
  const outgoing = request(`http://127.0.0.1:${port}/api/large`); outgoing.on('error', () => {});
  const response = new Promise<IncomingMessage>((resolve, reject) => { outgoing.once('response', resolve); outgoing.once('error', reject); });
  outgoing.end(); const paused = await response; paused.pause(); paused.on('error', () => {});
  try {
    await ended.promise; // A real server-side close event, without client cancellation or a synthetic signal.
    const next = await fetch(`http://127.0.0.1:${port}/api/ping`);
    assert.equal(next.status, 200); assert.equal(await next.json(), 'pong');
  } finally { paused.destroy(); outgoing.destroy(); }
});

test('late handlers and backpressured responses consume distinct slots, not the maximum of separate counts', limits, async t => {
  const release = gate();
  const f = await api(t, { maxConcurrent: 2, timeoutMs: 400, maxResponseBytes: 16 * 1024 * 1024, mocks: [
    { method: 'GET', path: '/late', async handle() { await release.promise; return { body: true }; } },
    { method: 'GET', path: '/large', handle: () => ({ body: 'x'.repeat(12 * 1024 * 1024) }) },
    { method: 'GET', path: '/ping', handle: () => ({ body: true }) },
  ] });
  const late = await fetch(f.url + '/api/late'); assert.equal(late.status, 504); await late.arrayBuffer();
  const outgoing = request(f.url + '/api/large'); outgoing.on('error', () => {});
  const response = new Promise<IncomingMessage>((resolve, reject) => { outgoing.once('response', resolve); outgoing.once('error', reject); });
  outgoing.end(); const paused = await response; paused.pause(); paused.on('error', () => {});
  try {
    const contender = await fetch(f.url + '/api/ping');
    assert.equal(contender.status, 503); assert.deepEqual(await contender.json(), { error: 'DEV_API_BUSY' });
  } finally { release.resolve(); paused.destroy(); outgoing.destroy(); }
});

test('client truncation while collecting JSON does not invoke the handler or prevent the next request', limits, async t => {
  let calls = 0;
  const f = await api(t, { mocks: [{ method: 'POST', path: '/echo', handle: ({ body }) => { calls++; return { body }; } }] });
  const outgoing = request(f.url + '/api/echo', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '1000' } });
  outgoing.on('error', () => {});
  await new Promise<void>(resolve => { outgoing.write('{"unfinished":', () => resolve()); });
  outgoing.destroy();
  const response = await fetch(f.url + '/api/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true }); assert.equal(calls, 1);
});
