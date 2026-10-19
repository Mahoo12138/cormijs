import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectRuntime, type Plugin, type Fiber } from '@cormijs/core';
import { defaultBootstrap, defaultLaunchPolicyPlugin, pollingReloadPlugin, type LaunchEnvironment, type LaunchPolicy } from 'cormijs/bootstrap';
import { app, cleanLauncher } from './launcher-helpers.js';
import { assertPortFree, gate } from './helpers.js';
import { carrier, createBootstrap, fileEnvironment, filesystemReload, readEnvironmentFiles, servePolicy, serveConfig, until, httpText } from './bootstrap-helpers.js';

const bounds={timeout:15000};
test('default bootstrap is a native child-plugin composition with explicit policies and reversible registrations',bounds,async()=>{
  const host=new ProjectRuntime();host.mount('profile',defaultBootstrap);
  try {
    await host.ready();
    assert.deepEqual(host.ctx.launchPolicy.resolve({command:'dev'}),{configurationCommand:'dev',mode:'development',nodeEnv:'development',watch:true});
    assert.deepEqual(host.ctx.launchPolicy.resolve({command:'build',mode:'staging'}),{configurationCommand:'build',mode:'staging',nodeEnv:'production',watch:false});
    assert.deepEqual(host.ctx.launchPolicy.resolve({command:'diagnose',configurationCommand:'build'}),{configurationCommand:'build',mode:'production',nodeEnv:'production',watch:false});
    assert.throws(()=>host.ctx.launchPolicy.resolve({command:'build',configurationCommand:'dev'}),{code:'CONFIG_TARGET_INVALID'});
    assert.throws(()=>host.ctx.launchPolicy.resolve({command:'diagnose',watch:true}),{code:'DIAGNOSIS_WATCH_UNSUPPORTED'});
    assert.equal(host.ctx.registry.size>=1,true);
    await host.unmount('profile');assert.equal(host.ctx.get('launchPolicy'),undefined);assert.equal(host.ctx.get('launchEnvironment'),undefined);assert.equal(host.ctx.get('launchReload'),undefined);
  }finally{await host.dispose();}
});

test('custom filesystem wake-up and environment survive cold invalid config missing imports and bad-file repair',bounds,async t=>{
  const f=await app(t),reload=filesystemReload();await f.write('cormi.config.ts','export default { invalid syntax');
  await f.write('.env','UNUSED_DEFAULT="broken');await f.write('company.vars','CORMI_PUBLIC_BOOT=first');
  const c=carrier({root:f.root,command:'serve',bootstrap:createBootstrap({policy:servePolicy,environment:fileEnvironment(join(f.root,'company.vars')),reload:reload.plugin}),pollIntervalMs:50});
  let finalPort=0;
  try {
    await c.event(e=>e.type==='error'&&e.servingPrevious===false);
    let from=c.events.length;await f.write('cormi.config.ts',serveConfig);
    await c.event(e=>e.type==='error',from);
    await f.write('settings.ts',"export default 'working';");
    const first=await c.event(e=>e.type==='ready',from),old=JSON.parse(await httpText(String(first.url)));
    assert.equal(old.value,'first');assert.equal(old.command,'serve');assert.equal(old.node,'development');assert.equal(old.mode,'staging');
    from=c.events.length;await f.write('company.vars','CORMI_PUBLIC_BOOT="PRIVATE_BROKEN_MARKER');
    await c.event(e=>e.type==='error'&&e.servingPrevious===true,from);
    assert.deepEqual(JSON.parse(await httpText(String(first.url))),old);
    const starts=c.events.filter(e=>e.type==='starting').length;
    await delay(180);assert.equal(c.events.filter(e=>e.type==='starting').length,starts);
    from=c.events.length;await f.write('company.vars','CORMI_PUBLIC_BOOT=repaired');
    const latest=await c.event(e=>e.type==='ready',from);finalPort=Number(new URL(String(latest.url)).port);
    assert.equal(JSON.parse(await httpText(String(latest.url))).value,'repaired');assert.notEqual(latest.pid,first.pid);
    assert.ok(reload.state.events>0);assert.ok(reload.state.seen.has(join(f.root,'company.vars')));
    assert.equal(reload.state.seen.has(join(f.root,'.env')),false);
    assert.doesNotMatch(JSON.stringify(c.events),/PRIVATE_BROKEN_MARKER/);
  }finally{assert.equal(await c.stop(),0);}
  assert.equal(reload.state.watchers,0);assert.ok(reload.state.closed>0);await assertPortFree(finalPort);await cleanLauncher(f.root);
});

test('withdrawing a required native bootstrap provider stops the serving worker without silent fallback',bounds,async t=>{
  const f=await app(t);await f.write('settings.ts',"export default 'v1';");await f.write('cormi.config.ts',serveConfig);await f.write('company.vars','CORMI_PUBLIC_BOOT=value');
  let provider:Fiber|undefined;
  const bootstrap:Plugin.Object<void>={apply(ctx){ctx.plugin(servePolicy);ctx.plugin(fileEnvironment(join(f.root,'company.vars')));provider=ctx.plugin(pollingReloadPlugin);}};
  const c=carrier({root:f.root,command:'serve',bootstrap,pollIntervalMs:30});let port=0;
  try {
    const ready=await c.event(e=>e.type==='ready');port=Number(new URL(String(ready.url)).port);
    await provider!.dispose();await assert.rejects(c.done,{code:'BOOTSTRAP_WITHDRAWN'});
    assert.equal(c.events.filter(e=>e.type==='starting').length,1);
    assert.throws(()=>process.kill(Number(ready.pid),0),(error:unknown)=>(error as NodeJS.ErrnoException).code==='ESRCH');
  }finally{await c.stop().catch(()=>{});}
  await assertPortFree(port);await cleanLauncher(f.root);
});

