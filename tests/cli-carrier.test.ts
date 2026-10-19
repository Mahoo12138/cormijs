import test from 'node:test';
import assert from 'node:assert/strict';
import { runCormiCli } from 'cormijs/cli';
import { createBootstrap, readEnvironmentFiles } from 'cormijs/bootstrap';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, cleanLauncher } from './launcher-helpers.js';

const counts=()=>['SIGINT','SIGTERM','message','disconnect'].map(name=>process.listenerCount(name));
test('reusable CLI help does not load the project or bootstrap and removes its control listeners',async()=>{
  let loaded=0,output='';const before=counts(),exit=process.exitCode;
  assert.equal(await runCormiCli(['--help','--root','/nonexistent/cormi-help'],{bootstrap:{apply(){loaded++;}},stdout:text=>{output+=text;}}),0);
  assert.equal(loaded,0);assert.match(output,/cormi <command>/);assert.deepEqual(counts(),before);assert.equal(process.exitCode,exit);
});
test('reusable CLI rejects invalid arguments without evaluating trusted application code',async t=>{
  const f=await app(t);await f.write('cormi.config.ts',`throw Error('MUST_NOT_EVALUATE');`);let stderr='';const before=counts();
  assert.equal(await runCormiCli(['probe','--root',f.root,'--unknown-option'],{stderr:text=>{stderr+=text;}}),1);
  assert.match(stderr,/unknown|Unknown/i);assert.equal(existsSync(join(f.root,'.cormi.lock')),false);assert.deepEqual(counts(),before);
});
test('reusable CLI forwards explicit flags through native bootstrap and worker profiles without mutating argv', {timeout:15000},async t=>{
  const f=await app(t);await f.write('company.vars','CORMI_PUBLIC_VALUE=carrier');
  await f.write('cormi.config.ts',`export default ({mode,env})=>({worker:{apply(ctx){ctx.provide('workerExecution',{run:async({command})=>({kind:'result',data:{command,mode,value:env.CORMI_PUBLIC_VALUE}})});}}});`);
  const bootstrap=createBootstrap({environment:{apply(ctx){ctx.provide('launchEnvironment',{files:root=>[join(root,'company.vars')],load:({root,plan,files})=>readEnvironmentFiles(root,plan.mode,files)});}}});
  const args=Object.freeze(['probe','--root',f.root,'--mode','staging','--no-watch','--json']);let output='';const before=counts();
  assert.equal(await runCormiCli(args,{bootstrap,stdout:text=>{output+=text;}}),0);
  const events=output.trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(events.find(e=>e.type==='result')?.data,{command:'probe',mode:'staging',value:'carrier'});
  assert.deepEqual(args,['probe','--root',f.root,'--mode','staging','--no-watch','--json']);assert.deepEqual(counts(),before);await cleanLauncher(f.root);
});
