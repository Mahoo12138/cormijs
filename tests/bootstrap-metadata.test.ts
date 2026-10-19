import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { app } from './launcher-helpers.js';

test('untyped asynchronous metadata rejection is observed while the bootstrap cleans up', {timeout:12000},async t=>{
  const f=await app(t);await f.write('cormi.config.ts','export default {};');
  await f.write('metadata.mjs',`import assert from 'node:assert/strict';import {existsSync} from 'node:fs';import {runCormi} from 'cormijs/launcher';import {createBootstrap} from 'cormijs/bootstrap';
let closed=0;const failure=new Error('ASYNC_METADATA_FAILURE');
const policy={apply(ctx){ctx.effect(()=>()=>{closed++;});ctx.provide('launchPolicy',{async resolve(){throw failure;}});}};
await assert.rejects(runCormi({root:process.cwd(),command:'probe',bootstrap:createBootstrap({policy})}),e=>e===failure);
assert.equal(closed,1);assert.equal(existsSync('.cormi.lock'),false);console.log('METADATA_SETTLED');`);
  const child=spawn(process.execPath,['--unhandled-rejections=strict',join(f.root,'metadata.mjs')],{cwd:f.root,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>output+=String(data));child.stderr.on('data',data=>output+=String(data));
  const done=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  const timeout=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},8000);
  let code:number|null;try{code=await done;}finally{clearTimeout(timeout);}
  assert.equal(code,0,output);assert.match(output,/METADATA_SETTLED/);
});
