import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { redirect } from 'react-router';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { reactPlugin } from '@cormijs/plugin-react';
import { prerenderStaticPages, sitemapXml, ssrPlugin } from '@cormijs/plugin-react-vite';
import { renderServerApplication, type ServerApplication } from '@cormijs/runtime/server';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('renderServerApplication renders routes and loader data, and returns redirects as responses', async () => {
  const app: ServerApplication = { routes: [
    { id: 'home', path: '/', Component: () => createElement('main', null, createElement('h1', null, 'SSR unit')), loader: async () => ({ answer: 42 }), handle: { cormi: { meta: { head: { title: 'Unit head', metas: [{ name: 'unit', content: 'yes' }] } } } } },
    { id: 'old', path: '/old', loader: () => { throw redirect('/'); } },
  ] };
  const rendered = await renderServerApplication(app, new Request('http://localhost/'));
  assert.ok(!(rendered instanceof Response));
  assert.match(rendered.html, /<h1>SSR unit<\/h1>/);
  assert.match(rendered.html, /__staticRouterHydrationData/);
  assert.equal(rendered.status, 200);
  assert.equal(rendered.head.title, 'Unit head');
  assert.deepEqual(rendered.head.metas, [{ name: 'unit', content: 'yes' }]);
  const moved = await renderServerApplication(app, new Request('http://localhost/old'));
  assert.ok(moved instanceof Response);
  assert.equal(moved.status, 302);
  assert.equal(moved.headers.get('location'), '/');
});

test('ssr plugin registers its Vite bridge, validates options and withdraws', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-ssr 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = new ProjectRuntime(3000, root);
  host.mount('vite', vitePlugin);
  host.mount('react', reactPlugin);
  host.mount('ssr', ssrPlugin);
  await host.ready();
  assert.ok(host.ctx.vite.ids().includes('cormi:ssr'));
  await host.unmount('ssr');
  assert.ok(!host.ctx.vite.ids().includes('cormi:ssr'));
  await host.dispose();

  for (const options of [{ mountId: '9bad' }, { mountId: 1 }, { extra: true }, { prerender: 'yes' }, { sitemap: 'https://example.com' }, { prerender: true, sitemap: 'ftp://example.com' }]) {
    const rejecting = new ProjectRuntime(3000, root);
    rejecting.mount('vite', vitePlugin);
    rejecting.mount('react', reactPlugin);
    rejecting.mount('invalid', ssrPlugin, options as never);
    await assert.rejects(rejecting.ready(), hasCode('PLUGIN_FAILED'));
    await rejecting.dispose();
  }
});

test('prerenderStaticPages writes literal routes, skips redirects and emits a sitemap', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-prerender 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const shell = '<!doctype html><html><head><title>Base</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
  const result = await prerenderStaticPages({
    output: root, shell, mountId: 'root', base: '/app/', sitemap: 'https://example.com',
    pages: [{ path: '/', head: {} }, { path: '/guide', head: {} }, { path: '/moved', head: {} }],
    render: async request => new URL(request.url).pathname === '/app/moved'
      ? new Response(null, { status: 302, headers: { location: '/' } })
      : { html: `<main>${new URL(request.url).pathname}</main>`, status: 200, head: { title: 'Page' } },
  });
  assert.deepEqual(result.written, ['/', '/guide']);
  assert.deepEqual(result.skipped, [{ path: '/moved', status: 302 }]);
  const home = await readFile(join(root, 'index.html'), 'utf8');
  assert.match(home, /<main>\/app\/<\/main>/);
  assert.match(home, /<title>Page<\/title>/);
  assert.match(await readFile(join(root, 'guide/index.html'), 'utf8'), /<main>\/app\/guide<\/main>/);
  assert.equal(existsSync(join(root, 'moved/index.html')), false);
  const map = await readFile(join(root, 'sitemap.xml'), 'utf8');
  assert.ok(map.includes('<loc>https://example.com/app/</loc>'));
  assert.ok(map.includes('<loc>https://example.com/app/guide</loc>'));
  assert.ok(!map.includes('moved'));
  assert.equal(sitemapXml(['https://x.test/a&b']), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://x.test/a&amp;b</loc></url>\n</urlset>\n');
});
