import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectRuntime, type Context } from '@cormijs/core';
import { executionSession } from '../packages/cormi/dist/execution-session.js';
import { normalizeConfig } from '../packages/cormi/dist/config.js';
import { app, cli, cleanLauncher } from './launcher-helpers.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { until } from '../scripts/reliability/resources.js';
import { existsSync } from 'node:fs';

// Deterministic ownership test: mutate the provider's object only after it was accepted.
test('execution captures the exact accepted server metadata and cleanup method',async()=>{
  let closed=0,replaced=0;const handle={url:'http://127.0.0.1:1/',async close(){closed++;}};
  const config=normalizeConfig({worker:{apply(ctx:Context){ctx.provide('workerExecution',{run:async()=>({kind:'server',handle})});}}},'/project');
  const host=new ProjectRuntime();const session=executionSession(host,config,'probe',{root:'/project',mode:'test',options:{},signal:new AbortController().signal},()=>{},()=>{});
  try {
    const result=await session.run();assert.equal(result.kind,'server');
    handle.url='http://127.0.0.1:2/';handle.close=async()=>{replaced++;};
    assert.equal(result.kind==='server'&&result.handle.url,'http://127.0.0.1:1/');
    await session.close();await session.close();assert.equal(closed,1);assert.equal(replaced,0);
  }finally{await session.close();await host.dispose();}
});

test('reentrant worker stop during synchronous abort dispatch produces one terminal wire message', {timeout:15000},async t=>{
  const f=await app(t);await f.write('cormi.config.ts',`import {writeFileSync,appendFileSync} from 'node:fs';
const send=process.send.bind(process);process.send=(message,...rest)=>{if(message.type==='stopped')appendFileSync('terminal','1');return send(message,...rest)};
export default {worker:{apply(ctx){ctx.provide('workerExecution',{async run({request}){
 writeFileSync('entered','yes');await new Promise(resolve=>request.signal.addEventListener('abort',()=>{process.emit('message',{version:1,type:'stop'});resolve();},{once:true}));
 return {kind:'result',data:'late'};
}});}}};`);
  const c=cli(t,f.root,'probe');await until(()=>existsSync(join(f.root,'entered')),'admitted execution');
  assert.equal(await c.stop(),0,JSON.stringify(c.events)+c.stderr);
  assert.equal(await readFile(join(f.root,'terminal'),'utf8'),'1');
  assert.equal(c.events.filter(e=>e.type==='result').length,0);await cleanLauncher(f.root);
});
