import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectRuntime, deadline, type Plugin } from '@cormijs/core';
import { webPlugin } from '@cormijs/plugin-web';
import { vitePlugin } from '@cormijs/plugin-vite';
import { assertPortFree, close, fixture, gate, hasCode, listen } from './helpers.js';

const options = { timeout: 15000 };
function host() {
  const h = new ProjectRuntime(6000);
  h.mount('web', webPlugin); h.mount('vite', vitePlugin);
  return h;
}

test('real Vite dev serves HTML and transformed TypeScript; close is idempotent', options, async () => {
  const f = await fixture(); const h = host();
  try {
    await h.ready(); const dev = await h.ctx.web.dev(f.plan); const port = Number(new URL(dev.url).port);
    const html = await fetch(dev.url); assert.equal(html.status, 200); assert.match(await html.text(), /Cormi/);
    const script = await fetch(new URL('main.ts', dev.url)); assert.equal(script.status, 200); assert.match(await script.text(), /Cormi ready/);
    await Promise.all([dev.close(), dev.close()]); await assertPortFree(port);
    assert.deepEqual((await readdir(f.root)).filter(x => x.startsWith('.cormi-vite-')), []);
  } finally { await h.dispose(); await f.clean(); }
});

test('explicit invalidation owns generated-file updates instead of also propagating watcher HMR', options, async () => {
  const f = await fixture(), h = host(), observed = gate();
  let count = -1;
  h.mount('observer', { inject: ['vite'], apply: ctx => {
    ctx.effect(() => ctx.vite.add('observer', () => ({ name: 'observer', enforce: 'post',
      handleHotUpdate(update) {
        if (update.file.endsWith('/main.ts')) { count = update.modules.length; observed.resolve(); }
      },
    })));
  } });
  try {
    await h.ready(); const dev = await h.ctx.web.dev(f.plan);
    await fetch(new URL('main.ts', dev.url));
    assert.ok(dev.invalidate); await dev.invalidate(['main.ts']);
    await writeFile(join(f.root, 'main.ts'), 'document.body.textContent = "managed update";');
    await deadline(observed.promise, 5000, new Error('Watcher did not observe the managed update'));
    assert.equal(count, 0);
    assert.match(await (await fetch(new URL('main.ts', dev.url))).text(), /managed update/);
  } finally { await h.dispose(); await f.clean(); }
});
test('20 complete host/provider/server start-stop cycles release their listening ports', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 20; i++) {
      const h = host(); let port = 0;
      try { await h.ready(); const dev = await h.ctx.web.dev(f.plan); port = Number(new URL(dev.url).port); }
      finally { await h.dispose(); }
      await assertPortFree(port);
      assert.deepEqual((await readdir(f.root)).filter(x => x.startsWith('.cormi-vite-')), []);
    }
  } finally { await f.clean(); }
});

test('a busy port fails without stopping the unrelated listener', options, async () => {
  const f = await fixture(); const h = host(); const external = createServer((_, res) => res.end('external'));
  const port = await listen(external);
  try {
    await h.ready(); await assert.rejects(h.ctx.web.dev({ ...f.plan, server: { port } }), /already in use/);
    const response = await fetch(`http://127.0.0.1:${port}`); assert.equal(await response.text(), 'external');
    assert.deepEqual((await readdir(f.root)).filter(x => x.startsWith('.cormi-vite-')), []);
  } finally { await h.dispose(); await close(external); await f.clean(); }
});

test('configureServer post-hook installs middleware rather than acting as a disposer', options, async () => {
  const f = await fixture(); const h = host(); let installed = 0;
  h.mount('native', { inject: ['vite'], apply: ctx => {
    ctx.effect(() => ctx.vite.add('post', () => ({ name: 'post', configureServer() { return () => { installed++; }; } })));
  } });
  try {
    await h.ready(); const dev = await h.ctx.web.dev(f.plan); assert.equal(installed, 1);
    await dev.close(); assert.equal(installed, 1);
  } finally { await h.dispose(); await f.clean(); }
});

test('native configureServer failure closes a provisionally acquired server', options, async () => {
  const f = await fixture(); const h = host(); const cause = new Error('configure fault');
  h.mount('fault', { inject: ['vite'], apply: ctx => {
    ctx.effect(() => ctx.vite.add('fault', () => ({ name: 'fault', configureServer() { throw cause; } })));
  } });
  try {
    await h.ready(); await assert.rejects(h.ctx.web.dev(f.plan), /configure fault/);
    assert.deepEqual((await readdir(f.root)).filter(x => x.startsWith('.cormi-vite-')), []);
  } finally { await h.dispose(); await f.clean(); }
});

test('unload while Vite is initializing rejects and closes the late session', options, async () => {
  const f = await fixture(); const h = host(); const entered = gate(); const release = gate(); let port = 0;
  const bridge: Plugin.Object<void> = { inject: ['vite'], apply: ctx => {
    ctx.effect(() => ctx.vite.add('slow', () => ({ name: 'slow', async configureServer(server) {
      server.httpServer?.once('listening', () => { const address = server.httpServer?.address(); if (address && typeof address !== 'string') port = address.port; });
      entered.resolve(); await release.promise;
    } })));
  } };
  h.mount('slow-bridge', bridge); await h.ready();
  try {
    const task = h.ctx.web.dev(f.plan);
    const rejected = assert.rejects(task, hasCode('PLUGIN_INACTIVE'));
    await entered.promise; const disposing = h.dispose(); release.resolve();
    await Promise.all([rejected, disposing]);
    if (port) await assertPortFree(port);
    assert.deepEqual((await readdir(f.root)).filter(x => x.startsWith('.cormi-vite-')), []);
  } finally { release.resolve(); await h.dispose(); await f.clean(); }
});

test('native registration is scoped and each session uses fresh plugin instances', options, async () => {
  const f = await fixture(); const h = host(); let constructed = 0; const order: string[] = [];
  h.mount('bridge', { inject: ['vite'], apply: ctx => {
    ctx.effect(() => ctx.vite.add('z', () => { constructed++; return { name: 'z', configureServer() { order.push('z'); } }; }, 2));
    ctx.effect(() => ctx.vite.add('a', () => ({ name: 'a', configureServer() { order.push('a'); } }), 1));
  } });
  try {
    await h.ready(); assert.deepEqual(h.ctx.vite.ids(), ['a', 'z']);
    const first = await h.ctx.web.dev(f.plan); await first.close();
    const second = await h.ctx.web.dev(f.plan); await second.close();
    assert.equal(constructed, 2); assert.deepEqual(order, ['a', 'z', 'a', 'z']);
    await h.unmount('bridge'); assert.deepEqual(h.ctx.vite.ids(), []);
  } finally { await h.dispose(); await f.clean(); }
});
