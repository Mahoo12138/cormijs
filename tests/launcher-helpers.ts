import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { realpath, symlink, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture } from './helpers.js';
import type { TestContext } from 'node:test';

const cleanups = new Map<string, Array<() => Promise<void>>>();
export async function app(t: TestContext) {
  const f = await fixture(); const root = await realpath(f.root);
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  cleanups.set(root, []);
  t.after(async () => {
    try { for (const cleanup of [...(cleanups.get(root) ?? [])].reverse()) await cleanup(); }
    finally { cleanups.delete(root); await f.clean(); }
  });
  return { root, write: (name: string, content: string) => writeFile(join(root, name), content) };
}
export function cli(t: TestContext, root: string, command: string, args: string[] = []) {
  const child = spawn(process.execPath, [resolve('packages/cormi/dist/cli.js'), command, '--root', root, '--json', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_PATH: '' },
  });
  const events: Record<string, any>[] = []; let buffer = '', stderr = ''; let ended = false;
  child.stdout.on('data', chunk => {
    buffer += String(chunk);
    for (;;) {
      const index = buffer.indexOf('\n'); if (index < 0) break;
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try { events.push(JSON.parse(line)); } catch { stderr += line; }
    }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-20000); });
  const done = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', code => { ended = true; resolve(code); }); });
  async function waitFor(predicate: (event: Record<string, any>) => boolean, from = 0, timeout = 12000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const match = events.slice(from).find(predicate); if (match) return match;
      if (ended) throw new Error(`CLI exited before expected event: ${JSON.stringify(events)} ${stderr}`);
      await delay(20);
    }
    throw new Error(`CLI event timeout: ${JSON.stringify(events)} ${stderr}`);
  }
  async function finish(timeout = 12000) {
    let timer: NodeJS.Timeout;
    try { return await Promise.race([done, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`CLI exit timeout: ${JSON.stringify(events)} ${stderr}`)), timeout); })]); }
    finally { clearTimeout(timer!); }
  }
  async function stop() { if (!ended) child.kill('SIGTERM'); return finish(); }
  const cleanup = async () => {
    try { await stop(); }
    catch { if (!ended) child.kill('SIGKILL'); await done; }
  };
  const registered = cleanups.get(root);
  if (registered) registered.push(cleanup); else t.after(cleanup);
  return { child, events, waitFor, finish, stop, get stderr() { return stderr; } };
}
export function webConfig(extra = '', options = '{}', imported = `import { value } from './settings';`) {
  return `import { defineConfig } from 'cormijs';
import { webPlugin, webCommandsPlugin } from '@cormijs/plugin-web';
import { vitePlugin } from '@cormijs/plugin-vite';
${imported}
export default defineConfig({ app: ${options}, plugins: [
 {id:'web',plugin:webPlugin}, {id:'commands',plugin:webCommandsPlugin}, {id:'vite',plugin:vitePlugin},
 {id:'bridge',plugin:{inject:['vite'],apply:async ctx=>{ ${extra}
 ctx.effect(()=>ctx.vite.add('version',()=>({name:'version',configureServer(server){ server.middlewares.use('/version',(_req,res)=>res.end(value)); }})));
 }}}
] });`;
}
export async function cleanLauncher(root: string) {
  assert.equal(existsSync(join(root, '.cormi.lock')), false);
  if (existsSync(join(root, '.cormi'))) assert.deepEqual(await readdir(join(root, '.cormi')), []);
}
