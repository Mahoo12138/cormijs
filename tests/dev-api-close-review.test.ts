import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage } from 'node:http';
import { DevApiSession } from '@cormijs/plugin-dev-api';
import { DevApiService } from '@cormijs/plugin-dev-api/service';
import { ProjectRuntime } from '@cormijs/core';
import { close, gate, listen } from './helpers.js';

const options = { timeout: 12000 };

test('HTTP session close is the same promise when a cancellation callback reenters close', options, async t => {
  const entered = gate(), cancelled = gate();
  let repeated: Promise<void> | undefined;
  const session = new DevApiSession({ mocks: [{ method: 'GET', path: '/slow', async handle({ signal }) {
    entered.resolve();
    await new Promise<void>(resolve => signal.addEventListener('abort', () => {
      repeated = session.close(); cancelled.resolve(); resolve();
    }, { once: true }));
    return { body: 'late' };
  } }] });
  const server = createServer((req, res) => session.middleware(req, res, () => res.end('fallback')));
  const port = await listen(server);
  t.after(async () => { await session.close(); await close(server); });
  const pending = fetch(`http://127.0.0.1:${port}/api/slow`);
  await entered.promise;
  const closing = session.close(); await cancelled.promise;
  const response = await pending;
  assert.equal(response.status, 503);
  await response.arrayBuffer(); await closing; await repeated;
  assert.equal(repeated, closing, 'Abort listeners must observe the already-installed close promise');
});

test('Cordis service close is the same promise when an owner cancellation reenters close', options, async t => {
  const entered = gate(), cancelled = gate(), host = new ProjectRuntime();
  host.mount('api', DevApiService); await host.ready();
  const service = host.ctx.devApi, handle = service.open();
  let repeated: Promise<void> | undefined;
  service.add('owner', { mocks: [{ method: 'GET', path: '/slow', async handle({ signal }) {
    entered.resolve();
    await new Promise<void>(resolve => signal.addEventListener('abort', () => {
      repeated = service.close(); cancelled.resolve(); resolve();
    }, { once: true }));
    return { body: 'late' };
  } }] });
  const server = createServer((req, res) => handle.middleware(req, res, () => res.end('fallback')));
  const port = await listen(server);
  t.after(async () => { await handle.close(); await host.dispose(); await close(server); });
  const pending = fetch(`http://127.0.0.1:${port}/api/slow`); await entered.promise;
  const closing = service.close(); await cancelled.promise;
  assert.equal((await pending).status, 503); await closing; await repeated;
  assert.equal(repeated, closing, 'Provider close must publish its identity before cancelling owners');
  assert.equal(service.summary().contributions.length, 0);
});

test('withdrawal during partial JSON upload releases the owner without calling its handler', options, async t => {
  const received = gate(), host = new ProjectRuntime(); let calls = 0;
  host.mount('api', DevApiService); await host.ready();
  const service = host.ctx.devApi, handle = service.open();
  const off = service.add('upload', { mocks: [{ method: 'POST', path: '/upload', handle() { calls++; return { body: true }; } }] });
  service.add('peer', { mocks: [{ method: 'GET', path: '/peer', handle: () => ({ body: 'available' }) }] });
  const server = createServer((req, res) => {
    if (req.url === '/api/upload') req.once('data', () => received.resolve());
    handle.middleware(req, res, () => res.end('fallback'));
  });
  const port = await listen(server), url = `http://127.0.0.1:${port}`;
  const outgoing = request(url + '/api/upload', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 100 } });
  const response = new Promise<IncomingMessage>((resolve, reject) => { outgoing.once('response', resolve); outgoing.once('error', reject); });
  t.after(async () => { outgoing.destroy(); await handle.close(); await host.dispose(); await close(server); });
  outgoing.write('{"value":'); await received.promise;
  await off(); const incoming = await response; const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  assert.equal(incoming.statusCode, 503);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { error: 'DEV_API_WITHDRAWN' });
  assert.equal(calls, 0);
  assert.equal(await (await fetch(url + '/api/peer')).json(), 'available');
  assert.equal((await fetch(url + '/api/upload', { method: 'POST', body: '{}' })).status, 404);
});
