import { watch, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from '@cormijs/core';

export interface ProbeOptions { root: string; version: string; value: string; stamp: number; fail: boolean }
export interface ProbeSnapshot { pid: number; version: string; value: string; stamp: number; watchers: number; timers: number; callbacks: number; ticks: number; memory: NodeJS.MemoryUsage; resources: string[] }

// Test-only composition: resources and their HTTP consumer are real native plugins.
// This file is copied into an isolated fixture, never loaded by a product preset.
const resources: Plugin.Object<ProbeOptions> = {
  name: 'test:resource-probe',
  apply(ctx, options) {
    let watchers = 0, timers = 0, callbacks = 0, ticks = 0;
    const snapshot = (): ProbeSnapshot => ({ pid: process.pid, version: options.version, value: options.value, stamp: options.stamp,
      watchers, timers, callbacks, ticks, memory: process.memoryUsage(), resources: process.getActiveResourcesInfo() });
    const record = (kind: string) => appendFileSync(join(options.root, 'probe-log.jsonl'), JSON.stringify({ kind, ...snapshot() }) + '\n');
    ctx.provide('reliabilityProbe', snapshot);
    ctx.effect(() => {
      const watcher = watch(join(options.root, 'watched.txt'), () => { callbacks++; record('callback'); }); watchers++;
      const timer = setInterval(() => { ticks++; }, 100); timers++;
      record('opened');
      return async () => {
        clearInterval(timer); timers--;
        const closed = new Promise<void>(resolve => watcher.once('close', resolve));
        watcher.close(); await closed; watchers--; record('closed');
      };
    });
  },
};
const http: Plugin.Object<ProbeOptions> = {
  name: 'test:probe-http', inject: ['commands', 'reliabilityProbe'],
  apply(ctx, options) {
    if (options.fail) throw new Error('EXPECTED_RELIABILITY_INITIALIZATION_FAILURE');
    ctx.effect(() => ctx.commands.register('dev', async () => {
      const snapshot = ctx.get('reliabilityProbe') as (() => ProbeSnapshot) | undefined;
      if (typeof snapshot !== 'function') throw new Error('Required probe service unavailable');
      const server = createServer((_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(snapshot())); });
      let closing: Promise<void> | undefined;
      const close = () => closing ??= new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
      ctx.effect(() => close);
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No probe address');
      return { kind: 'server', handle: { url: 'http://127.0.0.1:' + address.port + '/', close } };
    }));
  },
};
const probe: Plugin.Object<ProbeOptions> = {
  name: 'test:probe-composition',
  apply(ctx, options) { ctx.plugin(resources, options); ctx.plugin(http, options); },
};
export default probe;
