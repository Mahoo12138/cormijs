import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Plugin } from '@cormijs/core';
import { app, cleanLauncher } from './launcher-helpers.js';
import { assertPortFree } from './helpers.js';
import { carrier, createBootstrap, fileEnvironment, servePolicy, serveConfig } from './bootstrap-helpers.js';

test('a reload provider failure closes its live worker and cannot report stopped with success', {timeout:12000},async t=>{
  const f=await app(t);await f.write('settings.ts',"export default 'v1';");await f.write('cormi.config.ts',serveConfig);await f.write('company.vars','CORMI_PUBLIC_BOOT=value');
  const failure=new Error('EXPECTED_RELOAD_PROVIDER_FAILURE');let closed=0;
  const reload:Plugin.Object<void>={apply(ctx){ctx.effect(()=>()=>{closed++;});ctx.provide('launchReload',{async wait(){throw failure;}});}};
  const c=carrier({root:f.root,command:'serve',bootstrap:createBootstrap({policy:servePolicy,environment:fileEnvironment(join(f.root,'company.vars')),reload})});
  try {
    await assert.rejects(c.done,error=>error===failure);
    const ready=c.events.find(e=>e.type==='ready');assert.ok(ready);await assertPortFree(Number(new URL(String(ready.url)).port));
    assert.equal(closed,1);assert.equal(c.events.find(e=>e.type==='stopped')?.code,1);
  }finally{await c.stop().catch(()=>{});}
  await cleanLauncher(f.root);
});
