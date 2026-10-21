import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, Suspense } from 'react';
import { Outlet, redirect } from 'react-router';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { reactPlugin } from '@cormijs/plugin-react';
import { prerenderPages, prerenderStaticPages, resolvePrerenderPaths, sitemapXml, ssrPlugin } from '@cormijs/plugin-react-vite';
import { renderServerApplication, renderServerApplicationStream, type ServerApplication } from '@cormijs/runtime/server';

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

test('renderServerApplicationStream flushes the shell early and moves hydration outside the markup', async () => {
  let release!: (value: string) => void;
  const gate = new Promise<string>(resolve => { release = resolve; });
  let data: string | undefined;
  function Async() {
    if (data === undefined) throw gate.then(value => { data = value; });
    return createElement('p', null, data);
  }
  const Shell = () => createElement('main', null, createElement('h1', null, 'stream shell'),
    createElement(Suspense, { fallback: createElement('p', null, 'loading'.repeat(20)) }, createElement(Outlet)));
  const app: ServerApplication = {
    routes: [{ id: 'shell', path: '', Component: Shell, handle: { cormi: { meta: { head: { title: 'Stream title' } } } },
      children: [{ id: 'home', index: true, Component: Async, loader: async () => ({ ok: true }) }] }],
  };
  const result = await renderServerApplicationStream(app, new Request('http://localhost/'));
  assert.ok(!(result instanceof Response));
  assert.equal(result.head.title, 'Stream title');
  const reader = result.stream.getReader(), decoder = new TextDecoder();
  const first = await reader.read();
  const chunk = decoder.decode(first.value);
  assert.match(chunk, /stream shell/);
  assert.match(chunk, /loading/);
  release('streamed');
  let markup = chunk;
  for (;;) { const { done, value } = await reader.read(); if (done) break; markup += decoder.decode(value); }
  assert.match(markup, /streamed/);
  assert.doesNotMatch(markup, /__staticRouterHydrationData/);
  const hydration = await result.hydration;
  assert.match(hydration, /^<script>window\.__staticRouterHydrationData/);
  assert.match(hydration, /\\"home\\":\{\\"ok\\":true\}/);
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

  for (const options of [{ mountId: '9bad' }, { mountId: 1 }, { extra: true }, { prerender: 'yes' }, { sitemap: 'https://example.com' }, { prerender: true, sitemap: 'ftp://example.com' },
    { prerenderPaths: ['/x'] }, { prerender: true, prerenderPaths: ['relative'] }, { prerender: true, prerenderPaths: ['/a/../b'] },
    { prerender: true, prerenderIgnoreErrors: 'yes' }, { prerender: true, prerenderPaths: 1 },
    { prerender: true, prerenderIncremental: 'yes' }, { prerender: true, prerenderPaths: [{ path: '/x', prerender: 'yes' }] }, { prerender: true, prerenderPaths: [{ path: '/x', extra: true }] }]) {
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
    pages: [{ path: '/', head: {} }, { path: '/guide', head: {} }, { path: '/moved', head: {} }, { path: '/missing', head: {} }],
    render: async request => {
      const path = new URL(request.url).pathname;
      if (path === '/app/moved') return new Response(null, { status: 302, headers: { location: '/' } });
      if (path === '/app/missing') return { html: '<main>missing</main>', status: 404, head: {} };
      return { html: `<main>${path}</main>`, status: 200, head: { title: 'Page' } };
    },
  });
  assert.deepEqual(result.written, ['/', '/guide']);
  assert.deepEqual(result.skipped, [{ path: '/moved', status: 302 }, { path: '/missing', status: 404 }]);
  const home = await readFile(join(root, 'index.html'), 'utf8');
  assert.match(home, /<main>\/app\/<\/main>/);
  assert.match(home, /<title>Page<\/title>/);
  assert.match(await readFile(join(root, 'guide/index.html'), 'utf8'), /<main>\/app\/guide<\/main>/);
  assert.equal(existsSync(join(root, 'moved/index.html')), false);
  const map = await readFile(join(root, 'sitemap.xml'), 'utf8');
  assert.ok(map.includes('<loc>https://example.com/app/</loc>'));
  assert.ok(map.includes('<loc>https://example.com/app/guide</loc>'));
  assert.ok(!map.includes('moved'));
  assert.ok(!map.includes('missing'));
  assert.equal(sitemapXml(['https://x.test/a&b']), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://x.test/a&amp;b</loc></url>\n</urlset>\n');
});

test('resolvePrerenderPaths accepts arrays and async producers, and prerender can skip page errors', async () => {
  assert.deepEqual(await resolvePrerenderPaths(['/users/2', '/users/1', '/users/2']), ['/users/1', '/users/2']);
  assert.deepEqual(await resolvePrerenderPaths(['/users/1', { path: '/users/2', prerender: false }, { path: '/users/3' }]), ['/users/1', '/users/3']);
  assert.deepEqual(await resolvePrerenderPaths(async () => ['/guide']), ['/guide']);
  await assert.rejects(resolvePrerenderPaths(async () => ['relative']), hasCode('SSR_INVALID'));
  await assert.rejects(resolvePrerenderPaths(1 as never), hasCode('SSR_INVALID'));
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-prerender-errors 中文-')));
  try {
    const shell = '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
    const pages = [{ path: '/ok', head: {} }, { path: '/broken', head: {} }];
    const render = async (request: Request) => {
      if (new URL(request.url).pathname === '/broken') throw new Error('boom');
      return { html: '<main>ok</main>', status: 200, head: {} };
    };
    await assert.rejects(prerenderStaticPages({ output: root, shell, mountId: 'root', base: '/', pages, render }), /boom/);
    const result = await prerenderStaticPages({ output: root, shell, mountId: 'root', base: '/', pages, render, ignoreErrors: true, sitemap: 'https://example.com' });
    assert.deepEqual(result.written, ['/ok']);
    assert.deepEqual(result.skipped, [{ path: '/broken', status: 0, error: 'boom' }]);
    assert.ok(!(await readFile(join(root, 'sitemap.xml'), 'utf8')).includes('broken'));
    const second = await prerenderStaticPages({ output: root, shell, mountId: 'root', base: '/', pages, render, ignoreErrors: true, incremental: true, sitemap: 'https://example.com' });
    assert.deepEqual(second.written, []);
    assert.deepEqual(second.unchanged, ['/ok']);
    assert.ok((await readFile(join(root, 'sitemap.xml'), 'utf8')).includes('https://example.com/ok'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('prerenderPages merges explicit dynamic paths with literal routes', () => {
  const pages = prerenderPages([{ id: 'home', path: '', module: { specifier: './src/pages/home.tsx', exportName: 'default' }, source: { file: 'src/pages/home.tsx' } }],
    ['/users/2', '/users/1', '/users/2']);
  assert.deepEqual(pages.map(page => page.path), ['/', '/users/1', '/users/2']);
  assert.deepEqual(pages.find(page => page.path === '/users/1')?.head, {});
});
