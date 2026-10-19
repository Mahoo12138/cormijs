import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Plugin } from '@cormijs/core';
import type { LaunchEnvironment } from 'cormijs/bootstrap';
import { app, cleanLauncher } from './launcher-helpers.js';
import { gate } from './helpers.js';
import { carrier, createBootstrap, readEnvironmentFiles, servePolicy, serveConfig, until, httpText } from './bootstrap-helpers.js';

test('environment changed during async preflight retries the latest bytes without requiring another edit', {timeout:12000}, async t=>{
  const f=await app(t), entered=gate(),release=gate();let loads=0;
  await f.write('settings.ts',"export default 'v1';");await f.write('cormi.config.ts',serveConfig);await f.write('company.vars','CORMI_PUBLIC_BOOT=old');
  const environment:Plugin.Object<void>={apply(ctx){ctx.provide('launchEnvironment',{
    files:()=>[join(f.root,'company.vars')],async load({root,plan,files}){
      const snapshot=await readEnvironmentFiles(root,plan.mode,files);
      if(++loads===1){entered.resolve();await release.promise;}return snapshot;
    },
  } satisfies LaunchEnvironment);}};
  const c=carrier({root:f.root,command:'serve',bootstrap:createBootstrap({policy:servePolicy,environment}),pollIntervalMs:30});
  try {
    await entered.promise;await f.write('company.vars','CORMI_PUBLIC_BOOT=latest');release.resolve();
    const ready=await c.event(e=>e.type==='ready',0,1500);
    assert.equal(JSON.parse(await httpText(String(ready.url))).value,'latest');assert.ok(loads>=2);
    assert.equal(c.events.filter(e=>e.type==='starting').length,1);
  }finally{release.resolve();await c.stop();}
  await cleanLauncher(f.root);
});

test('a preparation deadline terminates admission and cancels its outstanding provider rather than starting another read', {timeout:12000}, async t=>{
  const f=await app(t);await f.write('cormi.config.ts',serveConfig);let calls=0,cancelled=0;
  const environment:Plugin.Object<void>={apply(ctx){ctx.provide('launchEnvironment',{
    files:()=>[],async load({signal}){calls++;await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{cancelled++;resolve();},{once:true}));throw new Error('cancelled-read');},
  } satisfies LaunchEnvironment);}};
  const c=carrier({root:f.root,command:'serve',bootstrap:createBootstrap({policy:servePolicy,environment}),startupTimeoutMs:150,shutdownTimeoutMs:600,pollIntervalMs:30});
  try {
    await until(()=>c.settled,'preparation timeout is terminal',1200);
    await assert.rejects(c.done,error=>(error as {code?:string}).code==='CONFIG_PREPARE_TIMEOUT');
    assert.equal(calls,1);assert.equal(cancelled,1);assert.equal(c.events.filter(e=>e.type==='starting').length,0);
  }finally{await c.stop().catch(()=>{});}
  await cleanLauncher(f.root);
});
