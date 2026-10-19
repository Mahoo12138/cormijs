import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, cli, cleanLauncher } from './launcher-helpers.js';

const options = { timeout: 15000 };
const importProfile = `import {createWorkerProfile,commandExecutionPlugin,diagnosticExecutionPlugin} from 'cormijs/worker';`;
test('worker consumes a native execution provider instead of a reserved diagnose branch', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', `export default {worker:{name:'custom-profile',apply(ctx){
    ctx.provide('workerExecution',{async run({command,request}){return {kind:'result',data:{command,mode:request.mode,provider:'custom'}};}});
  }},plugins:[{id:'must-not-activate',plugin:{apply(){throw Error('APPLICATION_NOT_REQUESTED')}}}]};`);
  const c = cli(t, f.root, 'diagnose', ['--mode','staging']);
  assert.equal(await c.finish(), 0, JSON.stringify(c.events) + c.stderr);
  assert.deepEqual(c.events.find(e => e.type === 'result')?.data, {command:'diagnose',mode:'staging',provider:'custom'});
  assert.equal(c.events.filter(e => e.type === 'diagnosis').length, 0);
  await cleanLauncher(f.root);
});

test('an explicit incomplete worker profile never falls back to default execution or mounts the application', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', `import {writeFileSync} from 'node:fs';export default {worker:{apply(){}},plugins:[{id:'sentinel',plugin:{apply(){writeFileSync('executed','bad');}}}]};`);
  const c = cli(t, f.root, 'probe');
  assert.equal(await c.finish(), 1, c.stderr);
  assert.ok(c.events.some(e => e.code === 'SERVICE_MISSING'), JSON.stringify(c.events));
  assert.equal(existsSync(join(f.root, 'executed')), false);
  await cleanLauncher(f.root);
});

test('the same diagnostic executor can serve another command while bypassing business middleware', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', importProfile + `export default {worker:createWorkerProfile({execution:diagnosticExecutionPlugin}),plugins:[
    {id:'commands',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.use('must-not-run',async()=>{throw Error('MIDDLEWARE_RAN')}));}}},
    {id:'missing',plugin:{inject:['absent'],apply(){throw Error('NEVER')}}}
  ]};`);
  const c = cli(t, f.root, 'audit'); assert.equal(await c.finish(), 1, c.stderr);
  assert.equal(c.events.find(e => e.type === 'diagnosis')?.data.command, 'audit');
  assert.equal(c.events.find(e => e.type === 'diagnosis')?.data.readiness.code, 'SERVICE_MISSING');
  assert.equal(c.events.filter(e => e.type === 'result').length, 0);
  await cleanLauncher(f.root);
});

test('explicit command execution permits an application-owned diagnose command without diagnostic infrastructure', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', importProfile + `export default {worker:createWorkerProfile({execution:commandExecutionPlugin,diagnostics:false}),plugins:[
    {id:'custom-diagnose',plugin:{inject:['commands'],apply(ctx){if(ctx.get('diagnostics'))throw Error('UNEXPECTED_DIAGNOSTICS');
    ctx.effect(()=>ctx.commands.register('diagnose',async()=>({kind:'result',data:'business-diagnose'})));}}}
  ]};`);
  const c = cli(t, f.root, 'diagnose'); assert.equal(await c.finish(), 0, JSON.stringify(c.events));
  assert.equal(c.events.find(e => e.type === 'result')?.data, 'business-diagnose');
  assert.equal(c.events.filter(e => e.type === 'diagnosis').length, 0); await cleanLauncher(f.root);
});

test('repeated application initialization joins one attempt and returns one native service graph', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', importProfile + `let applied=0;const execution={apply(ctx){ctx.provide('workerExecution',{async run({application}){
    const first=application.initialize(),second=application.initialize();if(first!==second)throw Error('NOT_SAME_ATTEMPT');
    const state=await first;return {kind:'result',data:{ok:state.ok,applied,nodes:application.runtime.graph().nodes.filter(n=>n.pluginId==='feature').length}};
  }});}};export default {worker:createWorkerProfile({execution}),plugins:[{id:'feature',plugin:{apply(){applied++;}}}]};`);
  const c = cli(t, f.root, 'probe'); assert.equal(await c.finish(), 0, c.stderr);
  assert.deepEqual(c.events.find(e => e.type === 'result')?.data, {ok:true,applied:1,nodes:1}); await cleanLauncher(f.root);
});

test('unawaited requested activation is joined before execution can finish', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', `import {writeFileSync} from 'node:fs';` + importProfile + `
    const execution={apply(ctx){ctx.provide('workerExecution',{async run({application}){void application.initialize();return {kind:'result',data:'done'};}});}};
    export default {worker:createWorkerProfile({execution}),plugins:[{id:'slow',plugin:{async apply(){await new Promise(r=>setTimeout(r,50));writeFileSync('initialized','yes');}}}]};`);
  const c = cli(t, f.root, 'probe'); assert.equal(await c.finish(), 0, JSON.stringify(c.events));
  assert.equal(existsSync(join(f.root,'initialized')),true);await cleanLauncher(f.root);
});

test('duplicate execution providers fail before application activation without fallback', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', `export default {worker:{apply(ctx){ctx.plugin({apply(c){c.provide('workerExecution',{run:async()=>({kind:'result',data:1})});}});ctx.plugin({apply(c){c.provide('workerExecution',{run:async()=>({kind:'result',data:2})});}});}},plugins:[]};`);
  const c = cli(t, f.root, 'probe'); assert.equal(await c.finish(), 1);
  assert.equal(c.events.filter(e=>e.type==='result').length,0);assert.ok(c.events.some(e=>e.code==='PLUGIN_FAILED'));await cleanLauncher(f.root);
});

test('custom observation reports are copied and cannot forge control events or override wire fields', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', `export default {worker:{apply(ctx){ctx.provide('workerExecution',{async run({report}){
    const notice={type:'execution-report',name:'example:check',data:{value:'original'}};report(notice);notice.data.value='mutated';
    const codes=[];for(const event of [{type:'ready',data:{}},{type:'execution-report',name:'x',data:{},version:2},{type:'execution-report',name:'x',data:null}]){
      try{report(event);throw Error('ACCEPTED_BAD_REPORT')}catch(error){codes.push(error.code)}
    }return {kind:'result',data:codes};}});}}};`);
  const c = cli(t, f.root, 'probe'); assert.equal(await c.finish(),0,JSON.stringify(c.events));
  assert.deepEqual(c.events.find(e=>e.type==='execution-report')?.data,{value:'original'});
  assert.equal(c.events.filter(e=>e.type==='ready').length,0);
  assert.deepEqual(c.events.find(e=>e.type==='result')?.data,Array(3).fill('EXECUTION_REPORT_INVALID'));await cleanLauncher(f.root);
});

test('worker profile cleanup failure suppresses an otherwise successful result', options, async t => {
  const f=await app(t);await f.write('cormi.config.ts',`export default {worker:{apply(ctx){ctx.effect(()=>()=>{throw Error('EXPECTED_WORKER_PROFILE_CLOSE')});ctx.provide('workerExecution',{run:async()=>({kind:'result',data:'NO_SUCCESS'})});}}};`);
  const c=cli(t,f.root,'probe');assert.equal(await c.finish(),1);assert.equal(c.events.filter(e=>e.type==='result').length,0);assert.ok(c.events.some(e=>e.code==='CLEANUP_INCOMPLETE'));await cleanLauncher(f.root);
});
