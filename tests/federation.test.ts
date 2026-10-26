import test from 'node:test';
import assert from 'node:assert/strict';
import type { RouteObject } from 'react-router';
import { mergeFederatedRoutes, routePrefix, FederationRouteError } from '../packages/plugin-federation/src/merge.js';
import { manifestRemote, manifestUrlFor, normalizePrefixes, normalizePublicUrls, parseFederationManifest } from '../packages/plugin-federation/src/manifest.js';
import { federationRuntime } from '../packages/plugin-federation/src/runtime.js';

test('federated routes keep menu metadata, namespace ids and mount under a prefix wrapper', () => {
  const host: RouteObject[] = [{ id: 'host:home', index: true, handle: { cormi: { meta: { title: 'Home' } } } }];
  const remote = [
    { id: 'file:src/pages/index.tsx', index: true, handle: { cormi: { meta: { title: 'Remote Home' } } } },
    { id: 'file:src/pages/orders.tsx', path: 'orders', handle: { cormi: { meta: { title: 'Orders', order: 2 } } },
      children: [{ id: 'file:src/pages/orders/_layout.tsx', path: '', children: [{ id: 'file:src/pages/orders/index.tsx', index: true }] }] },
  ];
  const count = mergeFederatedRoutes(host, remote, { name: 'shop', prefix: '/shop' });
  assert.equal(count, 5);
  assert.equal(host.length, 2);
  const wrapper = host[1]!;
  assert.equal(wrapper.id, 'shop:federation-root');
  assert.equal(wrapper.path, '/shop');
  assert.equal(wrapper.children?.length, 2);
  assert.deepEqual(wrapper.children!.map(route => route.id), ['shop:file:src/pages/index.tsx', 'shop:file:src/pages/orders.tsx']);
  assert.deepEqual(wrapper.children![1]!.handle, { cormi: { meta: { title: 'Orders', order: 2 } } });
  assert.equal(wrapper.children![1]!.children![0]!.children![0]!.id, 'shop:file:src/pages/orders/index.tsx');
  assert.equal(wrapper.children![0]!.index, true);
  // The source tree is never mutated or reused by the host.
  assert.equal(remote[1]!.id, 'file:src/pages/orders.tsx');
  assert.notEqual(wrapper.children![1], remote[1]);
});

test('absolute remote paths become relative under the prefix while nested absolute paths are rejected', () => {
  const routes: RouteObject[] = [];
  mergeFederatedRoutes(routes, [{ id: 'a', path: '/orders', children: [{ id: 'b', path: 'detail' }] }], { name: 'shop', prefix: '/shop' });
  assert.equal(routes[0]!.children![0]!.path, 'orders');
  assert.equal(routes[0]!.children![0]!.children![0]!.path, 'detail');
  assert.throws(() => mergeFederatedRoutes([], [{ id: 'a', path: 'orders', children: [{ id: 'b', path: '/detail' }] }], { name: 'shop', prefix: '/shop' }),
    /FEDERATION_ROUTE_INVALID.*absolute/);
});

test('route conflicts fail with an actionable error instead of silently shadowing the host', () => {
  const host: RouteObject[] = [{ id: 'host:orders', path: 'orders' }];
  assert.throws(() => mergeFederatedRoutes(host, [{ id: 'remote:orders', path: 'orders' }], { name: 'shop' }),
    error => error instanceof FederationRouteError && error.code === 'FEDERATION_ROUTE_CONFLICT' && /"\/orders"/.test(error.message));
  assert.throws(() => mergeFederatedRoutes([{ id: 'host:home', index: true }], [{ id: 'root', index: true }], { name: 'shop' }),
    /FEDERATION_ROUTE_CONFLICT.*prefix/);
  assert.throws(() => mergeFederatedRoutes([{ id: 'host:shop', path: 'shop' }], [{ id: 'x', path: 'orders' }], { name: 'shop', prefix: '/shop' }),
    /FEDERATION_ROUTE_CONFLICT/);
  assert.throws(() => mergeFederatedRoutes([], [{ id: 'x', path: 'a' }, { id: 'y', path: 'a' }], { name: 'shop' }),
    /FEDERATION_ROUTE_CONFLICT/);
  // Prefixes move the remote away from the colliding host path.
  const allowed: RouteObject[] = [{ id: 'host:orders', path: 'orders' }];
  mergeFederatedRoutes(allowed, [{ id: 'remote:orders', path: 'orders' }], { name: 'shop', prefix: '/shop' });
  assert.equal(allowed[1]!.path, '/shop');
});

