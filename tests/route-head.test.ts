import test from 'node:test';
import assert from 'node:assert/strict';
import type { RouteObject } from 'react-router';
import { collectHead, normalizeHead } from '@cormijs/runtime';

const route = (id: string, path: string | undefined, head?: unknown, children?: RouteObject[]): RouteObject => ({
  id, ...(path === undefined ? {} : { path }), handle: { cormi: { meta: head === undefined ? {} : { head } } }, ...(children ? { children } : {}),
});
const routes = [
  route('root', '', { title: 'Root', metas: [{ name: 'description', content: 'root' }] }, [
    route('home', '', { title: 'Home' }),
    route('docs', 'docs', undefined, [route('guide', ':id', { title: 'Guide', links: [{ rel: 'canonical', href: '/guide' }] })]),
    route('plain', 'plain'),
  ]),
];

test('collectHead picks the nearest declared head and leaves ancestors intact', () => {
  // Root metas merge into the child title.
  assert.deepEqual(collectHead(routes, '/', '/'), { title: 'Home', metas: [{ name: 'description', content: 'root' }] });
  assert.deepEqual(collectHead(routes, '/docs/42', '/'), { title: 'Guide', metas: [{ name: 'description', content: 'root' }], links: [{ rel: 'canonical', href: '/guide' }] });
  // `plain` declares no head: the only ancestor block still applies.
  assert.deepEqual(collectHead(routes, '/plain', '/'), { title: 'Root', metas: [{ name: 'description', content: 'root' }] });
  assert.deepEqual(collectHead(routes, '/missing', '/'), {});
});

test('normalizeHead validates the documented shape', () => {
  const head = { title: 'T', metas: [{ name: 'description', content: 'D' }, { property: 'og:title', content: 'O' }], links: [{ rel: 'canonical', href: '/x' }] };
  assert.deepEqual(normalizeHead(head), head);
  assert.deepEqual(normalizeHead(undefined), {});
  for (const bad of [
    'x', [], { unknown: 1 }, { title: '' }, { title: 'a\nb' }, { metas: {} }, { metas: [{ content: 'x' }] },
    { metas: [{ name: 'a', property: 'b', content: 'c' }] }, { metas: [{ name: 'a', content: 'c', extra: 1 }] },
    { links: [{ href: '/x' }] }, { links: [{ rel: 'a', href: '' }] },
    { metas: Array.from({ length: 33 }, () => ({ name: 'n', content: 'c' })) },
  ]) assert.throws(() => normalizeHead(bad), /HEAD_INVALID/, JSON.stringify(bad));
});

test('basename accepts both stripped and full pathnames', () => {
  const expected = { title: 'Guide', metas: [{ name: 'description', content: 'root' }], links: [{ rel: 'canonical', href: '/guide' }] };
  assert.deepEqual(collectHead(routes, '/docs/42', '/app/'), expected);
  assert.deepEqual(collectHead(routes, '/app/docs/42', '/app/'), expected);
});
