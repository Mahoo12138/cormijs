import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { expandRouteConfig, validateRoutes, type ConfigRoute } from '@cormijs/routes';
import { generateRouteTypes, reactPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
import type { ApplicationRequest } from '@cormijs/plugin-web';
import { hasCode } from './helpers.js';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-route-config 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/routes'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  for (const name of ['Shell', 'Home', 'About', 'Index', 'User', 'ErrorPage', 'Auth', 'Trace']) {
    await writeFile(join(root, `src/routes/${name}.tsx`), `export default ()=><div>${name}</div>;`);
  }
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, serverOnlyFiles: [], signal: new AbortController().signal };
  return { root, host, request, async close() { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } } };
}
const configured: readonly ConfigRoute[] = [
  { id: 'shell', path: '/', component: './src/routes/Shell.tsx', meta: { title: 'Shell' }, routes: [
    { index: true, component: 'src/routes/Home.tsx' },
    { path: 'about', component: './src/routes/About.tsx', meta: { title: 'About' } },
    { path: 'users', component: './src/routes/Index.tsx', routes: [
      { index: true, component: './src/routes/Home.tsx' },
      { path: ':id', component: './src/routes/User.tsx', errorBoundary: './src/routes/ErrorPage.tsx', meta: { title: 'User' } },
    ] },
  ] },
];