test('malformed remote route trees are rejected at the boundary', () => {
  assert.throws(() => mergeFederatedRoutes([], null, { name: 'shop' }), /FEDERATION_ROUTE_INVALID/);
  assert.throws(() => mergeFederatedRoutes([], [null], { name: 'shop' }), /FEDERATION_ROUTE_INVALID/);
  assert.throws(() => mergeFederatedRoutes([], [{ id: 'x', index: true, path: 'a' }], { name: 'shop' }), /index route with a path/);
  assert.throws(() => mergeFederatedRoutes([], [{ id: 'x', index: true, children: [] }], { name: 'shop' }), /index route with children/);
  assert.throws(() => mergeFederatedRoutes([], [{ id: 'x', path: '*' }], { name: 'shop' }), /wildcard/);
  assert.throws(() => mergeFederatedRoutes([], [{ id: 'x', path: 42 }], { name: 'shop' }), /FEDERATION_ROUTE_INVALID/);
  assert.throws(() => mergeFederatedRoutes([], [{ id: 'x', path: { deep: true } }], { name: 'shop' }), /FEDERATION_ROUTE_INVALID/);
  assert.throws(() => mergeFederatedRoutes([], [{ id: 'x', path: '' }, { id: 'x' }], { name: 'shop' }), /duplicate route id/);
  const cycle: RouteObject[] = [];
  const route = { id: 'x', path: 'x', children: cycle } as RouteObject;
  cycle.push(route);
  assert.throws(() => mergeFederatedRoutes([], cycle, { name: 'shop' }), /FEDERATION_ROUTE_(?:CONFLICT|INVALID)/);
  assert.throws(() => mergeFederatedRoutes([], [{ id: 'x', path: 'x', children: 'no' }], { name: 'shop' }), /invalid route children/);
  assert.throws(() => mergeFederatedRoutes([], [{ id: 'x', path: 'x', children: Array.from({ length: 3000 }, (_, index) => ({ id: `y${index}` })) }], { name: 'shop' }), /route count/);
});

test('route prefixes accept canonical paths and reject traversal or URL syntax', () => {
  assert.equal(routePrefix(undefined), undefined);
  assert.equal(routePrefix('/'), undefined);
  assert.equal(routePrefix('/team'), '/team');
  for (const value of ['team', '/team/', '//team', '/team?x=1', '/team#x', '/a/../b', '/a/./b', '/a b', '/a\\b']) {
    assert.throws(() => routePrefix(value), /FEDERATION_ROUTE_INVALID/, String(value));
  }
});

test('federation runtime skips work without remotes and refuses malformed runtime options', async () => {
  const routes: RouteObject[] = [];
  await federationRuntime.routes!({ routes, options: { remotes: [], timeout: 5000 }, appConfig: {}, basename: '/', signal: new AbortController().signal });
  assert.deepEqual(routes, []);
  for (const options of [null, {}, { remotes: [{ name: '../evil', entry: 'http://x/remoteEntry.js' }] },
    { remotes: [{ name: 'shop', entry: 'relative/remoteEntry.js' }] },
    { remotes: [{ name: 'shop', entry: 'http://x/remoteEntry.js', module: '../x' }] },
    { remotes: [{ name: 'shop', entry: 'http://x/remoteEntry.js', prefix: 'shop' }] },
    { remotes: [{ name: 'shop', entry: 'http://x/remoteEntry.js' }], timeout: 10 },
    { remotes: [], publicUrls: ['ftp://x/manifest.json'] },
    { remotes: [], publicUrls: ['http://x/'], prefixes: { shop: 'shop' } }]) {
    await assert.rejects(Promise.resolve(federationRuntime.routes!({ routes: [], options, appConfig: {}, basename: '/', signal: new AbortController().signal })),
      /FEDERATION_INVALID/);
  }
});

