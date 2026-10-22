import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { toAntdMenuItems, toLayoutRoutes, type MenuItem } from '@cormijs/runtime';

const item = (id: string, path: string, title: string, children: readonly MenuItem[] = []): MenuItem => ({
  key: id, id, path, title, order: 0, meta: {}, children,
});
const menu = [
  item('shell', '/', 'Home', [
    item('team', '/team', 'Team', [item('members', '/team/members', 'Members')]),
    item('about', '/about', 'About'),
  ]),
];

test('toAntdMenuItems maps path keys, localized labels and nested children', () => {
  assert.deepEqual(toAntdMenuItems(menu), [{
    key: '/', label: 'Home', routeId: 'shell', children: [
      { key: '/team', label: 'Team', routeId: 'team', children: [{ key: '/team/members', label: 'Members', routeId: 'members' }] },
      { key: '/about', label: 'About', routeId: 'about' },
    ],
  }]);
  assert.deepEqual(toAntdMenuItems([]), []);
});

test('toLayoutRoutes maps paths/names and omits empty routes', () => {
  assert.deepEqual(toLayoutRoutes(menu), [{
    path: '/', name: 'Home', routes: [
      { path: '/team', name: 'Team', routes: [{ path: '/team/members', name: 'Members' }] },
      { path: '/about', name: 'About' },
    ],
  }]);
  assert.deepEqual(toLayoutRoutes([]), []);
});

test('toLayoutRoutes resolves icons from meta.icon, then the route id, and ignores inherited keys', () => {
  const home = createElement('i', { 'data-icon': 'home' }), team = createElement('i', { 'data-icon': 'team' });
  const withMeta = [{ ...item('home', '/', 'Home'), meta: { icon: 'house' } }, item('team', '/team', 'Team')];
  const routes = toLayoutRoutes(withMeta, { house: home, team });
  assert.equal(routes[0]?.icon, home);
  assert.equal(routes[1]?.icon, team);
  const fallback = item('fallback', '/fallback', 'Fallback');
  assert.equal(toLayoutRoutes([{ ...fallback, meta: { icon: 'unknown' } }], { fallback: home })[0]?.icon, undefined);
  const inherited = Object.create({ unknown: home }) as Readonly<Record<string, ReturnType<typeof createElement>>>;
  assert.equal(toLayoutRoutes([{ ...fallback, meta: { icon: 'unknown' } }], inherited)[0]?.icon, undefined);
});
