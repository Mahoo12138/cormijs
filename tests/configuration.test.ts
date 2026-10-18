import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectRuntime, snapshotConfig, configLayer, configLeaves, type CommandRequest } from '@cormijs/core';
import { ApplicationConfiguration, applicationConfigPlugin } from '@cormijs/plugin-web';
import { normalizeConfig } from '../packages/cormi/dist/config.js';
import { commandPlugin } from '../packages/cormi/dist/commands.js';
import { gate, hasCode, assertPortFree } from './helpers.js';
import { app, cli } from './launcher-helpers.js';
const request = (options: Record<string, unknown> = {}): CommandRequest => ({root:'/test',mode:'test',options,signal:new AbortController().signal});
const hook = (id: string) => ({id,owner:'test',ownerOrder:0});
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('nested preset and explicit user assignments preserve exact field history, including same-value writes', async () => {
  const input = normalizeConfig({presets:[{id:'outer',presets:[{id:'inner',defaults:{server:{host:'127.0.0.1',port:1},list:[1,2]}}],defaults:{server:{port:2}}}],app:{server:{port:2},list:[3]}},'/test');
  const service = new ApplicationConfiguration();
  const resolved = await service.resolve({...request(input.app),configuration:{command:'dev',layers:input.layers,plugins:input.pluginSources}},'dev');
  const port = resolved.report.fields.find(f=>f.path==='/server/port')!;
  assert.deepEqual(port.history.map(x=>x.id),['inner','outer','config.app']); assert.equal(port.value,2);
  assert.deepEqual(plain(resolved.value),{server:{host:'127.0.0.1',port:2},list:[3]});
  assert.equal(resolved.report.fields.find(f=>f.path==='/list')!.redacted,true);
  await service.close();
});
test('JSON pointers distinguish dotted keys and record subtree removal and array replacement',()=>{
  const before=snapshotConfig({'a.b':1,a:{b:2},list:[1,2]}),after=snapshotConfig({'a.b':3,a:false,list:[3],'~/':4});
  assert.deepEqual([...configLeaves(before).keys()],['/a/b','/a.b','/list']);
  const layer=configLayer(before,after,{kind:'derive',id:'change'});
  assert.ok(layer.changes.some(x=>x.path==='/a/b'&&x.operation==='delete'));
  assert.ok(layer.changes.some(x=>x.path==='/a'&&x.operation==='set'));
  assert.ok(layer.changes.some(x=>x.path==='/~0~1'));assert.equal(layer.changes.filter(x=>x.path.startsWith('/list')).length,1);
});
test('configuration snapshots refuse accessors, cycles, sparse arrays, excessive depth and explicit null app',()=>{
  let reads=0;const getter={get value(){reads++;return 'PRIVATE';}};
  assert.throws(()=>snapshotConfig(getter),hasCode('CONFIG_INVALID'));assert.equal(reads,0);
  const cycle:Record<string,unknown>={};cycle.self=cycle;
  for(const value of [cycle,{a:new Array(5)},{a:NaN},{a:()=>1},JSON.parse('{"__proto__":1}')])assert.throws(()=>snapshotConfig(value),hasCode('CONFIG_INVALID'));
  let deep:Record<string,unknown>={};for(let i=0;i<70;i++)deep={deep};assert.throws(()=>snapshotConfig(deep),hasCode('CONFIG_INVALID'));
  assert.throws(()=>normalizeConfig({app:null},'/test'),hasCode('CONFIG_INVALID'));
  const a={nested:{value:1}};const copy=snapshotConfig(a);a.nested.value=2;assert.equal((copy.nested as any).value,1);assert.ok(Object.isFrozen(copy.nested));
});
test('derivation order uses explicit edges, validates immutable return values and masks opaque values',async()=>{
  const service=new ApplicationConfiguration();
  service.derive.tap({...hook('last'),stage:-10,after:['first'],run:({value})=>({...value,base:'/last/'})});
  service.derive.tap({...hook('first'),run:({value})=>{assert.ok(Object.isFrozen(value));return {...value,base:'/first/'};}});
  const result=await service.resolve(request({base:'/',runtime:[{options:{token:'PRIVATE_RUNTIME'}}],password:'PRIVATE_PASSWORD'}),'dev');
  assert.equal(result.value.base,'/last/');assert.deepEqual(result.report.hooks.map(x=>x.id),['first','last']);
  assert.doesNotMatch(JSON.stringify(result.report),/PRIVATE_RUNTIME|PRIVATE_PASSWORD/);
  await service.close();
});
test('bad derivation return, forbidden bootstrap change and failure provenance reject before command execution',async()=>{
  for(const value of [undefined,[],{root:'/escape'},{plugins:[]}]){
    const s=new ApplicationConfiguration();s.derive.tap({...hook('bad'),run:()=>value as any});
    await assert.rejects(s.resolve(request(),'build'), e=>hasCode(Array.isArray(value)||value===undefined?'CONFIG_INVALID':'CONFIG_DERIVE_RESERVED')(e));await s.close();
  }
  const s=new ApplicationConfiguration(),cause=new Error('failure');s.derive.tap({...hook('broken'),run:()=>{throw cause;}});
  await assert.rejects(s.resolve(request(),'dev'),e=>hasCode('CONFIG_DERIVE_FAILED')(e)&&(e as any).cause===cause&&(e as any).details.hookId==='broken');await s.close();
});
test('async contributor replacement discards stale results; subsequent resolution uses the new registration',async()=>{
  const s=new ApplicationConfiguration(),entered=gate(),release=gate();
  const off=s.derive.tap({...hook('old'),run:async({value})=>{entered.resolve();await release.promise;return {...value,base:'/old/'};}});
  const old=s.resolve(request(),'dev'),rejected=assert.rejects(old,hasCode('CONFIG_DERIVE_CHANGED'));await entered.promise;
  off();s.derive.tap({...hook('new'),run:({value})=>({...value,base:'/new/'})});release.resolve();await rejected;
  assert.equal((await s.resolve(request(),'dev')).value.base,'/new/');await s.close();
});
test('configuration cancellation waits admitted work on close and cannot publish a late value',async()=>{
  const s=new ApplicationConfiguration(),entered=gate(),release=gate();let aborted=false;
  s.derive.tap({...hook('slow'),run:async({value,signal})=>{entered.resolve();await release.promise;aborted=signal.aborted;return value;}});
  const pending=s.resolve(request(),'dev');const rejected=assert.rejects(pending);await entered.promise;
  let closed=false;const close=s.close().then(()=>{closed=true;});await delay(10);assert.equal(closed,false);
  release.resolve();await rejected;await close;assert.equal(aborted,true);await assert.rejects(s.resolve(request(),'dev'));
});
test('concurrent resolution does not share mode, command, source values or report objects',async()=>{
  const s=new ApplicationConfiguration();s.derive.tap({...hook('per-command'),run:async({value,command})=>{await delay(command==='dev'?20:1);return {...value,base:'/'+command+'/'};}});
  const [a,b]=await Promise.all([s.resolve(request({secret:'A'}),'dev'),s.resolve(request({secret:'B'}),'build')]);
  assert.equal(a.value.base,'/dev/');assert.equal(b.value.base,'/build/');assert.equal(a.value.secret,'A');assert.equal(b.value.secret,'B');await s.close();
});
test('native configuration plugin withdrawal removes middleware and diagnostics without removing other commands',async()=>{
  const h=new ProjectRuntime();h.mount('commands',commandPlugin);const p=h.mount('configuration',applicationConfigPlugin);await h.ready();
  h.ctx.commands.register('echo',async r=>({kind:'result',data:r.options}));
  h.ctx.appConfig.derive.tap({...hook('test'),run:({value})=>({...value,base:'/derived/'})});
  const a=await h.ctx.commands.execute('echo',request());assert.equal((a as any).data.base,'/derived/');
  await p.dispose();assert.equal(h.ctx.commands.names().includes('config'),false);
  const b=await h.ctx.commands.execute('echo',request());assert.equal((b as any).data.base,undefined);await h.dispose();
});
test('command middleware snapshot prevents duplicate next and old unregister cannot remove new registrations',async()=>{
  const h=new ProjectRuntime();h.mount('commands',commandPlugin);await h.ready();let count=0;
  h.ctx.commands.register('echo',async()=>{count++;return {kind:'result',data:count};});
  const off=h.ctx.commands.use('once',async(_name,r,next)=>{await next(r);return next(r);});
  await assert.rejects(h.ctx.commands.execute('echo',request()),hasCode('COMMAND_NEXT_REPEATED'));assert.equal(count,1);off();
  h.ctx.commands.use('once',async(_name,r,next)=>next(r));off();await h.ctx.commands.execute('echo',request());assert.equal(count,2);await h.dispose();
});
test('a retained next callback cannot dispatch after its middleware has completed',async()=>{
  const h=new ProjectRuntime();h.mount('commands',commandPlugin);await h.ready();let count=0;
  let retained: import('@cormijs/core').CommandHandler | undefined;
  h.ctx.commands.register('echo',async()=>{count++;return {kind:'result',data:count};});
  h.ctx.commands.use('retain',async(_name,_r,next)=>{retained=next;return {kind:'result',data:'short-circuit'};});
  await h.ctx.commands.execute('echo',request());
  await assert.rejects(Promise.resolve().then(()=>retained!(request())),hasCode('COMMAND_NEXT_EXPIRED'));
  assert.equal(count,0);await h.dispose();
});
test('CLI config target matches config factory command and NODE_ENV without executing target handlers', {timeout:30000},async t=>{
  const f=await app(t);
  await f.write('.env','PRIVATE_CONFIGURATION_TEST=ENV_SECRET\n');
  await f.write('cormi.config.ts',`import {defineConfig} from 'cormijs';import {applicationConfigPlugin} from '@cormijs/plugin-web';
export default defineConfig(({command})=>({app:{base:command==='build'?'/release/':'/local/',server:{port:process.env.NODE_ENV==='production'?9100:9200},privateValue:process.env.PRIVATE_CONFIGURATION_TEST},plugins:[
{id:'cfg',plugin:applicationConfigPlugin},{id:'disabled',enabled:false,options:{token:'OPTIONS_SECRET'},plugin:{apply(){throw Error('disabled');}}},
{id:'target',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.register('build',async()=>{throw Error('TARGET_MUST_NOT_EXECUTE');}));}}}]}));`);
  for(const [target,base,port] of [['dev','/local/',9200],['build','/release/',9100]] as const){
    const c=cli(t,f.root,'config',['--for',target]);assert.equal(await c.finish(),0,JSON.stringify(c.events)+c.stderr);
    const data=c.events.find(e=>e.type==='result')!.data;assert.equal(data.command,target);
    assert.equal(data.fields.find((x:any)=>x.path==='/base').value,base);assert.equal(data.fields.find((x:any)=>x.path==='/server/port').value,port);
    assert.equal(data.plugins.find((x:any)=>x.id==='disabled').enabled,false);assert.doesNotMatch(JSON.stringify(c.events),/ENV_SECRET|OPTIONS_SECRET/);
    assert.equal(existsSync(join(f.root,'.cormi.lock')),false);assert.deepEqual(await readdir(join(f.root,'.cormi')),[]);
  }
  const invalid=cli(t,f.root,'build',['--for','dev']);assert.equal(await invalid.finish(),1);assert.ok(invalid.events.some(e=>e.code==='CONFIG_TARGET_INVALID'));
});
test('real dev and build consume the same derived configuration, and inspect remains an old snapshot', {timeout:45000},async t=>{
  const f=await app(t);
  await f.write('cormi.config.ts',`import {defineConfig} from 'cormijs';import reactVite from '@cormijs/preset-react-vite';
export default defineConfig({presets:[reactVite],app:{server:{port:0}},plugins:[{id:'derive',plugin:{inject:['appConfig'],apply(ctx){ctx.effect(()=>ctx.appConfig.derive.tap({id:'deployment',owner:'derive',ownerOrder:0,run:({value})=>({...value,base:'/derived/'})}));}}}]});`);
  await f.write('index.html','<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  const dev=cli(t,f.root,'dev',['--startup-timeout','30000']),ready=await dev.waitFor(e=>e.type==='ready',0,30000);
  assert.equal(new URL(ready.url).pathname,'/derived/');assert.equal((await fetch(ready.url)).status,200);assert.equal(await dev.stop(),0);await assertPortFree(Number(new URL(ready.url).port));
  const inspectBefore=await readFile(join(f.root,'.cormi/inspect.jsonc'),'utf8');
  const inspect=cli(t,f.root,'inspect');assert.equal(await inspect.finish(),0);assert.equal(await readFile(join(f.root,'.cormi/inspect.jsonc'),'utf8'),inspectBefore);
  const build=cli(t,f.root,'build',['--startup-timeout','30000']);assert.equal(await build.finish(30000),0,JSON.stringify(build.events)+build.stderr);
  assert.match(await readFile(join(f.root,'dist/index.html'),'utf8'),/\/derived\/assets\//);
});
