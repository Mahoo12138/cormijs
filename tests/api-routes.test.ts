import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { apiRoutePlugin, matchApiRoute, resolveApiRoutes } from '@cormijs/plugin-react-vite';
import { app, cli } from './launcher-helpers.js';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('resolveApiRoutes maps index and dynamic segments, ignoring private and test files', () => {
  const routes = resolveApiRoutes([
    'src/api/index.ts', 'src/api/users.ts', 'src/api/users/[id].ts', 'src/api/_private.ts',
    'src/api/users.test.ts', 'src/api/notes.d.ts', 'src/other.ts', 'src/api/reports/[year]/[month].js',
  ]);
  assert.deepEqual(routes.map(route => route.path), ['/api', '/api/reports/:year/:month', '/api/users', '/api/users/:id']);
  assert.deepEqual(routes.find(route => route.path === '/api/users/:id')?.params, ['id']);
  assert.deepEqual(resolveApiRoutes(['src/api/users.ts'], 'src/api', '/v1'), [{ path: '/v1/users', file: 'src/api/users.ts', params: [] }]);
  assert.throws(() => resolveApiRoutes(['src/api/users/[id].ts', 'src/api/users/[uid].ts']), hasCode('API_ROUTE_CONFLICT'));
  assert.throws(() => resolveApiRoutes(['src/api/users/[9id].ts']), hasCode('API_ROUTE_INVALID'));
  assert.throws(() => resolveApiRoutes(['src/api/bad name.ts']), hasCode('API_ROUTE_INVALID'));
});

test('matchApiRoute prefers static segments, decodes captures and rejects escaped separators', () => {
  const routes = resolveApiRoutes(['src/api/users.ts', 'src/api/users/[id].ts', 'src/api/articles/[id]/comments.ts']);
  assert.deepEqual(matchApiRoute(routes, '/api/users')?.route.path, '/api/users');
  assert.deepEqual(matchApiRoute(routes, '/api/users/42/')?.params, { id: '42' });
  assert.deepEqual(matchApiRoute(routes, '/api/users/a%20b')?.params, { id: 'a b' });
  assert.deepEqual(matchApiRoute(routes, '/api/articles/9/comments')?.params, { id: '9' });
  assert.equal(matchApiRoute(routes, '/api/users/1/extra'), undefined);
  assert.equal(matchApiRoute(routes, '/api/users/a%2Fb'), undefined);
  assert.equal(matchApiRoute(routes, '/api/users/%E0%A4%A'), undefined);
});

