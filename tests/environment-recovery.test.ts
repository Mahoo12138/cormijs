import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, cli, cleanLauncher } from './launcher-helpers.js';
import { assertPortFree } from './helpers.js';

const bounds={timeout:30000};
const config=(initialization='',cleanup='')=>`import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';import {existsSync} from 'node:fs';import {setTimeout as sleep} from 'node:timers/promises';
export default ({env,mode,command})=>({plugins:[{id:'env-http',plugin:{inject:['commands'],async apply(ctx){
${initialization}
ctx.effect(()=>()=>{${cleanup}});
ctx.effect(()=>ctx.commands.register('dev',async request=>{
const data={value:env.CORMI_PUBLIC_ENV_TEST,only:env.CORMI_ENV_ONLY??null,node:process.env.NODE_ENV,mode,command,pid:process.pid,frozen:Object.isFrozen(env)};
const server=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
return {kind:'server',handle:{url:'http://127.0.0.1:'+server.address().port+'/',close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}};
}));}}}]});`;
async function marker(file:string){const end=Date.now()+10000;while(!existsSync(file)){assert.ok(Date.now()<end,'marker deadline');await delay(10)}}

test('selected environment file creation atomic replacement and deletion reload without retaining removed keys',bounds,async t=>{
 const f=await app(t);await f.write('cormi.config.ts',config());await f.write('.env','CORMI_PUBLIC_ENV_TEST=base');
 const c=cli(t,f.root,'dev',['--mode','staging']);const first=await c.waitFor(e=>e.type==='ready');
 assert.equal((await (await fetch(first.url)).json()).value,'base');
 let start=c.events.length;await f.write('.env.staging.local','CORMI_PUBLIC_ENV_TEST=selected\nCORMI_ENV_ONLY=temporary');
 const second=await c.waitFor(e=>e.type==='ready',start);const selected=await(await fetch(second.url)).json();assert.equal(selected.value,'selected');assert.equal(selected.only,'temporary');
 start=c.events.length;await f.write('env-replacement.txt','CORMI_PUBLIC_ENV_TEST=replaced');await rename(join(f.root,'env-replacement.txt'),join(f.root,'.env.staging.local'));
 const third=await c.waitFor(e=>e.type==='ready',start);assert.equal((await(await fetch(third.url)).json()).value,'replaced');
 start=c.events.length;await rm(join(f.root,'.env.staging.local'));
 const fourth=await c.waitFor(e=>e.type==='ready',start);const current=await(await fetch(fourth.url)).json();assert.equal(current.value,'base');assert.equal(current.only,null);assert.equal(current.frozen,true);
 const count=c.events.filter(e=>e.type==='starting').length;await f.write('.env.unselected','BROKEN="ignored');await delay(650);
 assert.equal(c.events.filter(e=>e.type==='starting').length,count);assert.equal(c.events.filter(e=>e.type==='error').length,0);
 assert.equal(await c.stop(),0);await assertPortFree(Number(new URL(fourth.url).port));await cleanLauncher(f.root);
});

test('a malformed selected file preserves the old server without a restart storm and repairs automatically',bounds,async t=>{
 const f=await app(t);await f.write('cormi.config.ts',config());await f.write('.env.staging','CORMI_PUBLIC_ENV_TEST=good');
 const c=cli(t,f.root,'dev',['--mode','staging']);const first=await c.waitFor(e=>e.type==='ready');
 const before=await(await fetch(first.url)).json();const start=c.events.length;
 await f.write('.env.staging','CORMI_PUBLIC_ENV_TEST="PRIVATE_BROKEN_VALUE');
 const failure=await c.waitFor(e=>e.type==='error',start);assert.equal(failure.servingPrevious,true);assert.match(JSON.stringify(failure),/ENV_SYNTAX_INVALID/);
 assert.doesNotMatch(JSON.stringify(c.events)+c.stderr,/PRIVATE_BROKEN_VALUE/);await delay(650);
 assert.equal(c.events.filter(e=>e.type==='starting').length,1);assert.equal(c.events.slice(start).filter(e=>e.type==='error').length,1);
 assert.deepEqual(await(await fetch(first.url)).json(),before);
 await f.write('.env.staging','CORMI_PUBLIC_ENV_TEST=repaired');const ready=await c.waitFor(e=>e.type==='ready',start);
 assert.equal((await(await fetch(ready.url)).json()).value,'repaired');assert.notEqual(ready.pid,first.pid);
 assert.equal(await c.stop(),0);await cleanLauncher(f.root);
});

test('an environment edit during old plugin cleanup rejects the obsolete candidate before initialization',bounds,async t=>{
 const f=await app(t);
 await f.write('cormi.config.ts',config("await writeFile('started-'+env.CORMI_PUBLIC_ENV_TEST+'.txt','started');","if(env.CORMI_PUBLIC_ENV_TEST==='initial') return (async()=>{await writeFile('cleanup.txt','entered');while(!existsSync('release.txt'))await sleep(10)})();"));
 await f.write('.env.staging','CORMI_PUBLIC_ENV_TEST=initial');const c=cli(t,f.root,'dev',['--mode','staging']);await c.waitFor(e=>e.type==='ready');
 await f.write('.env.staging','CORMI_PUBLIC_ENV_TEST=obsolete');await marker(join(f.root,'cleanup.txt'));
 await f.write('.env.staging','CORMI_PUBLIC_ENV_TEST=newest');await f.write('release.txt','go');
 const ready=await c.waitFor(e=>e.type==='ready'&&e.generation>1);assert.equal((await(await fetch(ready.url)).json()).value,'newest');
 assert.equal(existsSync(join(f.root,'started-obsolete.txt')),false);assert.ok(c.events.some(e=>e.type==='superseded'&&e.phase==='before-start'));
 assert.equal(await c.stop(),0);await cleanLauncher(f.root);
});

test('an environment edit during initialization cannot publish a stale ready event',bounds,async t=>{
 const f=await app(t);await f.write('cormi.config.ts',config("if(env.CORMI_PUBLIC_ENV_TEST==='slow'){await writeFile('initializing.txt','yes');while(!existsSync('release.txt'))await sleep(10)}"));
 await f.write('.env.staging','CORMI_PUBLIC_ENV_TEST=slow');const c=cli(t,f.root,'dev',['--mode','staging']);
 await marker(join(f.root,'initializing.txt'));await f.write('.env.staging','CORMI_PUBLIC_ENV_TEST=current');await f.write('release.txt','go');
 const ready=await c.waitFor(e=>e.type==='ready');assert.equal((await(await fetch(ready.url)).json()).value,'current');
 assert.equal(c.events.filter(e=>e.type==='ready').length,1);assert.ok(c.events.some(e=>e.type==='superseded'&&e.phase==='before-ready'));
 assert.equal(await c.stop(),0);await cleanLauncher(f.root);
});
