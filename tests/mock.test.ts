import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { mockPlugin } from '@cormijs/plugin-dev-api';
import { DevApiService } from '@cormijs/plugin-dev-api/service';
import { close, listen } from './helpers.js';

async function project(t: TestContext, mock = `export default {
  'GET /api/users': { body: { users: ['one'] } },
  'POST /api/echo': request => ({ status: 201, body: request.body }),
  'GET /plain': { body: { plain: true } },
};`) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-mock 中文-'))), host = new ProjectRuntime(3000, root);
  await mkdir(join(root, 'mock'), { recursive: true });
  await writeFile(join(root, 'mock/users.ts'), mock);
  host.mount('dev-api', DevApiService); host.mount('mock', mockPlugin, { intervalMs: 50 }); await host.ready();
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, async server() {
    const handle = host.ctx.devApi.open();
    const server = createServer((request, response) => handle.middleware(request, response, () => { response.statusCode = 404; response.end('missing'); }));
    const port = await listen(server); t.after(() => close(server)); return { url: `http://127.0.0.1:${port}`, handle };
  } };
}

test('mock convention discovers TS files, maps prefixed paths and reloads changed files', async t => {
  const f = await project(t), server = await f.server();
  const users = await fetch(server.url + '/api/users'); assert.deepEqual(await users.json(), { users: ['one'] });
  const plain = await fetch(server.url + '/api/plain'); assert.deepEqual(await plain.json(), { plain: true });
  const echo = await fetch(server.url + '/api/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 1 }) });
  assert.equal(echo.status, 201); assert.deepEqual(await echo.json(), { value: 1 });
  await writeFile(join(f.root, 'mock/users.ts'), `export default { 'GET /api/users': { body: { users: ['two'] } } };`);
  const end = Date.now() + 3000; let value: unknown;
  while (Date.now() < end) { value = await (await fetch(server.url + '/api/users')).json(); if ((value as { users: string[] }).users[0] === 'two') break; await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.deepEqual(value, { users: ['two'] });
});

test('mock convention rejects malformed modules without registering rules', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-mock-invalid 中文-'))), host = new ProjectRuntime(3000, root);
  await mkdir(join(root, 'mock'), { recursive: true }); await writeFile(join(root, 'mock/bad.ts'), 'export default [];');
  host.mount('dev-api', DevApiService); host.mount('mock', mockPlugin);
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  await assert.rejects(host.ready(), (error: any) => error?.code === 'PLUGIN_FAILED' && error?.cause?.code === 'MOCK_INVALID');
});
