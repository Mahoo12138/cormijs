import test from 'node:test';
import assert from 'node:assert/strict';
import { app, cli, cleanLauncher } from './launcher-helpers.js';

const bounds = { timeout: 20000 };

const probe = `export default {plugins:[{id:'probe',plugin:{inject:['commands'],apply(ctx){
ctx.effect(()=>ctx.commands.register('probe',async()=>({kind:'result',data:{value:process.env.CORMI_PUBLIC_ENV_TEST,only:process.env.CORMI_ENV_ONLY,node:process.env.NODE_ENV}})));
}}}]};`;

test('mode-specific environment files are loaded before Node plugin initialization', bounds, async t => {
  const f = await app(t); await f.write('cormi.config.ts', probe);
  await f.write('.env', 'CORMI_PUBLIC_ENV_TEST=base\n');
  await f.write('.env.local', 'CORMI_PUBLIC_ENV_TEST=local\n');
  await f.write('.env.staging', 'CORMI_PUBLIC_ENV_TEST=staging\nCORMI_ENV_ONLY=selected\n');
  await f.write('.env.staging.local', 'CORMI_PUBLIC_ENV_TEST=staging-local\nNODE_ENV=development\n');
  const c = cli(t, f.root, 'probe', ['--mode','staging']); assert.equal(await c.finish(),0,JSON.stringify(c.events));
  assert.deepEqual(c.events.find(e=>e.type==='result')?.data,{value:'staging-local',only:'selected',node:'production'});
  assert.equal(process.env.CORMI_ENV_ONLY,undefined); await cleanLauncher(f.root);
});

test('malformed mode files fail before any config or plugin code executes and redact values', bounds, async t => {
  const f=await app(t); await f.write('cormi.config.ts', "throw Error('CONFIG_WAS_EXECUTED');export default {};");
  await f.write('.env.staging.local', 'PRIVATE_TEST="PRIVATE_SENTINEL_UNFINISHED');
  const c=cli(t,f.root,'probe',['--mode','staging']);assert.equal(await c.finish(),1);
  const output=JSON.stringify(c.events)+c.stderr;
  assert.match(output,/ENV_SYNTAX_INVALID/);assert.doesNotMatch(output,/PRIVATE_SENTINEL_UNFINISHED|CONFIG_WAS_EXECUTED/);
  await cleanLauncher(f.root);
});

test('config target owns NODE_ENV while mode chooses files and reports names and origins without values',bounds,async t=>{
  const f=await app(t);
  await f.write('cormi.config.ts',`import {applicationConfigPlugin} from '@cormijs/plugin-web';export default ({env,command,mode})=>({plugins:[{id:'config',plugin:applicationConfigPlugin}],app:{base:'/'+mode+'/',custom:env.PRIVATE_VALUE}});`);
  await f.write('.env','PRIVATE_VALUE=BASE_PRIVATE\nCORMI_PUBLIC_ENV_TEST=BASE_PUBLIC');
  await f.write('.env.staging.local','PRIVATE_VALUE=SELECTED_PRIVATE\nCORMI_PUBLIC_ENV_TEST=SELECTED_PUBLIC\nNODE_ENV=ignore');
  for(const target of ['dev','build']){
    const c=cli(t,f.root,'config',['--for',target,'--mode','staging']);assert.equal(await c.finish(),0,JSON.stringify(c.events)+c.stderr);
    const report=c.events.find(e=>e.type==='result')?.data;assert.equal(report.environment.nodeEnv,target==='dev'?'development':'production');
    assert.equal(report.environment.mode,'staging');assert.equal(report.environment.files.length,4);
    const variable=report.environment.variables.find((v:{name:string})=>v.name==='PRIVATE_VALUE');
    assert.equal(variable.public,false);assert.deepEqual(variable.history,['.env','.env.staging.local']);
    assert.doesNotMatch(JSON.stringify(report),/BASE_PRIVATE|BASE_PUBLIC|SELECTED_PRIVATE|SELECTED_PUBLIC|fingerprint/);
  }
  await cleanLauncher(f.root);
});

test('invalid mode is rejected before config evaluation or project locking',bounds,async t=>{
  const f=await app(t);await f.write('cormi.config.ts',"throw Error('CONFIG_WAS_EXECUTED');export default {};");
  for(const mode of ['../escape','local','staging.local']){
    const c=cli(t,f.root,'probe',['--mode',mode]);assert.equal(await c.finish(),1);
    assert.equal(c.events.find(e=>e.type==='error')?.code,'MODE_INVALID');assert.equal(c.events.some(e=>e.type==='starting'),false);
  }
  await cleanLauncher(f.root);
});
