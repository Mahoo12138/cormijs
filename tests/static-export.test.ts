import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RouteRecord } from '@cormijs/routes';
import { notFoundPage, renderStaticPage, staticPages, writeStaticPages } from '@cormijs/plugin-react-vite';

const module = (specifier: string) => ({ specifier, exportName: 'default' });
const routes: readonly RouteRecord[] = [
  { id: 'shell', path: '', module: module('./src/Shell.tsx'), meta: { head: { title: 'Root' } }, source: {} },
  { id: 'home', parentId: 'shell', index: true, module: module('./src/Home.tsx'), source: {} },
  { id: 'guide', parentId: 'shell', path: 'guide', module: module('./src/Guide.tsx'), source: {} },
  { id: 'detail', parentId: 'shell', path: 'guide/:id', module: module('./src/Detail.tsx'), source: {} },
  { id: 'redirect', parentId: 'shell', path: 'old', redirect: '/guide', source: {} },
  { id: 'missing', parentId: 'shell', path: '*', module: module('./src/Missing.tsx'), meta: { head: { title: 'Missing' } }, source: {} },
];

test('staticPages keeps literal module routes and skips dynamic, catch-all and redirect routes', () => {
  assert.deepEqual(staticPages(routes).map(page => page.path), ['/', '/guide']);
  assert.deepEqual(staticPages(routes).find(page => page.path === '/')?.head, { title: 'Root' });
  // The layout title is inherited by pages that do not declare their own head.
  assert.deepEqual(staticPages(routes).find(page => page.path === '/guide')?.head, { title: 'Root' });
});

test('notFoundPage extracts the catch-all route head without exporting it as a page', () => {
  assert.equal(notFoundPage(routes)?.head.title, 'Missing');
  assert.equal(notFoundPage(routes.filter(route => route.path !== '*')), undefined);
  assert.equal(staticPages(routes).some(page => page.path === '/404'), false);
});

test('renderStaticPage applies title template, metas and links without escaping regressions', () => {
  const html = '<html><head><title>Base</title><meta name="author" content="me"></head><body></body></html>';
  const page = { path: '/guide', head: { title: 'Guide', metas: [{ name: 'description', content: 'A "guide"' }], links: [{ rel: 'canonical', href: '/guide' }] } };
  const rendered = renderStaticPage(html, page, ' · demo');
  assert.match(rendered, /<title>Guide · demo<\/title>/);
  assert.match(rendered, /<meta name="description" content="A &quot;guide&quot;" \/>/);
  assert.match(rendered, /<link rel="canonical" href="\/guide" \/>/);
  assert.match(rendered, /<meta name="author" content="me">/);
  assert.equal(renderStaticPage(html, { path: '/', head: {} }), html);
  const withJsonLd = renderStaticPage(html, { path: '/', head: { jsonLd: { name: '</script><script>alert(1)</script>' } } });
  assert.match(withJsonLd, /<script type="application\/ld\+json">\{"name":"\\u003c\/script>/);
  assert.doesNotMatch(withJsonLd, /<script>alert\(1\)<\/script>/);
});

test('writeStaticPages emits one shell per page and rewrites the root shell', async t => {
  const output = await mkdtemp(join(tmpdir(), 'cormi-static 中文-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  await writeFile(join(output, 'index.html'), '<html><head><title>Base</title></head><body></body></html>');
  const written = await writeStaticPages(output, staticPages(routes), ' · demo');
  assert.deepEqual(written, ['guide/index.html']);
  assert.match(await readFile(join(output, 'guide/index.html'), 'utf8'), /<title>Root · demo<\/title>/);
  assert.match(await readFile(join(output, 'index.html'), 'utf8'), /<title>Root · demo<\/title>/);
  await mkdir(join(output, 'empty'), { recursive: true });
  await assert.rejects(writeStaticPages(join(output, 'empty'), staticPages(routes)), (error: any) => error?.code === 'STATIC_EXPORT_INVALID');
});
