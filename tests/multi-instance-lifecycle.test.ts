import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { ProjectRuntime, type Plugin } from '@cormijs/core';
import { createFeatureNamespace, defineReactFeature, reactPlugin } from '@cormijs/plugin-react';
import { DevApiService } from '@cormijs/plugin-dev-api/service';
import { gate, listen, close } from './helpers.js';

test('withdrawing a native instance drains only its request while the peer retains its Fiber and contributions', { timeout: 15000 }, async () => {
  const h = new ProjectRuntime(), entered = gate(), aborted = gate(), release = gate();
  h.mount('react', reactPlugin); h.mount('api', DevApiService); await h.ready();
  const starts: string[] = [];
  const plugin: Plugin.Object<{ instance: string }> = { name: 'same-plugin', inject: ['react', 'devApi'], apply(ctx, { instance }) {
    starts.push(instance); const ns = createFeatureNamespace('test:feature', instance);
    ctx.plugin(defineReactFeature({ id: ns.id, routes: [{ id: ns.key('page'), path: instance }],
      runtime: [{ id: ns.key('runtime'), module: { specifier: 'test/client', exportName: 'default' }, options: { instance } }] }));
    ctx.devApi.add(ns.key('api'), { mocks: [{ method: 'GET', path: '/' + instance, async handle({ signal }) {
      if (instance === 'alpha') {
        entered.resolve(); signal.addEventListener('abort', () => aborted.resolve(), { once: true });
        await release.promise; signal.throwIfAborted();
      }
      return { body: instance };
    } }] });
  } };
  h.mount('alpha', plugin, { instance: 'alpha' }); const beta = h.mount('beta', plugin, { instance: 'beta' }); await h.ready();
  const betaUid = beta.uid, handle = h.ctx.devApi.open();
  const server = createServer((req, res) => handle.middleware(req, res, () => res.end()));
  const port = await listen(server), url = `http://127.0.0.1:${port}/api`;
  try {
    const response = fetch(url + '/alpha'); await entered.promise;
    let finished = false; const disposing = h.unmount('alpha').then(() => { finished = true; });
    await aborted.promise;
    const withdrawn = await response; assert.equal(withdrawn.status, 503); await withdrawn.arrayBuffer();
    assert.equal(finished, false);
    assert.equal(await (await fetch(url + '/beta')).json(), 'beta'); assert.equal(beta.uid, betaUid);
    release.resolve(); await disposing; await h.ready();
    assert.deepEqual(starts, ['alpha', 'beta']);
    assert.deepEqual(h.ctx.react.routes.snapshot().map(r => r.owner), ['test:feature:beta']);
    assert.deepEqual(h.ctx.react.runtime.snapshot().map(r => r.owner), ['test:feature:beta']);
    assert.equal((await fetch(url + '/alpha')).status, 404);
  } finally { release.resolve(); await handle.close(); await h.dispose(); await close(server); }
});