test('api route plugin registers its build bridge, validates options and withdraws', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-api-mount 中文-')));
  await mkdir(join(root, 'src/api'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = new ProjectRuntime(3000, root);
  host.mount('vite', vitePlugin);
  host.mount('api', apiRoutePlugin);
  await host.ready();
  assert.ok(host.ctx.vite.ids().includes('cormi:api'));
  await host.unmount('api');
  assert.ok(!host.ctx.vite.ids().includes('cormi:api'));
  await host.dispose();

  for (const options of [{ prefix: '/' }, { prefix: 'api' }, { directory: '../api' }, { directory: '/api' }, { extra: 1 }]) {
    const rejecting = new ProjectRuntime(3000, root);
    rejecting.mount('vite', vitePlugin);
    rejecting.mount('invalid', apiRoutePlugin, options as never);
    await assert.rejects(rejecting.ready(), hasCode('PLUGIN_FAILED'));
    await rejecting.dispose();
  }
});

async function fixture(t: TestContext) {
  const f = await app(t);
  await mkdir(join(f.root, 'src/api/users'), { recursive: true });
  await mkdir(join(f.root, 'src/pages'), { recursive: true });
  await f.write('index.html', '<!doctype html><html><head><meta charset="utf-8" /><title>API demo</title></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>');
  await f.write('src/pages/index.tsx', 'export default () => <main>API demo</main>;');
  await f.write('src/api/index.ts', `export default () => Response.json({ root: true });`);
  await f.write('src/api/health.ts', `export default () => Response.json({ ok: true });`);
  await f.write('src/api/echo.ts', `export default async (request: Request) => new Response(await request.text(), { headers: { 'content-type': 'text/plain' } });`);
  await f.write('src/api/users/[id].ts', `export default (request: Request, { params }: { params: Record<string, string> }) =>
  Response.json({ id: params.id, q: new URL(request.url).searchParams.get('q'), header: request.headers.get('x-test') });`);
  await f.write('src/api/boom.ts', `export default () => { throw new Error('private details'); };`);
  await f.write('cormi.config.ts', `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { apiRoutePlugin } from '@cormijs/plugin-react-vite';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'api', plugin: apiRoutePlugin, options: { id: 'application:api' } }],
  app: { routes: [], server: { port: 0 } },
});
`);
  return f;
}

async function verify(url: string) {
  const request = (path: string, init?: RequestInit) => fetch(new URL(path, url), init);
  const health = await request('api/health'); assert.equal(health.status, 200); assert.deepEqual(await health.json(), { ok: true });
  const root = await request('api'); assert.equal(root.status, 200); assert.deepEqual(await root.json(), { root: true });
  const user = await request('api/users/a%20b?q=term', { headers: { 'x-test': 'yes' } });
  assert.equal(user.status, 200); assert.deepEqual(await user.json(), { id: 'a b', q: 'term', header: 'yes' });
  const echo = await request('api/echo', { method: 'POST', body: 'payload' });
  assert.equal(echo.status, 200); assert.equal(await echo.text(), 'payload');
  const missing = await request('api/missing'); assert.equal(missing.status, 404); assert.deepEqual(await missing.json(), { error: 'API_ROUTE_NOT_FOUND' });
  const failure = await request('api/boom'); assert.equal(failure.status, 500);
  const failureBody = await failure.text(); assert.deepEqual(JSON.parse(failureBody), { error: 'API_HANDLER_FAILED' }); assert.doesNotMatch(failureBody, /private details/);
  const outside = await request('apiary'); assert.match(outside.headers.get('content-type') ?? '', /text\/html/);
}

test('api routes run in dev and from compiled handlers in preview', { timeout: 180000 }, async t => {
  const f = await fixture(t);
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '30000']), ready = await dev.waitFor(event => event.type === 'ready', 0, 30000);
  await verify(ready.url);
  await mkdir(join(f.root, 'src/api/_ignored'), { recursive: true });
  await f.write('src/api/_ignored/hidden.ts', 'export default () => Response.json({ hidden: true });');
  const hidden = await fetch(new URL('api/_ignored/hidden', ready.url)); assert.equal(hidden.status, 404);
  assert.equal(await dev.stop(), 0, JSON.stringify(dev.events) + dev.stderr);

  const build = cli(t, f.root, 'build', ['--startup-timeout', '30000']);
  assert.equal(await build.finish(60000), 0, JSON.stringify(build.events) + build.stderr);
  const manifest = JSON.parse(await readFile(join(f.root, 'dist/.cormi/api/manifest.json'), 'utf8')) as { routes: Array<{ path: string; handler: string }> };
  assert.deepEqual(manifest.routes.map(route => route.path), ['/api', '/api/boom', '/api/echo', '/api/health', '/api/users/:id']);
  assert.ok(manifest.routes.every(route => route.handler.startsWith('.cormi/api/handlers/')));

  const preview = cli(t, f.root, 'preview'), production = await preview.waitFor(event => event.type === 'ready');
  await verify(production.url);
  const denied = await fetch(new URL('.cormi/api/manifest.json', production.url));
  assert.equal(denied.status, 404); assert.doesNotMatch(await denied.text(), /handlers/);
  assert.equal(await preview.stop(), 0, JSON.stringify(preview.events) + preview.stderr);
});