test('public URLs accept env strings, package roots and direct manifests with bounded validation', () => {
  assert.deepEqual(normalizePublicUrls(undefined), []);
  assert.deepEqual(normalizePublicUrls('https://a.example/app/, https://b.example/pkg\n/cormi/'), ['https://a.example/app/', 'https://b.example/pkg', '/cormi/']);
  assert.deepEqual(normalizePublicUrls(['https://a.example/', 'https://a.example/']), ['https://a.example/']);
  for (const value of ['ftp://a.example/', '//a.example/', 'https://user:pw@a.example/', 'https://a.example/#x', 'https://a.example/a/../b', 'relative/path']) {
    assert.throws(() => normalizePublicUrls(value), /FEDERATION_MANIFEST_INVALID/, value);
  }
  assert.throws(() => normalizePublicUrls(new Array(33).fill('https://a.example/')), /at most 32/);
  assert.equal(manifestUrlFor('https://cdn.example.com/app/', 'http://host/'), 'https://cdn.example.com/app/cormi-federation.json');
  assert.equal(manifestUrlFor('https://cdn.example.com/app', 'http://host/'), 'https://cdn.example.com/app/cormi-federation.json');
  assert.equal(manifestUrlFor('/micro/', 'https://host.example/base/'), 'https://host.example/micro/cormi-federation.json');
  assert.equal(manifestUrlFor('https://cdn.example.com/app/manifest.json', 'http://host/'), 'https://cdn.example.com/app/manifest.json');
  assert.equal(manifestUrlFor('https://cdn.example.com/pkg/package.json', 'http://host/'), 'https://cdn.example.com/pkg/package.json');
  assert.throws(() => manifestUrlFor('ftp://cdn/manifest.json', 'http://host/'), /http\(s\)/);
});

test('manifests resolve entries and npm package metadata into route remotes', () => {
  const manifest = parseFederationManifest({
    format: 'cormi:federation:1', name: 'shop', entry: './remoteEntry.js', routes: './routes',
    prefix: '/shop', version: '1.2.3', buildId: 'build 1',
  }, 'https://cdn.example.com/shop/cormi-federation.json');
  assert.equal(manifest.entry, 'https://cdn.example.com/shop/remoteEntry.js?v=build+1');
  assert.deepEqual(manifestRemote(manifest), { name: 'shop', entry: manifest.entry, module: './routes', prefix: '/shop', required: true });
  assert.deepEqual(manifestRemote(manifest, '/store'), { name: 'shop', entry: manifest.entry, module: './routes', prefix: '/store', required: true });
  assert.equal(manifestRemote(parseFederationManifest({ format: 'cormi:federation:1', name: 'widgets', entry: '/remoteEntry.js' }, 'https://cdn.example.com/widgets/cormi-federation.json')), undefined);

  const pkg = parseFederationManifest({ name: '@acme/shop', version: '2.0.0', cormi: { federation: {
    format: 'cormi:federation:1', name: 'shop', entry: './dist/remoteEntry.js', routes: './routes', prefix: '/shop',
  } } }, 'https://unpkg.com/@acme/shop@2.0.0/package.json');
  assert.equal(pkg.entry, 'https://unpkg.com/@acme/shop@2.0.0/dist/remoteEntry.js');

  const base = { format: 'cormi:federation:1', name: 'shop', entry: './remoteEntry.js' };
  assert.throws(() => parseFederationManifest({ ...base, format: 'v2' }, 'https://cdn.example.com/cormi-federation.json'), /unsupported/i);
  assert.throws(() => parseFederationManifest({ ...base, name: '../shop' }, 'https://cdn.example.com/cormi-federation.json'), /name/);
  assert.throws(() => parseFederationManifest({ ...base, entry: 'ftp://cdn/entry.js' }, 'https://cdn.example.com/cormi-federation.json'), /http\(s\)/);
  assert.throws(() => parseFederationManifest({ ...base, hasRoutes: true }, 'https://cdn.example.com/cormi-federation.json'), /hasRoutes/);
  assert.throws(() => parseFederationManifest({ ...base, routes: '../routes' }, 'https://cdn.example.com/cormi-federation.json'), /routes/);
  assert.throws(() => parseFederationManifest({ ...base, prefix: '/a/' }, 'https://cdn.example.com/cormi-federation.json'), /prefix/);
  assert.throws(() => parseFederationManifest({ ...base, version: 'x'.repeat(65) }, 'https://cdn.example.com/cormi-federation.json'), /version/);
  assert.throws(() => parseFederationManifest({ name: '@acme/shop' }, 'https://unpkg.com/@acme/shop/package.json'), /cormi.federation/);
  assert.deepEqual(normalizePrefixes({ shop: '/shop', widgets: '/' }), { shop: '/shop', widgets: '/' });
  assert.throws(() => normalizePrefixes({ shop: 'shop' }), /prefix override/i);
});
