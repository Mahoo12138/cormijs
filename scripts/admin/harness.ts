import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const hash = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
export async function deadline<T>(value: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([value, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Test operation deadline exceeded')), ms); })]); }
  finally { clearTimeout(timer); }
}
export async function guardedSource(app: string, relative: string) {
  const file = join(app, relative), info = await lstat(file), original = await readFile(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && await realpath(file) === file);
  let last = original;
  async function replace(value: Buffer | string) {
    const current = await lstat(file);
    assert.ok(current.isFile() && !current.isSymbolicLink() && current.ino === info.ino && current.dev === info.dev && await realpath(file) === file);
    assert.deepEqual(await readFile(file), last, 'External source change: refusing to overwrite ' + relative);
    await writeFile(file, value); last = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
  }
  return { original, replace, restore: () => replace(original) };
}
const environment = () => ({ ...process.env, NODE_PATH: '', NODE_OPTIONS: '', CI: 'true' });
export function appCommand(app: string, command: string, args: string[] = []): string {
  return execFileSync(process.execPath, [join(app, 'node_modules/cormijs/dist/cli.js'), command, '--json', '--startup-timeout', '60000', ...args],
    { cwd: app, env: environment(), encoding: 'utf8', timeout: 75000, maxBuffer: 16 * 1024 ** 2 });
}
export async function withAdminServer<T>(app: string, command: 'dev' | 'preview', logFile: string,
  action: (url: string, events: Array<Record<string, unknown>>) => Promise<T>): Promise<{ value: T; events: Array<Record<string, unknown>>; portRebound: true }> {
  const child = spawn(process.execPath, [join(app, 'node_modules/cormijs/dist/cli.js'), command, '--json', '--startup-timeout', '60000'],
    { cwd: app, env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
  const events: Array<Record<string, unknown>> = []; let buffered = '', log = '', ended = false, url = '';
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => { ended = true; accept({ code, signal }); });
  }); void done.catch(() => {});
  child.stdout.on('data', chunk => {
    const text = String(chunk); log += text; buffered += text;
    for (;;) { const end = buffered.indexOf('\n'); if (end < 0) break; const line = buffered.slice(0, end); buffered = buffered.slice(end + 1); try { events.push(JSON.parse(line)); } catch {} }
  });
  child.stderr.on('data', chunk => { log += String(chunk); });
  let value!: T;
  try {
    const until = Date.now() + 65000;
    while (!ended && Date.now() < until) { const ready = events.find(event => event.type === 'ready'); if (ready) { url = String(ready.url); break; } await delay(30); }
    assert.ok(url, 'Application did not become ready: ' + log.slice(-6000));
    assert.equal(new URL(url).hostname, '127.0.0.1'); value = await action(url, events);
  } finally {
    try {
      if (!ended) child.kill('SIGTERM');
      assert.deepEqual(await deadline(done, 12000), { code: 0, signal: null });
      if (url) { const socket = createServer(); await new Promise<void>((accept, reject) => {
        socket.once('error', reject); socket.listen(Number(new URL(url).port), '127.0.0.1', () => socket.close(error => error ? reject(error) : accept()));
      }); }
    } catch (error) { if (!ended) { child.kill('SIGKILL'); await deadline(done, 3000); } throw error; }
    finally { await writeFile(logFile, log); }
  }
  return { value, events, portRebound: true };
}
