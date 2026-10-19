import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, cleanLauncher } from './launcher-helpers.js';

// A carrier can cancel synchronously from its starting notification. The worker's
// outstanding readiness rejection must still have an observer after cancellation.
test('synchronous cancellation at worker-start publication drains readiness without an unhandled rejection', { timeout: 15000 }, async t => {
  const f = await app(t);
  await writeFile(join(f.root, 'cormi.config.ts'), 'export default {plugins:[]};');
  const script = join(f.root, 'carrier.mjs');
  await writeFile(script, `import {runCormi} from 'cormijs/launcher';
const controller = new AbortController();
const code = await runCormi({root:process.cwd(),command:'probe',signal:controller.signal,
 onEvent(event){console.log(JSON.stringify(event));if(event.type==='starting')controller.abort();}});
console.log('CARRIER_RESULT:'+code);process.exitCode=code;`);
  const child = spawn(process.execPath, ['--unhandled-rejections=strict', script], { cwd: f.root, stdio: ['ignore','pipe','pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { output += String(chunk); });
  const done = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const deadline = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 10000);
  let code: number | null;
  try { code = await done; } finally { clearTimeout(deadline); }
  assert.equal(code, 0, output);
  assert.match(output, /CARRIER_RESULT:0/);
  assert.doesNotMatch(output, /unhandled|WORKER_EXITED|WORKER_START_TIMEOUT/i);
  await cleanLauncher(f.root);
});

test('cancellation at replacement-worker publication preserves orderly old and new worker teardown', { timeout: 15000 }, async t => {
  const f = await app(t);
  await writeFile(join(f.root, 'settings.ts'), "export default 'initial';");
  await writeFile(join(f.root, 'cormi.config.ts'), `import {createServer} from 'node:http';import value from './settings';
export default {plugins:[{id:'http',plugin:{inject:['commands'],apply(ctx){
ctx.effect(()=>ctx.commands.register('dev',async()=>{
 const server=createServer((_req,res)=>res.end(value));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let closing;const close=()=>closing??=new Promise((r,j)=>server.close(e=>e?j(e):r()));ctx.effect(()=>close);
 return {kind:'server',handle:{url:'http://127.0.0.1:'+server.address().port,close}};
}));}}}]};`);
  const script = join(f.root, 'carrier.mjs');
  await writeFile(script, `import {runCormi} from 'cormijs/launcher';import {writeFileSync} from 'node:fs';
const controller=new AbortController();
const code=await runCormi({root:process.cwd(),command:'dev',signal:controller.signal,onEvent(event){
 console.log(JSON.stringify(event));
 if(event.type==='ready'&&event.generation===1)writeFileSync('settings.ts',"export default 'replacement';");
 if(event.type==='starting'&&event.generation===2)controller.abort();
}});console.log('CARRIER_RESULT:'+code);process.exitCode=code;`);
  const child = spawn(process.execPath, ['--unhandled-rejections=strict', script], { cwd: f.root, stdio: ['ignore','pipe','pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { output += String(chunk); });
  const done = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const deadline = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 10000);
  let code: number | null;
  try { code = await done; } finally { clearTimeout(deadline); }
  assert.equal(code, 0, output); assert.match(output, /"generation":2/); assert.match(output, /CARRIER_RESULT:0/);
  assert.doesNotMatch(output, /unhandled|WORKER_EXITED|WORKER_START_TIMEOUT/i);
  await cleanLauncher(f.root);
});
