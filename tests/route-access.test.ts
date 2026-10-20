import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRouteConfig, validateRoutes } from '@cormijs/routes';
import { hasCode } from './helpers.js';

test('configured access keys propagate to the wrapper chain and reject invalid names', () => {
  const page = expandRouteConfig([{ path: 'admin', component: './src/Admin.tsx', access: 'canAdmin' }]);
  assert.deepEqual(page.map(route => [route.id, route.parentId ?? null, route.path, route.access ?? null]), [
    ['config:admin', null, 'admin', 'canAdmin'],
  ]);
  const wrapped = expandRouteConfig([{ path: 'wrapped', component: './src/Admin.tsx', wrappers: ['./src/Auth.tsx'], access: 'canAdmin' }]);
  assert.deepEqual(wrapped.map(route => [route.id, route.parentId ?? null, route.path, route.access ?? null]), [
    ['config:wrapped:wrapper:1', null, 'wrapped', 'canAdmin'],
    ['config:wrapped', 'config:wrapped:wrapper:1', '', null],
  ]);
  assert.throws(() => expandRouteConfig([{ path: 'bad', component: './src/Admin.tsx', access: 'bad key' }]), hasCode('ROUTE_CONFIG_INVALID'));
  assert.throws(() => validateRoutes([{ id: 'x', path: 'x', access: 'bad key', source: {} }]), hasCode('ROUTE_ACCESS_INVALID'));
});