test('cancellation during asynchronous bootstrap activation waits for its native cleanup before releasing the lease',bounds,async t=>{
  const f=await app(t),entered=gate(),release=gate();let closed=0;
  const bootstrap:Plugin.Object<void>={async apply(ctx){ctx.plugin(defaultBootstrap);ctx.effect(()=>()=>{closed++;});entered.resolve();await release.promise;}};
  const c=carrier({root:f.root,command:'probe',bootstrap,shutdownTimeoutMs:1500});
  try {
    await entered.promise;c.abort.abort();await delay(50);assert.equal(c.settled,false);assert.equal(existsSync(join(f.root,'.cormi.lock')),true);
    release.resolve();assert.equal(await c.done,0);assert.equal(closed,1);assert.equal(c.events.filter(e=>e.type==='starting').length,0);
  }finally{release.resolve();await c.stop().catch(()=>{});}
  assert.equal(existsSync(join(f.root,'.cormi.lock')),false);
});

test('cancellation during a late environment read joins the read and never executes application configuration',bounds,async t=>{
  const f=await app(t),entered=gate(),release=gate();let closed=0;
  await f.write('cormi.config.ts',"throw new Error('APPLICATION_MUST_NOT_EXECUTE');export default {};");
  const environment:Plugin.Object<void>={apply(ctx){ctx.effect(()=>()=>{closed++;});ctx.provide('launchEnvironment',{
    files:()=>[],async load({root,plan}){entered.resolve();await release.promise;return readEnvironmentFiles(root,plan.mode,[]);},
  } satisfies LaunchEnvironment);}};
  const c=carrier({root:f.root,command:'probe',bootstrap:createBootstrap({environment}),shutdownTimeoutMs:1500});
  try {await entered.promise;c.abort.abort();await delay(50);assert.equal(c.settled,false);release.resolve();assert.equal(await c.done,0);assert.equal(closed,1);assert.equal(c.events.filter(e=>e.type==='starting').length,0);}
  finally{release.resolve();await c.stop().catch(()=>{});}
  await cleanLauncher(f.root);
});

test('unconfirmed bootstrap cleanup keeps the lease and rejects a second launcher even after the task later settles',bounds,async t=>{
  const f=await app(t),entered=gate(),release=gate(),drained=gate();await f.write('cormi.config.ts','export default {};');
  const environment:Plugin.Object<void>={apply(ctx){ctx.effect(()=>()=>{drained.resolve();});ctx.provide('launchEnvironment',{
    files:()=>[],async load({root,plan}){entered.resolve();await release.promise;return readEnvironmentFiles(root,plan.mode,[]);},
  } satisfies LaunchEnvironment);}};
  const c=carrier({root:f.root,command:'probe',bootstrap:createBootstrap({environment}),startupTimeoutMs:200,shutdownTimeoutMs:100});
  try {
    await entered.promise;c.abort.abort();await assert.rejects(c.done,{code:'BOOTSTRAP_CLEANUP_INCOMPLETE'});
    assert.equal(existsSync(join(f.root,'.cormi.lock')),true);
    const other=carrier({root:f.root,command:'probe'});await assert.rejects(other.done,{code:'PROJECT_BUSY'});
  }finally{release.resolve();await drained.promise;await c.stop().catch(()=>{});}
  assert.equal(existsSync(join(f.root,'.cormi.lock')),true);
  // This entire directory belongs to app(t); its final fixture cleanup is not a product lock-recovery API.
});

test('a bootstrap plugin attempting a new registration after cancellation fails cleanup instead of reporting success',bounds,async t=>{
  const f=await app(t),entered=gate(),release=gate();let closed=0;
  const bootstrap:Plugin.Object<void>={async apply(ctx){ctx.effect(()=>()=>{closed++;});entered.resolve();await release.promise;ctx.plugin(defaultBootstrap);}};
  const c=carrier({root:f.root,command:'probe',bootstrap,shutdownTimeoutMs:1000});
  try {
    await entered.promise;c.abort.abort();await delay(30);release.resolve();
    await assert.rejects(c.done,{code:'BOOTSTRAP_CLEANUP_INCOMPLETE'});
    assert.equal(closed,1);assert.equal(existsSync(join(f.root,'.cormi.lock')),true);
    assert.equal(c.events.filter(e=>e.type==='starting').length,0);
  }finally{release.resolve();await c.stop().catch(()=>{});}
});

test('one-shot results are not replayed even when a custom policy requests watching',bounds,async t=>{
  const f=await app(t);await f.write('cormi.config.ts',`import {appendFileSync,writeFileSync} from 'node:fs';export default {plugins:[{id:'once',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.register('once',async()=>{appendFileSync('once.log','x');writeFileSync('cormi.config.ts','export default {};');return {kind:'result',data:'done'};}));}}}]};`);
  const policy:Plugin.Object<void>={apply(ctx){ctx.provide('launchPolicy',{resolve:request=>({configurationCommand:request.command,mode:'development',nodeEnv:'development',watch:true})} satisfies LaunchPolicy);}};
  const c=carrier({root:f.root,command:'once',bootstrap:createBootstrap({policy})});
  assert.equal(await c.done,0);assert.equal(c.events.filter(e=>e.type==='starting').length,1);assert.equal(c.events.filter(e=>e.type==='result').length,1);await cleanLauncher(f.root);
});
