import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { appRuntimePlugin, reactPlugin, requestPlugin } from '@cormijs/plugin-react';
import { RequestError, createRequestClient } from '@cormijs/runtime';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';
import { close, listen } from './helpers.js';

test('request client resolves base URLs, params, JSON bodies, errors, timeouts and cancellation', async t => {
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    if (url.pathname === '/hello') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ message: 'hello', query: url.searchParams.get('q'), header: request.headers['x-app'] }));
    } else if (url.pathname === '/echo') {
      const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)).on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ body: Buffer.concat(chunks).toString(), type: request.headers['content-type'] }));
      });
    } else if (url.pathname === '/error') {
      response.statusCode = 500; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ message: 'failed' }));
    } else if (url.pathname === '/slow') {
      setTimeout(() => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ slow: true })); }, 200);
    } else { response.statusCode = 404; response.end('missing'); }
  });
  const port = await listen(server); t.after(() => close(server));
  const client = createRequestClient({ baseURL: `http://127.0.0.1:${port}`, headers: { 'x-app': 'cormi' } });
  assert.deepEqual(await client.get('/hello', { params: { q: 'one' } }), { message: 'hello', query: 'one', header: 'cormi' });
  assert.deepEqual(await client.post('/echo', { value: 1 }), { body: '{"value":1}', type: 'application/json' });
  await assert.rejects(client.get('/error'), (error: unknown) => error instanceof RequestError && error.status === 500 && (error.data as { message: string }).message === 'failed');
  const timeout = createRequestClient({ baseURL: `http://127.0.0.1:${port}`, timeout: 20 });
  await assert.rejects(timeout.get('/slow'), (error: unknown) => error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name));
  const controller = new AbortController();
  const aborted = client.get('/slow', { signal: controller.signal }); controller.abort();
  await assert.rejects(aborted, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  for (const config of [{ baseURL: 42 }, { timeout: 0 }, { headers: { x: 1 } },
    { cachePersist: 'memory' }, { cachePersistKey: 'orphan' }, { cachePersist: 'session', cachePersistKey: '' }]) {
    assert.throws(() => createRequestClient(config as never), /REQUEST_INVALID/);
  }
});

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-request 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  await writeFile(join(root, 'src/app.tsx'), 'import { defineApp } from "@cormijs/runtime"; export default defineApp({ request: { baseURL: "https://api.test" } });');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request, code: () => readFile(join(root, '.cormi/app.tsx'), 'utf8') };
}

test('request plugin contributes its key and provider, then withdraws', async t => {
  const f = await project(t);
  f.host.mount('app', appRuntimePlugin); f.host.mount('request', requestPlugin, { id: 'app:request' }); await f.host.ready();
  const session = await f.host.ctx.application.prepare(f.request); await session.close();
  const code = await f.code();
  assert.match(code, /requestRuntime/); assert.match(code, /\["request"\]/);
  const inspection = readInspection(f.root).summary as { appRuntime: { keys: string[] }, runtime: Array<{ id: string }> };
  assert.ok(inspection.appRuntime.keys.includes('request'));
  assert.ok(inspection.runtime.some(item => item.id === 'app:request'));
  await f.host.unmount('request');
  const removed = await f.host.ctx.application.prepare(f.request); await removed.close();
  assert.doesNotMatch(await f.code(), /requestRuntime/);
});
