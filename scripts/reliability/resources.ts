import assert from 'node:assert/strict';
import { get } from 'node:http';
import { rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setImmediate as immediate, setTimeout as delay } from 'node:timers/promises';

export type ResourceCounts = Record<string, number>;
export function resourceCounts(): ResourceCounts {
  const counts: ResourceCounts = {};
  for (const key of process.getActiveResourcesInfo()) counts[key] = (counts[key] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}
export async function until(check: () => boolean | Promise<boolean>, label: string, ms = 10000): Promise<void> {
  const end = performance.now() + ms;
  while (!(await check())) {
    assert.ok(performance.now() < end, 'Deadline: ' + label);
    await delay(20);
  }
}
export async function sample() {
  await immediate(); await immediate();
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (gc) { gc(); await immediate(); gc(); }
  return { at: performance.now(), gc: !!gc, memory: process.memoryUsage(), resources: resourceCounts() };
}
// Compare persistent resource classes, not transient FS requests caused by the sampler itself.
export const persistentKinds = ['FSEventWrap', 'FSWatcher', 'TCPServerWrap', 'TCPSocketWrap', 'ProcessWrap', 'PipeWrap', 'Timeout'];
export function excessResources(baseline: ResourceCounts, observed: ResourceCounts): ResourceCounts {
  return Object.fromEntries(persistentKinds.flatMap(key => {
    const delta = (observed[key] ?? 0) - (baseline[key] ?? 0);
    return delta > 0 ? [[key, delta]] : [];
  }));
}
export async function returnedTo(baseline: ResourceCounts): Promise<ResourceCounts> {
  await until(() => {
    const now = resourceCounts();
    return Object.keys(excessResources(baseline, now)).length === 0;
  }, 'persistent resources return to warmed baseline: ' + JSON.stringify(baseline), 5000);
  return resourceCounts();
}
export async function atomicWrite(file: string, value: string): Promise<void> {
  const temporary = file + '.swap-' + randomUUID();
  await writeFile(temporary, value, { flag: 'wx' });
  await rename(temporary, file);
}
export function httpText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = get(url, { agent: false }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += String(chunk); if (text.length > 1024 * 1024) request.destroy(new Error('Response budget')); });
      response.once('error', reject);
      response.once('end', () => response.statusCode === 200 ? resolve(text) : reject(new Error('HTTP ' + response.statusCode)));
    });
    request.setTimeout(3000, () => request.destroy(new Error('HTTP timeout')));
    request.once('error', reject);
  });
}
