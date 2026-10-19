import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectRuntime, CormiError } from '@cormijs/core';
import { webPlugin } from '@cormijs/plugin-web';
import { vitePlugin } from '@cormijs/plugin-vite';
import { assertPortFree } from '../../tests/helpers.js';
import { httpText, returnedTo, sample, until } from './resources.js';

export async function nativeCycles(root: string, cycles: number) {
  await mkdir(root);
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Reliability</title><script type="module" src="/main.ts"></script>');
  await writeFile(join(root, 'main.ts'), 'console.log("reliability");');
  await writeFile(join(root, 'watched.txt'), 'initial');
  async function one(index: number, failCleanup = false) {
    const host = new ProjectRuntime(10000);
    let watchers = 0, timers = 0, callbacks = 0, ticks = 0;
    host.mount('web-consumer', webPlugin); host.mount('vite-provider', vitePlugin);
    host.mount('resource-probe', { apply(ctx) { ctx.effect(() => {
      const watcher = watch(join(root, 'watched.txt'), () => { callbacks++; }); watchers++;
      const timer = setInterval(() => { ticks++; }, 50); timers++;
      return async () => {
        clearInterval(timer); timers--;
        const stopped = new Promise<void>(resolve => watcher.once('close', resolve)); watcher.close(); await stopped; watchers--;
        if (failCleanup) throw new Error('EXPECTED_RELIABILITY_CLEANUP_FAILURE');
      };
    }); } });
    let port = 0;
    try {
      await host.ready();
      const session = await host.ctx.web.dev({ root, entry: 'index.html', outDir: 'dist', mode: 'development', base: '/', publicEnv: {} });
      port = Number(new URL(session.url).port);
      assert.match(await httpText(new URL('main.ts', session.url).href), /reliability/);
      await writeFile(join(root, 'watched.txt'), String(index));
      await until(() => callbacks > 0 && ticks > 0, 'real watcher and timer activity');
    } finally {
      if (failCleanup) await assert.rejects(host.dispose(), error => error instanceof CormiError && error.code === 'CLEANUP_INCOMPLETE');
      else await host.dispose();
    }
    assert.equal(watchers, 0); assert.equal(timers, 0);
    await assertPortFree(port);
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.cormi-vite-')), []);
    assert.ok(host.inspect().every(row => row.uid === null));
    return { index, failCleanup, port, callbacks, ticks, watchers, timers };
  }
  for (let index = -3; index < 0; index++) await one(index);
  const baseline = await sample();
  const measurements = [];
  for (let index = 0; index < cycles; index++) {
    const observation = await one(index, index % 5 === 4);
    await returnedTo(baseline.resources);
    measurements.push({ ...observation, sample: await sample() });
  }
  return { warmup: 3, cycles, baseline, measurements, memoryVerdict: 'observations-only-not-a-long-term-leak-proof' };
}
