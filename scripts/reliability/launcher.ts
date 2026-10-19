import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runCormi, type LauncherEvent } from 'cormijs/launcher';
import { assertPortFree } from '../../tests/helpers.js';
import { atomicWrite, httpText, returnedTo, sample, until } from './resources.js';
import type { ProbeSnapshot } from './worker-plugin.js';

function launch(root: string, watching: boolean) {
  const controller = new AbortController(), events: LauncherEvent[] = [];
  let ended = false, failure: unknown, logs = '';
  const done = runCormi({ root, command: 'dev', mode: 'staging', watch: watching, pollIntervalMs: 50,
    startupTimeoutMs: 10000, shutdownTimeoutMs: 5000, signal: controller.signal,
    onEvent(event) { events.push(event); }, onLog(_stream, text) { logs = (logs + text).slice(-12000); },
  });
  void done.then(() => { ended = true; }, error => { ended = true; failure = error; });
  async function event(predicate: (value: LauncherEvent) => boolean, from = 0) {
    let found: LauncherEvent | undefined;
    await until(() => { found = events.slice(from).find(predicate); if (ended && !found) throw failure ?? new Error(logs + JSON.stringify(events)); return !!found; }, 'launcher event');
    return found!;
  }
  async function value(expected: { version: string; value: string; stamp: number }, from = 0) {
    let cursor = from;
    const end = performance.now() + 15000;
    for (;;) {
      assert.ok(performance.now() < end, 'Latest accepted value deadline');
      const ready = await event(e => e.type === 'ready', cursor); cursor = events.indexOf(ready) + 1;
      try {
        const observation = JSON.parse(await httpText(String(ready.url))) as ProbeSnapshot;
        if (observation.version === expected.version && observation.value === expected.value && observation.stamp === expected.stamp) return { ready, observation };
      } catch (error) {
        // An intermediate accepted generation may have closed while the next one starts.
        if (!['ECONNREFUSED','ECONNRESET'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }
  }
  async function stop() { controller.abort(); const code = await done; assert.equal(code, 0, logs + JSON.stringify(events)); }
  return { events, event, value, stop };
}
async function clean(root: string) {
  assert.equal(existsSync(join(root, '.cormi.lock')), false);
  assert.deepEqual((await readdir(join(root, '.cormi'))).filter(name => name.startsWith('run-')), []);
}
export async function launcherCycles(root: string, workspace: string, cycles: number, batches: number) {
  await mkdir(root); await symlink(join(workspace, 'node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, 'probe.ts'), await readFile(fileURLToPath(new URL('./worker-plugin.ts', import.meta.url))));
  const settings = (version: string, fail = false) => 'export default ' + JSON.stringify({ version, fail }) + ';';
  await writeFile(join(root, 'settings.ts'), settings('initial'));
  await writeFile(join(root, 'trigger.json'), '0'); await writeFile(join(root, 'watched.txt'), '0');
  await writeFile(join(root, '.env'), 'CORMI_PUBLIC_PROBE=base');
  await writeFile(join(root, 'cormi.config.ts'), `import probe from './probe';import settings from './settings';import {readFileSync} from 'node:fs';
export default ({root,env})=>({watch:['trigger.json'],plugins:[{id:'probe',plugin:probe,options:{...settings,root,value:env.CORMI_PUBLIC_PROBE,stamp:JSON.parse(readFileSync(new URL('./trigger.json',import.meta.url),'utf8'))}}]});`);
  // Warm the compiler's reusable subprocess; do not count it as a serving worker leak.
  const warm = launch(root, false);
  try { const ready = await warm.event(e => e.type === 'ready'); await warm.stop(); await assertPortFree(Number(new URL(String(ready.url)).port)); }
  finally { await warm.stop(); }
  await clean(root);
  const baseline = await sample(); const sessions = [];
  for (let i = 0; i < cycles; i++) {
    await atomicWrite(join(root, 'settings.ts'), settings('cycle-' + i));
    const current = launch(root, false);
    try {
      const { ready, observation } = await current.value({ version: 'cycle-' + i, value: 'base', stamp: 0 });
      assert.equal(observation.watchers, 1); assert.equal(observation.timers, 1);
      await current.stop(); await assertPortFree(Number(new URL(String(ready.url)).port)); await clean(root);
      await returnedTo(baseline.resources); sessions.push({ cycle: i, pid: observation.pid, sample: await sample() });
    } finally { await current.stop(); }
  }
  let expected = { version: 'cycle-' + (cycles - 1), value: 'base', stamp: 0 };
  const current = launch(root, true); const observations = [];
  try {
    let active = await current.value(expected);
    for (let i = 0; i < batches; i++) {
      const from = current.events.length, kind = i % 5;
      if (kind === 2 || kind === 3) {
        const filename = kind === 2 ? 'settings.ts' : '.env.staging.local';
        await atomicWrite(join(root, filename), kind === 2 ? 'export default { broken syntax' : 'CORMI_PUBLIC_PROBE="BROKEN_SYNTHETIC');
        const bad = await current.event(e => e.type === 'error' && e.servingPrevious === true, from);
        assert.equal(bad.code, 'CONFIG_COMPILE_FAILED');
        const previous = JSON.parse(await httpText(String(active.ready.url))) as ProbeSnapshot;
        assert.equal(previous.pid, active.observation.pid);
        assert.equal(previous.version, expected.version); assert.equal(previous.value, expected.value);
        const starts = current.events.filter(e => e.type === 'starting').length;
        await delay(160); // Explicit three-poll observation window for unchanged invalid input.
        assert.equal(current.events.filter(e => e.type === 'starting').length, starts);
      }
      if (kind === 4) {
        await atomicWrite(join(root, 'settings.ts'), settings('failed-' + i, true));
        await current.event(e => e.type === 'error' && e.servingPrevious === false, from);
        await atomicWrite(join(root, 'trigger.json'), String(i)); expected.stamp = i;
      }
      if (kind === 1) {
        for (const suffix of ['a','b','final']) await atomicWrite(join(root, '.env.staging.local'), 'CORMI_PUBLIC_PROBE=env-' + i + '-' + suffix);
        expected.value = 'env-' + i + '-final';
      } else if (kind === 3) {
        await rm(join(root, '.env.staging.local')); expected.value = 'base';
      } else {
        for (const suffix of ['a','b','final']) await atomicWrite(join(root, 'settings.ts'), settings('version-' + i + '-' + suffix));
        expected.version = 'version-' + i + '-final';
      }
      active = await current.value(expected, from);
      assert.equal(active.observation.watchers, 1); assert.equal(active.observation.timers, 1);
      await writeFile(join(root, 'watched.txt'), String(i));
      await until(async () => (JSON.parse(await httpText(String(active.ready.url))) as ProbeSnapshot).callbacks > 0, 'current worker watcher delivery');
      observations.push({ batch: i, kind, expected: { ...expected }, sample: active.observation, generation: active.ready.generation });
    }
    await current.stop(); await assertPortFree(Number(new URL(String(active.ready.url)).port)); await clean(root);
  } finally { await current.stop(); }
  await returnedTo(baseline.resources);
  const records = (await readFile(join(root, 'probe-log.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as ProbeSnapshot & { kind: string });
  const opened = records.filter(r => r.kind === 'opened'), closed = records.filter(r => r.kind === 'closed');
  assert.deepEqual(opened.map(r => r.pid).sort(), closed.map(r => r.pid).sort());
  assert.ok(closed.every(r => r.watchers === 0 && r.timers === 0));
  const closedAt = new Set<number>();
  for (const record of records) { assert.ok(record.kind !== 'callback' || !closedAt.has(record.pid), 'No callback after owner cleanup'); if (record.kind === 'closed') closedAt.add(record.pid); }
  const workerPids = [...new Set([...opened.map(record => record.pid), ...current.events.filter(event => event.type === 'starting').map(event => Number(event.pid))])];
  for (const pid of workerPids) {
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH', 'Owned worker must have exited: ' + pid);
  }
  const ports = [...new Set(current.events.filter(event => event.type === 'ready').map(event => Number(new URL(String(event.url)).port)))];
  for (const port of ports) await assertPortFree(port);
  return { cycles, batches, warmup: 1, baseline, sessions, observations, events: current.events, workerPids, verifiedFreePorts: ports, opened: opened.length, closed: closed.length, final: await sample(),
    installation: 'workspace-linked-test-fixture; independent tarball acceptance is a separate suite' };
}
