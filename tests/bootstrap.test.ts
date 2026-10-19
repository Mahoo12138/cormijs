import test from 'node:test';
import assert from 'node:assert/strict';
import { runCormi, type LauncherEvent } from 'cormijs/launcher';
import type { Plugin } from '@cormijs/core';
import { app, cleanLauncher } from './launcher-helpers.js';
import { readEnvironment } from '../packages/cormi/dist/environment.js';
import { fingerprint } from '../packages/cormi/dist/inputs.js';

const echo = `export default ({command,mode,env})=>({plugins:[{id:'probe',plugin:{inject:['commands'],apply(ctx){
ctx.effect(()=>ctx.commands.register('probe',async()=>({kind:'result',data:{command,mode,node:env.NODE_ENV,value:env.CORMI_PUBLIC_BOOT??null}})))
}}}]});`;

test('launcher consumes an explicitly composed native bootstrap before evaluating application config', {timeout:15000}, async t => {
  const f = await app(t); await f.write('cormi.config.ts', echo);
  let opened = 0, closed = 0;
  const bootstrap: Plugin.Object<void> = {name:'test:bootstrap',apply(ctx){
    opened++; ctx.effect(()=>()=>{closed++;});
    ctx.provide('launchPolicy',{resolve:()=>({configurationCommand:'probe',mode:'staging',nodeEnv:'development',watch:false})});
    ctx.provide('launchEnvironment',{files:()=>[],load:async()=>({...await readEnvironment(f.root,'staging'),paths:[],fingerprint:await fingerprint([]),files:[],values:{CORMI_PUBLIC_BOOT:'selected'},origins:{CORMI_PUBLIC_BOOT:['test-provider']}})});
    ctx.provide('launchReload',{wait:async()=>{throw new Error('one-shot must not wait for reload');}});
  }};
  const events: LauncherEvent[] = [];
  const options = {root:f.root,command:'probe',bootstrap,onEvent:(event:LauncherEvent)=>events.push(event)};
  assert.equal(await runCormi(options),0);
  assert.equal(opened,1); assert.equal(closed,1);
  assert.deepEqual(events.find(event=>event.type==='result')?.data,{command:'probe',mode:'staging',node:'development',value:'selected'});
  await cleanLauncher(f.root);
});

test('missing bootstrap provider fails before executing even a valid application', {timeout:15000}, async t => {
  const f = await app(t); await f.write('cormi.config.ts',echo);
  const bootstrap: Plugin.Object<void> = {apply() {}};
  const events: LauncherEvent[]=[];
  const options={root:f.root,command:'probe',bootstrap,onEvent:(event:LauncherEvent)=>events.push(event)};
  await assert.rejects(runCormi(options),error=>(error as {code?:string}).code==='SERVICE_MISSING');
  assert.equal(events.filter(event=>event.type==='starting').length,0);
});
