import test from 'node:test';
import assert from 'node:assert/strict';
import { app, cli, cleanLauncher } from './launcher-helpers.js';

const options = { timeout: 30000 };
test('large one-shot results are delivered completely before the worker disconnects', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', `export default {plugins:[{id:'echo',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.register('echo',async()=>({kind:'result',data:'x'.repeat(512*1024)})))}}}]};`);
  const c = cli(t, f.root, 'echo'); assert.equal(await c.finish(), 0, JSON.stringify(c.events.map(e=>({type:e.type,code:e.code}))) + c.stderr);
  const data = c.events.find(e => e.type === 'result')?.data;
  assert.equal(data, 'x'.repeat(512 * 1024)); await cleanLauncher(f.root);
});

test('a populated diagnostic report arrives with all records before successful shutdown', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', `export default {plugins:Array.from({length:24},(_,i)=>({id:'plugin-'+i,plugin:{name:'plugin-'+i,apply(ctx){ctx.get('diagnostics').add('records',()=>Array.from({length:50},(_,j)=>({kind:'extension',id:'public-'+i+'-'+j+'-'+ 'a'.repeat(80),ownerUid:ctx.fiber.uid})))}}}))};`);
  const c = cli(t, f.root, 'diagnose'); assert.equal(await c.finish(), 0, JSON.stringify(c.events.map(e=>({type:e.type,code:e.code}))) + c.stderr);
  const data = c.events.find(e => e.type === 'result')?.data;
  assert.equal(data.healthy, true); assert.equal(data.contributions.filter((s:{id:string})=>s.id==='records').length,24);
  assert.equal(data.contributions.filter((s:{id:string})=>s.id==='records').reduce((n:number,s:{records:unknown[]})=>n+s.records.length,0),1200);
  await cleanLauncher(f.root);
});

test('a large failed diagnosis is delivered before the nonzero exit and never becomes a result', options, async t => {
  const f = await app(t);
  await f.write('cormi.config.ts', `export default {plugins:[{id:'metadata',plugin:{apply(ctx){ctx.get('diagnostics').add('records',()=>Array.from({length:512},(_,i)=>({kind:'extension',id:'item-'+i+'-'+ 'a'.repeat(100)})))}}},{id:'missing',plugin:{inject:['absent'],apply(){throw Error('must not run')}}}]};`);
  const c = cli(t, f.root, 'diagnose'); assert.equal(await c.finish(), 1);
  const report = c.events.find(e => e.type === 'diagnosis')?.data;
  assert.equal(report?.healthy, false); assert.equal(report.readiness.code, 'SERVICE_MISSING');
  assert.equal(report.contributions.find((s:{id:string})=>s.id==='records').records.length,512);
  assert.equal(c.events.filter(e=>e.type==='result').length,0); await cleanLauncher(f.root);
});
