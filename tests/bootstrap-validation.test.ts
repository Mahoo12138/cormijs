import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { symlink, link } from 'node:fs/promises';
import type { Plugin } from '@cormijs/core';
import { runCormi } from 'cormijs/launcher';
import { createBootstrap, readEnvironmentFiles, defaultLaunchPolicyPlugin, type LaunchPolicy } from 'cormijs/bootstrap';
import { environmentPaths, environmentSnapshot, launchPlan } from '../packages/cormi/dist/bootstrap-validation.js';
import { app } from './launcher-helpers.js';
import { existsSync } from 'node:fs';

const good={configurationCommand:'probe',mode:'staging',nodeEnv:'production',watch:false} as const;
test('launch plans are immutable complete records and cannot override explicit carrier choices',()=>{
  assert.ok(Object.isFrozen(launchPlan(good,{command:'probe'})));
  for(const value of [{...good,watch:undefined},{...good,nodeEnv:'test'},{...good,mode:'../../home'},{...good,extra:true}])assert.throws(()=>launchPlan(value,{command:'probe'}));
  for(const request of [{command:'probe',mode:'development'},{command:'probe',watch:true},{command:'config',configurationCommand:'build'}])assert.throws(()=>launchPlan(good,request),{code:'BOOTSTRAP_PLAN_INVALID'});
});

test('environment snapshot validation rejects private payload misuse without reading accessors or retaining mutable input',async t=>{
  const f=await app(t);await f.write('company.vars','CORMI_PUBLIC_BOOT=public\nPRIVATE_VALUE=synthetic');
  const paths=[join(f.root,'company.vars')],snapshot=await readEnvironmentFiles(f.root,'staging',paths);
  const source=JSON.parse(JSON.stringify(snapshot));const accepted=environmentSnapshot(source,'staging',paths);
  source.values.PRIVATE_VALUE='changed';assert.equal(accepted.values.PRIVATE_VALUE,'synthetic');assert.ok(Object.isFrozen(accepted.values));
  let called=false;
  assert.throws(()=>environmentSnapshot({...snapshot,get values(){called=true;return {}; }},'staging',paths));assert.equal(called,false);
  for(const mutation of [{mode:'other'},{paths:[]},{files:[]},{fingerprint:'bad'},{values:{NODE_OPTIONS:'SECRET_SENTINEL'},origins:{NODE_OPTIONS:['custom']}},{origins:{}},{values:{PRIVATE_VALUE:123}}]){
    assert.throws(()=>environmentSnapshot({...snapshot,...mutation},'staging',paths),error=>{assert.doesNotMatch(String(error),/SECRET_SENTINEL/);return true;});
  }
});

test('explicit environment readers preserve ownership checks and do not expand selection to ordinary dotenv files',async t=>{
  const f=await app(t);await f.write('.env','BROKEN="ignored');await f.write('company.vars','CORMI_PUBLIC_BOOT=custom');
  const file=join(f.root,'company.vars');
  assert.equal((await readEnvironmentFiles(f.root,'staging',[file])).values.CORMI_PUBLIC_BOOT,'custom');
  assert.throws(()=>environmentPaths(f.root,['../outside']),{code:'ENV_PATHS_INVALID'});
  assert.throws(()=>environmentPaths(f.root,[file,file]),{code:'ENV_PATHS_INVALID'});
  assert.throws(()=>environmentPaths(f.root,new Array(17).fill(file)),{code:'ENV_PATHS_INVALID'});
  await symlink(file,join(f.root,'symbolic.vars'));await assert.rejects(readEnvironmentFiles(f.root,'staging',[join(f.root,'symbolic.vars')]),{code:'ENV_FILE_INVALID'});
  await link(file,join(f.root,'hard.vars'));await assert.rejects(readEnvironmentFiles(f.root,'staging',[file]),{code:'ENV_FILE_INVALID'});
});

test('duplicate providers and malformed policy fail before worker execution and release a clean bootstrap lease', {timeout:15000},async t=>{
  const f=await app(t);await f.write('cormi.config.ts',"throw new Error('MUST_NOT_EXECUTE');");
  const bad:Plugin.Object<void>={apply(ctx){ctx.provide('launchPolicy',{resolve:()=>({...good,watch:'false'})} as unknown as LaunchPolicy);}};
  await assert.rejects(runCormi({root:f.root,command:'probe',bootstrap:createBootstrap({policy:bad})}),{code:'BOOTSTRAP_PLAN_INVALID'});
  assert.equal(existsSync(join(f.root,'.cormi.lock')),false);
  const duplicate:Plugin.Object<void>={apply(ctx){ctx.plugin(createBootstrap());ctx.plugin({apply(child){child.provide('launchPolicy',{resolve:()=>good});}});}};
  await assert.rejects(runCormi({root:f.root,command:'probe',bootstrap:duplicate}));
  assert.equal(existsSync(join(f.root,'.cormi.lock')),false);
});
