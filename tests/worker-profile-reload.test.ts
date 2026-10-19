import test from 'node:test';
import assert from 'node:assert/strict';
import { app, cli, cleanLauncher } from './launcher-helpers.js';
import { httpText } from '../scripts/reliability/resources.js';
import { assertPortFree } from './helpers.js';

const profile=(value:string)=>`import {createServer} from 'node:http';export default {apply(ctx){ctx.provide('workerExecution',{async run(){
const server=createServer((_req,res)=>res.end(${JSON.stringify(value)}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
return {kind:'server',handle:{url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise((r,j)=>server.close(e=>e?j(e):r()))}};
}});}};`;
test('worker-profile source failure preserves the old serving generation and repairs through normal config reload', {timeout:15000},async t=>{
  const f=await app(t);await f.write('cormi.config.ts',`import worker from './worker-profile';export default {worker};`);await f.write('worker-profile.ts',profile('first'));
  const c=cli(t,f.root,'dev');const first=await c.waitFor(e=>e.type==='ready');assert.equal(await httpText(first.url),'first');
  const from=c.events.length;await f.write('worker-profile.ts',`export default {BROKEN`);
  const failure=await c.waitFor(e=>e.type==='error'&&e.code==='CONFIG_COMPILE_FAILED',from);assert.equal(failure.servingPrevious,true);assert.equal(await httpText(first.url),'first');
  await f.write('worker-profile.ts',profile('repaired'));const next=await c.waitFor(e=>e.type==='ready'&&e.generation===2,from);
  assert.notEqual(next.pid,first.pid);assert.equal(await httpText(next.url),'repaired');await assertPortFree(Number(new URL(first.url).port));
  assert.equal(await c.stop(),0,JSON.stringify(c.events));await assertPortFree(Number(new URL(next.url).port));await cleanLauncher(f.root);
});
