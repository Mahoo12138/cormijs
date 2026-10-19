import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, cli, cleanLauncher } from './launcher-helpers.js';
import { assertPortFree } from './helpers.js';
import { httpText, until } from '../scripts/reliability/resources.js';

const options = {timeout:15000};
const network = `import {createServer} from 'node:http';import {writeFileSync,appendFileSync} from 'node:fs';`;
const lateServer = `const server=createServer((_req,res)=>res.end('late'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
writeFileSync('port',String(server.address().port));return {kind:'server',handle:{url:'http://127.0.0.1:'+server.address().port,
async close(){appendFileSync('closed','1');await new Promise((r,j)=>server.close(e=>e?j(e):r()));server.closeAllConnections();}}};`;

test('cancelled execution joins a late acquired server and closes its handle exactly once without publishing ready',options,async t=>{
  const f=await app(t);await f.write('cormi.config.ts',network+`export default {worker:{apply(ctx){ctx.provide('workerExecution',{async run({request}){
    writeFileSync('entered','yes');await new Promise(r=>request.signal.addEventListener('abort',r,{once:true}));
    writeFileSync('cancelled','yes');${lateServer}
  }});}}};`);
  const c=cli(t,f.root,'probe');await until(()=>existsSync(join(f.root,'entered')),'executor admitted');
  assert.equal(await c.stop(),0,JSON.stringify(c.events)+c.stderr);
  assert.equal(c.events.filter(e=>e.type==='ready'||e.type==='result').length,0);
  assert.equal(await readFile(join(f.root,'closed'),'utf8'),'1');assert.equal(existsSync(join(f.root,'cancelled')),true);
  await assertPortFree(Number(await readFile(join(f.root,'port'),'utf8')));await cleanLauncher(f.root);
});

test('withdrawing the live execution Fiber closes its server and ends the worker as a failure',options,async t=>{
  const f=await app(t);await f.write('cormi.config.ts',network+`export default {worker:{apply(ctx){let fiber;const execution={apply(child){child.provide('workerExecution',{async run(){
    const server=createServer((req,res)=>{res.end('ok');if(req.url==='/withdraw')setImmediate(()=>{void fiber.dispose()});});await new Promise(r=>server.listen(0,'127.0.0.1',r));
    return {kind:'server',handle:{url:'http://127.0.0.1:'+server.address().port,async close(){appendFileSync('closed','1');await new Promise((r,j)=>server.close(e=>e?j(e):r()));server.closeAllConnections();}}};
  }});}};fiber=ctx.plugin(execution);}}};`);
  const c=cli(t,f.root,'probe');const ready=await c.waitFor(e=>e.type==='ready');
  assert.equal(await httpText(new URL('/withdraw',ready.url).href),'ok');assert.equal(await c.finish(),1,JSON.stringify(c.events));
  assert.ok(c.events.some(e=>e.code==='EXECUTION_WITHDRAWN'));assert.equal(await readFile(join(f.root,'closed'),'utf8'),'1');
  await assertPortFree(Number(new URL(ready.url).port));await cleanLauncher(f.root);
});

test('an invalid server result still relinquishes its acquired server rather than losing the cleanup handle',options,async t=>{
  const f=await app(t);await f.write('cormi.config.ts',network+`export default {worker:{apply(ctx){ctx.provide('workerExecution',{async run(){
    ${lateServer.replace("url:'http://127.0.0.1:'+server.address().port", "url:42")}
  }});}}};`);
  const c=cli(t,f.root,'probe');assert.equal(await c.finish(),1,JSON.stringify(c.events));
  assert.ok(c.events.some(e=>e.code==='COMMAND_RESULT_INVALID'));assert.equal(await readFile(join(f.root,'closed'),'utf8'),'1');
  await assertPortFree(Number(await readFile(join(f.root,'port'),'utf8')));await cleanLauncher(f.root);
});

test('late observation callbacks cannot publish after the execution method has returned',options,async t=>{
  const f=await app(t);await f.write('cormi.config.ts',`import {writeFileSync} from 'node:fs';export default {worker:{apply(ctx){let report;
    ctx.effect(()=>()=>{try{report({type:'execution-report',name:'late',data:{}})}catch(error){writeFileSync('rejected',error.code)}});
    ctx.provide('workerExecution',{async run(input){report=input.report;return {kind:'result',data:'ok'};}});
  }}};`);
  const c=cli(t,f.root,'probe');assert.equal(await c.finish(),0,c.stderr);assert.equal(c.events.filter(e=>e.type==='execution-report').length,0);
  assert.equal(await readFile(join(f.root,'rejected'),'utf8'),'EXECUTION_CLOSED');await cleanLauncher(f.root);
});

test('noncooperative execution is terminated by the existing worker deadline without a successful result',options,async t=>{
  const f=await app(t);await f.write('cormi.config.ts',`export default {worker:{apply(ctx){ctx.provide('workerExecution',{run:()=>new Promise(()=>{})});}}};`);
  const c=cli(t,f.root,'probe',['--startup-timeout','250','--shutdown-timeout','250']);assert.equal(await c.finish(),1,JSON.stringify(c.events));
  assert.ok(c.events.some(e=>e.code==='WORKER_START_TIMEOUT'));assert.equal(c.events.filter(e=>e.type==='result'||e.type==='ready').length,0);await cleanLauncher(f.root);
});

test('an execution report budget failure stays nonzero after preserving already accepted observations',options,async t=>{
  const f=await app(t);await f.write('cormi.config.ts',`export default {worker:{apply(ctx){ctx.provide('workerExecution',{async run({report}){
    for(let i=0;i<65;i++)report({type:'execution-report',name:'sample',data:{index:i}});return {kind:'result',data:'MUST_NOT_SUCCEED'};
  }});}}};`);
  const c=cli(t,f.root,'probe');assert.equal(await c.finish(),1);assert.equal(c.events.filter(e=>e.type==='execution-report').length,64);
  assert.ok(c.events.some(e=>e.code==='EXECUTION_REPORT_LIMIT'));assert.equal(c.events.filter(e=>e.type==='result').length,0);await cleanLauncher(f.root);
});