test('nested config routes expand to stable flat records with component and provenance snapshots', () => {
  const routes = expandRouteConfig(configured, { pluginId: 'app:routes' });
  assert.deepEqual(routes.map(route => [route.id, route.parentId ?? null, route.path ?? null, route.index ?? false]), [
    ['shell', null, '', false],
    ['config:root:index', 'shell', null, true],
    ['config:about', 'shell', 'about', false],
    ['config:users', 'shell', 'users', false],
    ['config:users:index', 'config:users', null, true],
    ['config:users/:id', 'config:users', ':id', false],
  ]);
  assert.deepEqual(routes[0]!.module, { specifier: './src/routes/Shell.tsx', exportName: 'default' });
  assert.deepEqual(routes[2]!.meta, { title: 'About' });
  assert.deepEqual(routes[5]!.errorBoundary, { specifier: './src/routes/ErrorPage.tsx', exportName: 'default' });
  assert.ok(routes.every(route => Object.isFrozen(route) && route.source.pluginId === 'app:routes'));
});
test('root pages, absolute top-level paths and empty child paths normalize without changing the IR contract', () => {
  const routes = expandRouteConfig([
    { path: '/', component: './src/routes/Home.tsx' },
    { path: '/docs', component: './src/routes/Shell.tsx', routes: [
      { path: '', component: './src/routes/About.tsx' },
      { path: 'guide', component: './src/routes/User.tsx' },
    ] },
    { path: 'legacy', routes: [{ index: true, component: './src/routes/Home.tsx' }] },
  ]);
  assert.deepEqual(routes.map(route => [route.id, route.parentId ?? null, route.path ?? null, route.index ?? false]), [
    ['config:root:index', null, null, true],
    ['config:docs', null, 'docs', false],
    ['config:docs:index', 'config:docs', null, true],
    ['config:docs/guide', 'config:docs', 'guide', false],
    ['config:legacy', null, 'legacy', false],
    ['config:legacy:index', 'config:legacy', null, true],
  ]);
});
test('redirects keep route parameters and optionally preserve search and hash', () => {
  const routes = expandRouteConfig([
    { path: '/', redirect: '/home' },
    { path: 'home', component: './src/routes/Home.tsx' },
    { path: 'legacy/:id', redirect: '/users/:id' },
    { path: 'search', redirect: '/find', keepQuery: true },
    { path: 'guarded', routes: [{ index: true, redirect: '/login' }] },
  ], { pluginId: 'app:routes' });
  assert.deepEqual(routes.map(route => [route.id, route.parentId ?? null, route.path ?? null, route.index ?? false, route.redirect ?? null, route.keepQuery ?? false]), [
    ['config:root:index', null, null, true, '/home', false],
    ['config:home', null, 'home', false, null, false],
    ['config:legacy/:id', null, 'legacy/:id', false, '/users/:id', false],
    ['config:search', null, 'search', false, '/find', true],
    ['config:guarded', null, 'guarded', false, null, false],
    ['config:guarded:index', 'config:guarded', null, true, '/login', false],
  ]);
  assert.ok(routes.every(route => Object.isFrozen(route) && route.source.pluginId === 'app:routes'));
  const types = generateRouteTypes(routes);
  assert.match(types, /"config:legacy\/:id"/);
  assert.match(types, /"config:search"/);
});
test('wrappers expand outer-to-inner and leave the page at the wrapper path endpoint', () => {
  const routes = expandRouteConfig([{
    id: 'shell', path: '/', component: './src/routes/Shell.tsx', routes: [
      { path: 'about', component: './src/routes/About.tsx', wrappers: ['./src/routes/Auth.tsx', './src/routes/Trace.tsx'] },
      { path: 'users', component: './src/routes/Index.tsx', wrappers: ['./src/routes/Auth.tsx'], routes: [
        { index: true, component: './src/routes/Home.tsx', wrappers: ['./src/routes/Trace.tsx'] },
      ] },
    ],
  }]);
  assert.deepEqual(routes.map(route => [route.id, route.parentId ?? null, route.path ?? null, route.index ?? false, route.module?.specifier ?? null]), [
    ['shell', null, '', false, './src/routes/Shell.tsx'],
    ['config:about:wrapper:1', 'shell', 'about', false, './src/routes/Auth.tsx'],
    ['config:about:wrapper:2', 'config:about:wrapper:1', '', false, './src/routes/Trace.tsx'],
    ['config:about', 'config:about:wrapper:2', '', false, './src/routes/About.tsx'],
    ['config:users:wrapper:1', 'shell', 'users', false, './src/routes/Auth.tsx'],
    ['config:users', 'config:users:wrapper:1', '', false, './src/routes/Index.tsx'],
    ['config:users:index:wrapper:1', 'config:users', null, false, './src/routes/Trace.tsx'],
    ['config:users:index', 'config:users:index:wrapper:1', null, true, './src/routes/Home.tsx'],
  ]);
  const types = generateRouteTypes(routes);
  assert.match(types, /"\/about"/);
  assert.match(types, /"\/users"/);
});
test('redirects and wrappers reject unsafe or ambiguous declarations', () => {
  const component = './src/routes/Home.tsx', wrapper = './src/routes/Auth.tsx';
  const cases: Array<[unknown, string]> = [
    [[{ path: 'old', redirect: 'home' }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old', redirect: '//evil.test' }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old', redirect: 42 }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old', redirect: '/new', keepQuery: 'yes' }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old', keepQuery: true }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old', redirect: '/new', component }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old', redirect: '/new', errorBoundary: component }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old', redirect: '/new', routes: [{ index: true, redirect: '/child' }] }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old', redirect: '/new', wrappers: [wrapper] }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old/:id', redirect: '/team/:missing' }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old', redirect: '/new?x=1', keepQuery: true }], 'ROUTE_REDIRECT_INVALID'],
    [[{ path: 'old', component, wrappers: [] }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: 'old', component, wrappers: ['../secret.tsx'] }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: '*', component, wrappers: [wrapper] }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: 'old', component, wrappers: Array.from({ length: 33 }, () => wrapper) }], 'ROUTE_CONFIG_INVALID'],
    [[{ id: 'x', path: 'old', component, wrappers: [wrapper] }, { id: 'x:wrapper:1', path: 'other', component }], 'ROUTE_ID_CONFLICT'],
  ];
  for (const [input, code] of cases) assert.throws(() => expandRouteConfig(input), hasCode(code), JSON.stringify(input));
  const module = { specifier: './src/routes/Home.tsx', exportName: 'default' };
  assert.throws(() => validateRoutes([{ id: 'x', path: 'old', redirect: '/new', module, source: {} }]), hasCode('ROUTE_REDIRECT_INVALID'));
  assert.throws(() => validateRoutes([{ id: 'x', path: 'old', redirect: '/new', parentId: 'missing', source: {} }]), hasCode('ROUTE_PARENT_MISSING'));
  assert.throws(() => validateRoutes([{ id: 'x', redirect: '/new', source: {} }]), hasCode('ROUTE_REDIRECT_INVALID'));
  assert.throws(() => validateRoutes([{ id: 'x', path: 'old/:id', redirect: '/new/:missing', source: {} }]), hasCode('ROUTE_REDIRECT_INVALID'));
  assert.throws(() => validateRoutes([{ id: 'x', path: 'old', redirect: '/new?x=1', keepQuery: true, source: {} }]), hasCode('ROUTE_REDIRECT_INVALID'));
  assert.throws(() => validateRoutes([{ id: 'x', path: 'old', redirect: '/new', keepQuery: 'yes', source: {} }]), hasCode('ROUTE_REDIRECT_INVALID'));
});
test('configured routes reject ambiguous paths, missing components and unsupported fields', () => {
  const component = './src/routes/Home.tsx';
  const cases: Array<[unknown, string]> = [
    [[{ path: 'about', component, children: [] }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: 'about' }], 'ROUTE_CONFIG_INVALID'],
    [[{ component }], 'ROUTE_CONFIG_INVALID'],
    [[{ index: true }], 'ROUTE_CONFIG_INVALID'],
    [[{ index: true, path: 'about', component }], 'ROUTE_CONFIG_INVALID'],
    [[{ index: true, component, routes: [{ index: true, component }] }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: 'about', component, routes: [] }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: '/about', routes: [{ path: '/child', component }] }], 'ROUTE_PATH_INVALID'],
    [[{ path: 'about', component: '../secret.tsx' }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: 'about', component: '/src/routes/Home.tsx' }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: 'about', component: 'src/routes/Home' }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: 'about', component: 'src/routes/Home.d.ts' }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: 'about', component: 'src/routes/.hidden.tsx' }], 'ROUTE_CONFIG_INVALID'],
    [[{ path: 'about', component: 'src/routes/Home.tsx?raw' }], 'ROUTE_CONFIG_INVALID'],
    [[{ id: 'bad id', path: 'about', component }], 'ROUTE_CONFIG_INVALID'],
    [[{ id: 'cormi:reserved', path: 'about', component }], 'ROUTE_ID_CONFLICT'],
    [[{ id: 'same', path: 'about', component }, { id: 'same', path: 'home', component }], 'ROUTE_ID_CONFLICT'],
    [[{ routes: [{ index: true, component }] }, { routes: [{ index: true, component }] }], 'ROUTE_ID_CONFLICT'],
    [[{ path: 'about', component, meta: { invalid: undefined } }], 'ROUTE_META_INVALID'],
  ];
  for (const [input, code] of cases) assert.throws(() => expandRouteConfig(input), hasCode(code), JSON.stringify(input));
  assert.throws(() => expandRouteConfig([], { pluginId: '' }), hasCode('ROUTE_CONFIG_INVALID'));
  assert.throws(() => expandRouteConfig([], { pluginId: 'x', extra: true } as never), hasCode('ROUTE_CONFIG_INVALID'));
  let nested: ConfigRoute = { index: true, component };
  for (let i = 0; i < 66; i++) nested = { path: 'p' + i, routes: [nested] };
  assert.throws(() => expandRouteConfig([nested]), hasCode('ROUTE_CONFIG_INVALID'));
  assert.throws(() => expandRouteConfig(Array.from({ length: 10001 }, (_, i) => ({ path: 'p' + i, component }))), hasCode('ROUTE_CONFIG_INVALID'));
});
test('route config options are validated before a native contribution is registered', () => {
  const effects: unknown[] = [];
  const ctx = { effect(run: () => unknown) { effects.push(run()); }, react: { routes: { tap() { assert.fail('must not tap'); } } } };
  for (const options of [undefined, null, [], {}, { id: 'bad id', routes: [] }, { id: 'x' }, { id: 'x', routes: 'bad' },
    { id: 'x', routes: [], extra: true }, { id: 'x', routes: [], stage: NaN }]) {
    assert.throws(() => routeConfigPlugin.apply(ctx as never, options as never), hasCode('ROUTE_CONFIG_INVALID'), JSON.stringify(options));
  }
  routeConfigPlugin.apply(ctx as never, { id: 'empty', routes: [] });
  assert.equal(effects.length, 0);
});
test('a mounted route config contributes to generation and disposal withdraws it', async () => {
  const f = await fixture();
  try {
    const options = { id: 'app:routes', routes: structuredClone(configured) as ConfigRoute[] };
    const fiber = f.host.mount('route-config', routeConfigPlugin, options); await f.host.ready();
    const session = await f.host.ctx.application.prepare(f.request);
    const code = await readFile(join(f.root, '.cormi/app.tsx'), 'utf8');
    assert.match(code, /\.\.\/src\/routes\/Shell\.tsx/);
    assert.match(code, /\.\.\/src\/routes\/User\.tsx/);
    assert.match(code, /ErrorBoundary/);
    assert.match(code, /"title":"About"/);
    assert.match(code, /config:users\/:id/);
    await session.close();
    ((options.routes[0]!.routes as Array<{ path: string }>)[1]!).path = 'mutated';
    const next = await f.host.ctx.application.prepare(f.request);
    assert.doesNotMatch(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), /mutated/);
    await next.close();
    await fiber.dispose();
    assert.equal(f.host.ctx.react.routes.snapshot().length, 0);
    const after = await f.host.ctx.application.prepare(f.request);
    assert.doesNotMatch(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), /src\/routes/);
    await after.close();
  } finally { await f.close(); }
});
test('configured redirects and wrappers reach generated elements, inspection and route types', async () => {
  const f = await fixture();
  try {
    f.host.mount('route-config', routeConfigPlugin, { id: 'app:routes', routes: [
      { path: 'old/:id', redirect: '/users/:id' },
      { path: 'search', redirect: '/find', keepQuery: true },
      { path: 'about', component: './src/routes/About.tsx', wrappers: ['./src/routes/Auth.tsx', './src/routes/Trace.tsx'] },
    ] as ConfigRoute[] }); await f.host.ready();
    const session = await f.host.ctx.application.prepare(f.request);
    const code = await readFile(join(f.root, '.cormi/app.tsx'), 'utf8');
    assert.match(code, /RedirectRoute/);
    assert.match(code, /element:<RedirectRoute to="\/users\/:id"\/>/);
    assert.match(code, /element:<RedirectRoute to="\/find" keepQuery\/>/);
    assert.match(code, /config:about:wrapper:1/);
    assert.match(code, /Auth\.tsx/);
    const inspection = JSON.parse((await readFile(join(f.root, '.cormi/inspect.jsonc'), 'utf8')).replace(/^\/\/.*\n/gm, ''));
    assert.equal(inspection.summary.routes.find((route: { id: string }) => route.id === 'config:old/:id').redirect, '/users/:id');
    assert.equal(inspection.summary.routes.find((route: { id: string }) => route.id === 'config:search').keepQuery, true);
    assert.equal(inspection.summary.routes.find((route: { id: string }) => route.id === 'config:about').path, '');
    assert.ok(inspection.summary.routes.some((route: { id: string }) => route.id === 'config:about:wrapper:2'));
    const types = await readFile(join(f.root, '.cormi/routes.d.ts'), 'utf8');
    assert.match(types, /"config:old\/:id"/);
    await session.close();
  } finally { await f.close(); }
});
test('config routes compose with explicit IR and still fail atomically on conflicts', async () => {
  const f = await fixture();
  try {
    f.host.mount('route-config', routeConfigPlugin, { id: 'app:routes', routes: [{ path: 'about', component: './src/routes/About.tsx' }] }); await f.host.ready();
    const request = { ...f.request, options: { routes: [{ id: 'host:about', path: 'about', source: {} }] } };
    await assert.rejects(f.host.ctx.application.prepare(request), hasCode('ROUTE_CONFLICT'));
    const repaired = { ...f.request, options: { routes: [{ id: 'host:home', index: true, source: {} }] } };
    const session = await f.host.ctx.application.prepare(repaired);
    const code = await readFile(join(f.root, '.cormi/app.tsx'), 'utf8');
    assert.match(code, /host:home/); assert.match(code, /config:about/);
    await session.close();
  } finally { await f.close(); }
});
