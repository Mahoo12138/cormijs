import test from 'node:test';
import assert from 'node:assert/strict';
import type { RouteObject } from 'react-router';
import { collectHead, mergeHeads, normalizeHead, serializeJsonLd } from '@cormijs/runtime';

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

test('jsonLd validates JSON data, replaces on deeper routes and escapes script closes', () => {
  const head = { jsonLd: { '@context': 'https://schema.org', '@type': 'Article', name: 'A' } };
  assert.deepEqual(normalizeHead(head), head);
  assert.equal(serializeJsonLd({ name: '</script>' }), '{"name":"\\u003c/script>"}');
  const nested = [route('root', '', { jsonLd: { '@type': 'WebSite' } }, [route('child', 'child', { jsonLd: { '@type': 'Article' } }), route('plain', 'plain')])];
  assert.deepEqual(collectHead(nested, '/child', '/').jsonLd, { '@type': 'Article' });
  assert.deepEqual(collectHead(nested, '/plain', '/').jsonLd, { '@type': 'WebSite' });
  for (const bad of [{ jsonLd: null }, { jsonLd: [] }, { jsonLd: 'x' }, { jsonLd: [{ name: 'ok' }, 'x'] }, { jsonLd: { run: () => 1 } }, { jsonLd: { value: Number.POSITIVE_INFINITY } }]) {
    assert.throws(() => normalizeHead(bad), /HEAD_INVALID/, JSON.stringify(bad));
  }
});

test('mergeHeads lets component entries override route fields in mount order', () => {
  const base = { title: 'Route', metas: [{ name: 'description', content: 'route' }], links: [{ rel: 'canonical', href: '/route' }], jsonLd: { '@type': 'WebSite' } };
  const merged = mergeHeads(base, [
    { title: 'First', metas: [{ name: 'description', content: 'first' }] },
    { title: 'Second', metas: [{ property: 'og:title', content: 'og' }], links: [{ rel: 'alternate', href: '/alt' }], jsonLd: { '@type': 'WebPage' } },
  ]);
  assert.equal(merged.title, 'Second');
  assert.deepEqual(merged.metas, [{ name: 'description', content: 'first' }, { property: 'og:title', content: 'og' }]);
  assert.deepEqual(merged.links, [{ rel: 'canonical', href: '/route' }, { rel: 'alternate', href: '/alt' }]);
  assert.deepEqual(merged.jsonLd, { '@type': 'WebPage' });
  assert.deepEqual(mergeHeads({}, []), {});
});

test('basename accepts both stripped and full pathnames', () => {
  const expected = { title: 'Guide', metas: [{ name: 'description', content: 'root' }], links: [{ rel: 'canonical', href: '/guide' }] };
  assert.deepEqual(collectHead(routes, '/docs/42', '/app/'), expected);
  assert.deepEqual(collectHead(routes, '/app/docs/42', '/app/'), expected);
});
