import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, realpath, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectRuntime } from '@cormijs/core';
import { reactPlugin } from '@cormijs/plugin-react';
import type { ApplicationRequest } from '@cormijs/plugin-web';
import { fixture, gate, hasCode } from './helpers.js';

async function project() {
  const f = await fixture(), root = await realpath(f.root), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default function Page(){return null}');
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'dev', mode: 'development', options: {}, signal: new AbortController().signal };
  return { root, host, request, write: (file: string, text: string) => writeFile(join(root, file), text),
    async close() { try { await host.dispose(); } finally { await f.clean(); } } };
}
const options = { timeout: 10000 };

test('a recoverable route conflict cannot conceal pre-existing unowned generated files', options, async () => {
  const f = await project();
  try {
    await mkdir(join(f.root, '.cormi'));
    await f.write('.cormi/app.tsx', 'USER OWNED; DO NOT REPLACE');
    await f.write('src/pages/index.jsx', 'export default ()=>null');
    await assert.rejects(f.host.ctx.application.prepare(f.request), hasCode('GENERATED_NOT_OWNED'));
    assert.equal(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), 'USER OWNED; DO NOT REPLACE');
  } finally { await f.close(); }
});

test('compiler close drains admitted error notifications and never calls a later listener after closure', options, async () => {
  const f = await project(), entered = gate(), release = gate();
  let closing: Promise<void> | undefined;
  try {
    const session = await f.host.ctx.application.prepare(f.request);
    const events: string[] = [];
    session.development!.subscribe(async state => {
      if (state.status !== 'error') return;
      events.push('first:start'); entered.resolve(); await release.promise; events.push('first:end');
    });
    session.development!.subscribe(async () => { events.push('late-listener'); });
    await f.write('src/pages/index.jsx', 'export default ()=>null'); await entered.promise;
    let closed = false; closing = session.close().then(() => { closed = true; });
    await delay(40); assert.equal(closed, false, 'close must not leave an admitted notification running');
    release.resolve(); await closing;
    assert.deepEqual(events, ['first:start', 'first:end']);
    assert.throws(() => session.development!.subscribe(async () => {}));
  } finally { release.resolve(); await closing; await f.close(); }
});

test('removing a subscribed observer while another one is awaiting prevents its late delivery', options, async () => {
  const f = await project(), entered = gate(), release = gate(), finished = gate();
  let session: Awaited<ReturnType<typeof f.host.ctx.application.prepare>> | undefined;
  try {
    session = await f.host.ctx.application.prepare(f.request);
    let deliveries = 0;
    session.development!.subscribe(async state => {
      if (state.status !== 'error') return;
      entered.resolve(); await release.promise; finished.resolve();
    });
    const off = session.development!.subscribe(async () => { deliveries++; });
    await f.write('src/pages/index.jsx', 'export default ()=>null'); await entered.promise;
    off(); release.resolve(); await finished.promise;
    await session.close();
    assert.equal(deliveries, 0);
  } finally { release.resolve(); await session?.close(); await f.close(); }
});

test('observer failures do not turn a valid generation into a compilation error, but fail shutdown', options, async () => {
  const f = await project(), delivered = gate(), cause = new Error('diagnostic transport failure');
  try {
    const session = await f.host.ctx.application.prepare(f.request);
    session.development!.subscribe(async () => { throw cause; });
    session.development!.subscribe(async () => { delivered.resolve(); });
    await f.write('src/pages/new.tsx', 'export default ()=>null'); await delivered.promise;
    assert.equal(session.development!.current().status, 'ready');
    assert.match(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), /new.tsx/);
    await assert.rejects(session.close(), error => error instanceof AggregateError && error.errors.includes(cause));
  } finally { await f.close(); }
});

test('an old unsubscribe cannot remove a new subscription of the same callback', options, async () => {
  const f = await project(), delivered = gate();
  try {
    const session = await f.host.ctx.application.prepare(f.request);
    let count = 0;
    const callback = async () => { count++; delivered.resolve(); };
    const old = session.development!.subscribe(callback); old();
    session.development!.subscribe(callback); old();
    await f.write('src/pages/index.jsx', 'export default ()=>null'); await delivered.promise;
    await session.close(); assert.equal(count, 1);
  } finally { await f.close(); }
});
