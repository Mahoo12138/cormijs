import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { bindLauncherControl, isShutdownMessage } from '../packages/cormi/src/control.js';
import { assertPortFree } from './helpers.js';

function source(parent = true) { return Object.assign(new EventEmitter(), { connected: parent, send: parent ? () => {} : undefined }); }
test('launcher control accepts only its exact versioned shutdown envelope', () => {
  assert.equal(isShutdownMessage({ version: 1, type: 'cormi:shutdown' }), true);
  for (const value of [null, [], 'shutdown', { version: 2, type: 'cormi:shutdown' }, { version: 1, type: 'stop' }, { version: 1, type: 'cormi:shutdown', command: 'build' }]) assert.equal(isShutdownMessage(value), false);
});
test('scoped control detaches idempotently without removing other owners listeners', () => {
  const p = source(), c = new AbortController(); let other = 0;
  p.on('message', () => { other++; }); const off = bindLauncherControl(c, p);
  p.emit('message', { version: 1, type: 'stop' }); assert.equal(c.signal.aborted, false);
  off(); off(); p.emit('message', { version: 1, type: 'cormi:shutdown' }); p.emit('SIGINT');
  assert.equal(c.signal.aborted, false); assert.equal(other, 2);
  assert.equal(p.listenerCount('message'), 1); assert.equal(p.listenerCount('disconnect'), 0);
});
test('control never creates a message channel for an ordinary CLI and accepts existing parent disconnection', () => {
  const plain = source(false), a = new AbortController(), offA = bindLauncherControl(a, plain);
  assert.equal(plain.listenerCount('message'), 0); plain.emit('SIGINT'); assert.equal(a.signal.aborted, true); offA();
  const parent = source(), b = new AbortController(), offB = bindLauncherControl(b, parent);
  parent.emit('disconnect'); assert.equal(b.signal.aborted, true); offB();
});

test('duplicate shutdown messages abort once and inherited fields are not a control envelope', () => {
  const parent = source(), c = new AbortController(); let count = 0; c.signal.addEventListener('abort', () => { count++; });
  const off = bindLauncherControl(c, parent);
  parent.emit('message', Object.assign(Object.create({version:1,type:'cormi:shutdown'}), {a:1,b:2})); assert.equal(count, 0);
  parent.emit('message', {version:1,type:'cormi:shutdown'}); parent.emit('message', {version:1,type:'cormi:shutdown'});
  assert.equal(count, 1); off();
});

async function fixture(t: import('node:test').TestContext, config: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi ipc 中文 ')));
  await symlink(resolve('node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(root, 'cormi.config.ts'), config);
  const child = fork(resolve('packages/cormi/dist/cli.js'), ['serve', '--root', root, '--json', '--startup-timeout', '3000', '--shutdown-timeout', '2000'], {
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NODE_PATH: '' },
  });
  let output = '', errors = '', ended = false; child.stdout!.on('data', x => { output += x; }); child.stderr!.on('data', x => { errors += x; });
  const done = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', code => { ended = true; resolve(code); }); });
  void done.catch(() => {});
  const exited = new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); });
  const pipeClosed = (pipe: NodeJS.ReadableStream) => new Promise<void>(resolvePipe => pipe.once('close', resolvePipe));
  // Node may omit ChildProcess.close after the parent explicitly disconnects IPC (#65646).
  // Observe exit AND both real pipe-close events; never synthesize a close event or treat exit alone as drained.
  const drained = Promise.all([exited, pipeClosed(child.stdout!), pipeClosed(child.stderr!)]).then(([code]) => { ended = true; return code; });
  void drained.catch(() => {});
  async function waitFor(type: string, timeout = 6000): Promise<Record<string, any>> {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const lines = output.split('\n').slice(0, -1);
      for (const line of lines) { try { const event = JSON.parse(line); if (event.type === type) return event; } catch {} }
      if (ended) break; await delay(10);
    }
    throw new Error(`No ${type}: ${output}\n${errors}`);
  }
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await drained; await rm(root, { recursive: true, force: true }); });
  return { root, child, done, drained, waitFor, get output() { return output; }, get errors() { return errors; } };
}
const config = `import {defineConfig} from 'cormijs';import {createServer} from 'node:http';import {writeFile} from 'node:fs/promises';import {join} from 'node:path';
export default defineConfig({plugins:[{id:'server',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.register('serve',async request=>{
 const s=createServer((_req,res)=>res.end('ipc server'));await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve)});
 return {kind:'server',handle:{url:'http://127.0.0.1:'+s.address().port+'/',async close(){await new Promise((resolve,reject)=>{s.close(e=>e?reject(e):resolve());s.closeAllConnections()});await writeFile(join(request.root,'closed.txt'),'closed')}}};
}))}}}]});`;
const options = { timeout: 12000 };
test('real forked CLI cooperatively shuts down over parent IPC and releases port and project lock', options, async t => {
  const f = await fixture(t, config), event = await f.waitFor('ready');
  f.child.send({ version: 1, type: 'stop' }); assert.equal((await fetch(event.url)).status, 200);
  f.child.send({ version: 1, type: 'cormi:shutdown' });
  await f.waitFor('stopped'); assert.equal(await f.done, 0, f.errors);
  assert.equal(await readFile(join(f.root, 'closed.txt'), 'utf8'), 'closed'); assert.equal(existsSync(join(f.root, '.cormi.lock')), false);
  assert.deepEqual(await readdir(join(f.root, '.cormi')), []); await assertPortFree(Number(new URL(event.url).port));
});
test('real parent IPC disconnect is cooperative, not process termination', options, async t => {
  const f = await fixture(t, config), event = await f.waitFor('ready'); f.child.disconnect();
  await f.waitFor('stopped'); assert.equal(await f.drained, 0, f.errors);
  t.diagnostic('Parent disconnect: observed child exit plus stdout/stderr close, not synthetic ChildProcess.close.');
  assert.equal(existsSync(join(f.root, '.cormi.lock')), false); assert.equal(await readFile(join(f.root, 'closed.txt'), 'utf8'), 'closed');
  await assertPortFree(Number(new URL(event.url).port));
});
test('a forked one-shot command releases its parent channel and exits without an explicit stop', options, async t => {
  const f = await fixture(t, `import {defineConfig} from 'cormijs';
    export default defineConfig({plugins:[{id:'once',plugin:{inject:['commands'],apply(ctx){
      ctx.effect(()=>ctx.commands.register('serve',async()=>({kind:'result',data:'once'})));
    }}}]});`);
  const result = await f.waitFor('result'); assert.equal(result.data, 'once');
  await f.waitFor('stopped'); assert.equal(await f.done, 0, f.errors);
  assert.equal(existsSync(join(f.root, '.cormi.lock')), false);
});

test('IPC stop during non-cooperative worker startup remains bounded and exits nonzero', options, async t => {
  const f = await fixture(t, "import {writeFileSync} from 'node:fs';import {join} from 'node:path';writeFileSync(join(import.meta.dirname,'busy.txt'),'busy');while(true){};export default {};"); await f.waitFor('starting');
  const until = Date.now() + 2000;
  while (!existsSync(join(f.root, 'busy.txt')) && Date.now() < until) await delay(10);
  assert.equal(existsSync(join(f.root, 'busy.txt')), true, 'worker must enter the non-cooperative section before cancellation');
  f.child.send({ version: 1, type: 'cormi:shutdown' }); await f.waitFor('stopped');
  assert.equal(await f.done, 1); assert.match(f.output, /WORKER_STOP_TIMEOUT|CLEANUP_INCOMPLETE/);
  assert.equal(existsSync(join(f.root, '.cormi.lock')), false);
});
