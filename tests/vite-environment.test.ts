import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { publicEnvironment } from '../packages/plugin-vite/src/environment.js';
import { fixture, hasCode } from './helpers.js';

const bounds={timeout:20000};
test('public snapshots reject nonpublic entries and accessors without evaluating them',()=>{
 let called=false;const bad=Object.defineProperty({},'CORMI_PUBLIC_VALUE',{enumerable:true,get(){called=true;return 'bad'}});
 assert.throws(()=>publicEnvironment(bad),hasCode('ENV_PUBLIC_INVALID'));assert.equal(called,false);
 for(const data of [{PRIVATE:'secret'},{CORMI_PUBLIC_X:4},{CORMI_PUBLIC_:'bad'}])assert.throws(()=>publicEnvironment(data as never),hasCode('ENV_PUBLIC_INVALID'));
 const source={CORMI_PUBLIC_VALUE:'frozen'};const result=publicEnvironment(source);source.CORMI_PUBLIC_VALUE='changed';assert.equal(result.CORMI_PUBLIC_VALUE,'frozen');assert.ok(Object.isFrozen(result));
});
test('a direct Vite session never loads dotenv files and its explicit snapshot defeats later process mutation',bounds,async()=>{
 const f=await fixture(),h=new ProjectRuntime();h.mount('vite',vitePlugin);
 h.mount('ignored-mode',{inject:['vite'],apply(ctx){ctx.effect(()=>ctx.vite.add('ignored-mode',()=>({name:'ignored-mode',config:()=>({mode:'ignored-native-mode'})})))}});
 await writeFile(join(f.root,'.env.staging'),'CORMI_PUBLIC_OTHER=UNEXPECTED_FILE\nPRIVATE=NEVER_PUBLISH');
 await writeFile(join(f.root,'main.ts'),'console.log(import.meta.env.CORMI_PUBLIC_VALUE, import.meta.env.CORMI_PUBLIC_OTHER, import.meta.env.PRIVATE, import.meta.env.MODE);');
 const old=process.env.CORMI_PUBLIC_OTHER;process.env.CORMI_PUBLIC_OTHER='LATE_INHERITED';
 try{
  await h.ready();const result=await h.ctx.builder.build({...f.plan,mode:'staging',publicEnv:{CORMI_PUBLIC_VALUE:'EXPLICIT_SNAPSHOT'}});
  const text=(await Promise.all((await readdir(join(result.outDir,'assets'))).map(name=>readFile(join(result.outDir,'assets',name),'utf8')))).join('\n');
  assert.match(text,/EXPLICIT_SNAPSHOT/);assert.doesNotMatch(text,/UNEXPECTED_FILE|LATE_INHERITED|NEVER_PUBLISH|ignored-native-mode/);assert.match(text,/staging/);
 }finally{if(old===undefined)delete process.env.CORMI_PUBLIC_OTHER;else process.env.CORMI_PUBLIC_OTHER=old;await h.dispose();await f.clean()}
});
test('native config hooks cannot widen environment disclosure or override application mode',bounds,async()=>{

 for(const patch of [{envDir:'.'},{envPrefix:'PRIVATE_'},{define:{'import.meta.env.PRIVATE_VALUE':'"secret"'}},{define:{'process.env':'{}'}}]){
  const f=await fixture(),h=new ProjectRuntime();h.mount('vite',vitePlugin);
  h.mount('override',{inject:['vite'],apply(ctx){ctx.effect(()=>ctx.vite.add('override',()=>({name:'override',config:()=>patch})))}});
  try{await h.ready();await assert.rejects(h.ctx.builder.dev({...f.plan,mode:'test',publicEnv:{}}),hasCode('VITE_RESERVED_CONFIG'),JSON.stringify(patch));
    assert.deepEqual((await readdir(f.root)).filter(name=>name.startsWith('.cormi-vite-')),[]);
  }finally{await h.dispose();await f.clean()}
 }
});

test('environment-scoped native defines cannot bypass the public snapshot guard',bounds,async()=>{
 const f=await fixture(),h=new ProjectRuntime();h.mount('vite',vitePlugin);
 h.mount('scoped',{inject:['vite'],apply(ctx){ctx.effect(()=>ctx.vite.add('scoped',()=>({name:'scoped',config:()=>({environments:{client:{define:{'import.meta.env.PRIVATE_VALUE':'"SCOPE_SECRET"'}}}})})))}});
 try{await h.ready();await assert.rejects(h.ctx.builder.dev({...f.plan,publicEnv:{}}),hasCode('VITE_RESERVED_CONFIG'));}
 finally{await h.dispose();await f.clean()}
});
