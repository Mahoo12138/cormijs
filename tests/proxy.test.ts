import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { normalizeProxy, proxyPlugin } from '@cormijs/plugin-react-vite';
import { app, cli } from './launcher-helpers.js';
import { close, listen } from './helpers.js';

const hasCode = (code: string) => (error: any) => (error?.code ?? error?.cause?.code) === code;

test('normalizeProxy validates prefixes, targets and bounded options', () => {
  assert.deepEqual(normalizeProxy({ '/api': 'http://127.0.0.1:8080', '/ws': { target: 'https://example.test', changeOrigin: true, ws: true } }), {
    '/api': { target: 'http://127.0.0.1:8080' },
    '/ws': { target: 'https://example.test', changeOrigin: true, ws: true },
  });
  for (const input of [
    {}, { api: 'http://x.test' }, { '//api': 'http://x.test' }, { '/../api': 'http://x.test' },
    { '/api': 'file:///etc/passwd' }, { '/api': 'http://user:pass@x.test' }, { '/api': {} },
    { '/api': { target: 'http://x.test', rewrite: (path: string) => path } },
    { '/api': { target: 'http://x.test', changeOrigin: 'yes' } },
    Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`/p${index}`, 'http://x.test'])),
  ]) assert.throws(() => normalizeProxy(input), hasCode('PROXY_INVALID'), JSON.stringify(input));
});

test('proxy plugin registers its Vite bridge, validates options and withdraws', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-proxy 中文-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = new ProjectRuntime(3000, root);
  host.mount('vite', vitePlugin);
  host.mount('proxy', proxyPlugin, { proxy: { '/api': 'http://127.0.0.1:1' } });
  await host.ready();
  assert.ok(host.ctx.vite.ids().includes('cormi:proxy'));
  await host.unmount('proxy');
  assert.ok(!host.ctx.vite.ids().includes('cormi:proxy'));
  await host.dispose();

  const rejecting = new ProjectRuntime(3000, root);
  rejecting.mount('vite', vitePlugin);
  rejecting.mount('invalid', proxyPlugin, { proxy: { api: 'http://x.test' } });
  await assert.rejects(rejecting.ready(), hasCode('PLUGIN_FAILED'));
  await rejecting.dispose();
});

async function upstream(t: TestContext) {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ url: request.url, host: request.headers.host }));
  });
  const port = await listen(server);
  t.after(() => close(server));
  return port;
}

async function fixture(t: TestContext, port: number) {
  const f = await app(t);
  await mkdir(join(f.root, 'src/pages'), { recursive: true });
  await f.write('index.html', '<!doctype html><html><head><meta charset="utf-8" /><title>Proxy demo</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>');
  await f.write('src/pages/index.tsx', 'export default () => <main>Proxy home</main>;');
  await f.write('cormi.config.ts', `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { proxyPlugin } from '@cormijs/plugin-react-vite';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'proxy', plugin: proxyPlugin, options: { proxy: { '/upstream': { target: 'http://127.0.0.1:${port}', changeOrigin: true, ws: true } } } }],
  app: { routes: [], server: { port: 0 } },
});
`);
  return f;
}

async function verifyProxy(url: string, expectedHost: string) {
  const response = await fetch(new URL('upstream/hello?x=1', url));
  assert.equal(response.status, 200);
  const body = await response.json() as { url: string; host: string };
  assert.equal(body.url, '/upstream/hello?x=1');
  assert.equal(body.host, expectedHost);
}

test('proxy serves upstream paths in dev and preview', { timeout: 150000 }, async t => {
  const port = await upstream(t), expectedHost = `127.0.0.1:${port}`;
  const f = await fixture(t, port);
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '30000']), ready = await dev.waitFor(event => event.type === 'ready', 0, 30000);
  await verifyProxy(ready.url, expectedHost);
  const missing = await fetch(new URL('not-proxied', ready.url));
  assert.match(missing.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(await dev.stop(), 0, JSON.stringify(dev.events) + dev.stderr);

  const build = cli(t, f.root, 'build', ['--startup-timeout', '30000']);
  assert.equal(await build.finish(30000), 0, JSON.stringify(build.events) + build.stderr);
  const preview = cli(t, f.root, 'preview'), production = await preview.waitFor(event => event.type === 'ready');
  await verifyProxy(production.url, expectedHost);
  assert.equal(await preview.stop(), 0, JSON.stringify(preview.events) + preview.stderr);
});
