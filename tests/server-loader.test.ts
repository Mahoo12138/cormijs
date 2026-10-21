import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { expandRouteConfig, routesFromFiles, validateRoutes } from '@cormijs/routes';
import { renderServerApplication, renderServerLoaderData, serverLoaderExport, type ServerApplication } from '@cormijs/runtime/server';

const hasCode = (code: string) => (error: any) => error?.code === code;
const page = { specifier: './src/pages/user.tsx', exportName: 'default' };
const stub = (routeId: string) => Object.assign(() => { throw new Error(`stub called for ${routeId}`); }, { cormiServerLoaderStub: routeId });

test('route IR validates serverLoader separately from clientLoader', () => {
  const routes = validateRoutes([{ id: 'user', path: 'users/:id', module: page, serverLoader: 'serverLoader' }]);
  assert.equal(routes[0]?.serverLoader, 'serverLoader');
  assert.equal(routesFromFiles(['src/pages/user.tsx'], 'src/pages', {}, { 'src/pages/user.tsx': 'serverLoader' })[0]?.serverLoader, 'serverLoader');
  const configured = expandRouteConfig([{ path: 'user', component: './src/pages/user.tsx', serverLoader: 'serverLoader' }]);
  assert.equal(configured[0]?.serverLoader, 'serverLoader');

  assert.throws(() => validateRoutes([{ id: 'both', path: 'both', module: page, clientLoader: 'clientLoader', serverLoader: 'serverLoader' }]), hasCode('ROUTE_SERVER_LOADER_INVALID'));
  assert.throws(() => validateRoutes([{ id: 'missing', path: 'missing', serverLoader: 'serverLoader' }]), hasCode('ROUTE_SERVER_LOADER_INVALID'));
  assert.throws(() => validateRoutes([{ id: 'bad', path: 'bad', module: page, serverLoader: '2bad' }]), hasCode('ROUTE_SERVER_LOADER_INVALID'));
  assert.throws(() => expandRouteConfig([{ path: 'both', component: './src/pages/user.tsx', clientLoader: 'clientLoader', serverLoader: 'serverLoader' }]), hasCode('ROUTE_SERVER_LOADER_INVALID'));
  assert.throws(() => expandRouteConfig([{ path: 'redirect', redirect: '/login', serverLoader: 'serverLoader' }]), hasCode('ROUTE_SERVER_LOADER_INVALID'));
});

test('serverLoaderExport defers a missing export to the route request', async () => {
  const missing = serverLoaderExport({}, 'serverLoader', 'user');
  await assert.rejects(async () => missing({ request: new Request('http://localhost/'), params: {} }), /SERVER_LOADER_INVALID/);
  const found = serverLoaderExport({ serverLoader: ({ params }: { params: Record<string, string | undefined> }) => params.id }, 'serverLoader', 'user');
  assert.equal(await found({ request: new Request('http://localhost/users/7'), params: { id: '7' } }), '7');
});

test('renderServerLoaderData runs matched loaders in order, strips base and serializes JSON', async () => {
  const order: string[] = [];
  const application: ServerApplication = {
    base: '/app/',
    routes: [{ id: 'shell', path: '/', loader: stub('shell'), children: [{ id: 'user', path: 'users/:id', loader: stub('user') }] }],
    serverLoaders: {
      shell: ({ request }) => { order.push('shell'); return { path: new URL(request.url).pathname }; },
      user: async ({ params }) => { order.push('user'); return { id: params.id }; },
    },
  };
  const response = await renderServerLoaderData(application, new Request('http://localhost/app/users/7'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { data: { shell: { path: '/app/users/7' }, user: { id: '7' } } });
  assert.deepEqual(order, ['shell', 'user']);

  const missing = await renderServerLoaderData(application, new Request('http://localhost/app/missing'));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'SERVER_LOADER_NOT_FOUND' });

  const method = await renderServerLoaderData(application, new Request('http://localhost/app/users/7', { method: 'POST' }));
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET, HEAD');
});

test('renderServerLoaderData propagates responses and failures', async () => {
  const redirect = await renderServerLoaderData({
    routes: [{ id: 'moved', path: 'moved' }],
    serverLoaders: { moved: () => { throw new Response(null, { status: 302, headers: { location: '/login' } }); } },
  }, new Request('http://localhost/moved'));
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/login');

  await assert.rejects(renderServerLoaderData({
    routes: [{ id: 'broken', path: 'broken' }],
    serverLoaders: { broken: () => { throw new Error('boom'); } },
  }, new Request('http://localhost/broken')), /boom/);

  await assert.rejects(renderServerLoaderData({
    routes: [{ id: 'cycle', path: 'cycle' }],
    serverLoaders: { cycle: () => { const value: Record<string, unknown> = {}; value.self = value; return value; } },
  }, new Request('http://localhost/cycle')), /SERVER_LOADER_SERIALIZE/);
});

test('SSR replaces client stubs with server loaders and embeds their data in hydration', async () => {
  const application: ServerApplication = {
    routes: [
      { id: 'user', path: 'users/:id', Component: () => createElement('main', null, createElement('h1', null, 'Server user')), loader: stub('user') },
      { id: 'plain', path: 'plain', Component: () => createElement('p', null, 'plain'), loader: stub('plain') },
    ],
    serverLoaders: { user: ({ params }) => ({ id: params.id, source: 'serverLoader' }) },
  };
  const rendered = await renderServerApplication(application, new Request('http://localhost/users/9'));
  assert.ok(!(rendered instanceof Response));
  assert.match(rendered.html, /<h1>Server user<\/h1>/);
  const hydrationLiteral = /window\.__staticRouterHydrationData = JSON\.parse\(("(?:[^"\\]|\\.)*")\);/.exec(rendered.html)?.[1];
  assert.ok(hydrationLiteral, 'hydration script exists');
  const hydration = JSON.parse(JSON.parse(hydrationLiteral!)) as { loaderData: Record<string, unknown> };
  assert.deepEqual(hydration.loaderData, { user: { id: '9', source: 'serverLoader' } });

  // A stub without a generated server loader must not call its browser fetch during rendering.
  const plain = await renderServerApplication(application, new Request('http://localhost/plain'));
  assert.ok(!(plain instanceof Response));
  assert.match(plain.html, /plain/);
});
