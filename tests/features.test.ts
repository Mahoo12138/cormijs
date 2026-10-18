import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectRuntime } from '@cormijs/core';
import { moduleRef, routeMeta, validateRoutes } from '@cormijs/routes';
import { clientModule, defineReactFeature, generateApplication, reactPlugin, runtimeContributions } from '@cormijs/plugin-react';
import { readInspection, type ApplicationRequest } from '@cormijs/plugin-web';
import { hasCode } from './helpers.js';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-feature 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'feature/client'), { recursive: true });
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'feature/plugin.ts'), 'export {};');
  await writeFile(join(root, 'feature/client/Page.tsx'), 'throw new Error("DO_NOT_EXECUTE_PAGE");export default ()=>null;');
  await writeFile(join(root, 'feature/client/runtime.ts'), 'throw new Error("DO_NOT_EXECUTE_RUNTIME");export default {};');
  host.mount('react', reactPlugin); await host.ready();
  const from = pathToFileURL(join(root, 'feature/plugin.ts')).href;
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, serverOnlyFiles: [join(root, 'feature/plugin.ts')], signal: new AbortController().signal };
  return { root, host, from, request, async close() { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } } };
}
const descriptor = (from: string) => ({ id: 'feature:status', routes: [{id:'status',path:'status',module:clientModule('./client/Page.tsx',from),meta:{title:'Status'}}],
  runtime: [{id:'status:runtime',module:clientModule('./client/runtime.ts',from),options:{label:'PUBLIC'}}] });

test('anchored modules validate their file URL and reject schemes, ambiguity and directory escape', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(moduleRef(clientModule('./client/Page.tsx', f.from)), {specifier:'./client/Page.tsx',exportName:'default',from:f.from});
    for (const from of ['https://example.test/plugin.js', 'relative.ts', f.from + '?x=1', f.from + '#x', pathToFileURL(f.root + '/').href]) {
      assert.throws(() => clientModule('./Page.tsx', from), hasCode('ROUTE_MODULE_INVALID'));
    }
    assert.throws(() => clientModule('package/page', f.from), hasCode('ROUTE_MODULE_INVALID'));
    const route = { id:'test',path:'test',source:{},module:clientModule('./../secret.ts',f.from) };
    await assert.rejects(generateApplication(f.root,[route],[],'/','root'),hasCode('CLIENT_MODULE_INVALID'));
  } finally { await f.close(); }
});
test('relative browser modules resolve from the declaring plugin, never execute on Node, and redact anchor URLs', async () => {
  const f = await fixture();
  try {
    f.host.mount('feature', defineReactFeature(descriptor(f.from))); await f.host.ready();
    const session = await f.host.ctx.application.prepare(f.request);
    const code = await readFile(join(f.root,'.cormi/app.tsx'),'utf8');
    assert.match(code,/\.\.\/feature\/client\/Page.tsx/); assert.match(code,/handle:\{cormi:\{meta:/);
    assert.doesNotMatch(code,/DO_NOT_EXECUTE|file:\/\/|plugin.ts/);
    const inspection = JSON.stringify(readInspection(f.root));
    assert.match(inspection,/project:feature\/plugin.ts/); assert.doesNotMatch(inspection,new RegExp(f.root));
    await session.close();
  } finally { await f.close(); }
});
test('declarative feature snapshots public options and unload withdraws all its contributions', async () => {
  const f = await fixture();
  try {
    const input = descriptor(f.from), feature = defineReactFeature(input);
    input.routes[0]!.meta.title = 'MUTATED'; input.runtime[0]!.options.label = 'MUTATED';
    const fiber = f.host.mount('feature', feature); await f.host.ready();
    const session = await f.host.ctx.application.prepare(f.request); await session.close();
    assert.doesNotMatch(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),/MUTATED/);
    await fiber.dispose();
    assert.equal(f.host.ctx.react.routes.snapshot().length,0); assert.equal(f.host.ctx.react.runtime.snapshot().length,0);
    const next = await f.host.ctx.application.prepare(f.request); await next.close();
    assert.doesNotMatch(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),/feature\/client/);
  } finally { await f.close(); }
});
test('route metadata is a deep immutable JSON snapshot with bounded depth and no accessor execution', () => {
  const input = {title:'A',menu:{visible:true},tags:['one']}; const copied = routeMeta(input); input.menu.visible=false;
  assert.equal((copied.menu as {visible:boolean}).visible,true); assert.ok(Object.isFrozen(copied.menu));
  let called=false; const accessor=Object.defineProperty({},'value',{enumerable:true,get(){called=true;return 'bad'}});
  for (const data of [accessor, new Date(), {x:Infinity}, {x:()=>null}, {x:undefined}, JSON.parse('{"__proto__":{}}'), {x:'x'.repeat(70000)}]) assert.throws(()=>routeMeta(data),hasCode('ROUTE_META_INVALID'));
  assert.equal(called,false); const cycle:Record<string,unknown>={};cycle.x=cycle;assert.throws(()=>routeMeta(cycle),hasCode('ROUTE_META_INVALID'));
  assert.throws(()=>routeMeta({items:Array(20).fill('x'.repeat(5000))}),hasCode('ROUTE_META_INVALID'));
  assert.throws(()=>routeMeta({['x'.repeat(70000)]:true}),hasCode('ROUTE_META_INVALID'));
  let deep:unknown={};for(let i=0;i<60;i++)deep={x:deep};assert.throws(()=>routeMeta(deep),hasCode('ROUTE_META_INVALID'));
  assert.throws(()=>runtimeContributions([{id:'x',module:{specifier:'pkg',exportName:'default'},options:accessor}]),hasCode('RUNTIME_OPTIONS_INVALID'));
});
test('feature routes can attach to a separately declared parent and conflicts still fail before publication', async () => {
  const f=await fixture();
  try {
    const item=descriptor(f.from);f.host.mount('feature',defineReactFeature({...item,routes:[{...item.routes[0]!,parentId:'host-layout'}]}));await f.host.ready();
    const session=await f.host.ctx.application.prepare({...f.request,options:{routes:[{id:'host-layout',path:'',source:{}}]}});await session.close();
    assert.match(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),/host-layout/);
    const before=await readFile(join(f.root,'.cormi/app.tsx'),'utf8');
    await assert.rejects(f.host.ctx.application.prepare({...f.request,options:{routes:[{id:'host-layout',path:'',source:{}},{id:'other',path:'status',source:{}}]}}),hasCode('ROUTE_CONFLICT'));
    assert.equal(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),before);
  } finally {await f.close();}
});
test('anchored private modules, symlinks and known Node toolchain imports are rejected', async () => {
  const f=await fixture();
  try {
    const route=(name:string)=>({id:'page',path:'page',module:clientModule(name,f.from),source:{}});
    for(const name of ['data.server.ts','.env.ts','cormi.config.ts']) {
      await writeFile(join(f.root,'feature',name),'export default {};');
      await assert.rejects(generateApplication(f.root,[route('./'+name)],[],'/','root'),hasCode('CLIENT_MODULE_INVALID'));
    }
    await symlink(join(f.root,'feature/client/Page.tsx'),join(f.root,'feature/client/linked.tsx'));
    await assert.rejects(generateApplication(f.root,[route('./client/linked.tsx')],[],'/','root'),hasCode('CLIENT_MODULE_INVALID'));
    await assert.rejects(generateApplication(f.root,[route('./plugin.ts')],[],'/','root',f.request.serverOnlyFiles),hasCode('CLIENT_MODULE_INVALID'));
    await assert.rejects(generateApplication(f.root,[{id:'a',path:'a',source:{},module:{specifier:'cordis',exportName:'Context'}}],[],'/','root'),hasCode('CLIENT_SERVER_IMPORT'));
  } finally {await f.close();}
});
test('missing anchored module repairs in the same development session', {timeout:10000}, async () => {
  const f=await fixture();
  try {
    f.host.mount('feature',defineReactFeature(descriptor(f.from)));await f.host.ready();
    const file=join(f.root,'feature/client/Page.tsx');await unlink(file);
    const session=await f.host.ctx.application.prepare({...f.request,command:'dev'});
    assert.equal(session.development!.current().status,'error');assert.equal(session.development!.current().hasOutput,false);
    await writeFile(file,'export default ()=>null;');
    const end=Date.now()+5000;while(session.development!.current().status!=='ready'&&Date.now()<end)await delay(25);
    assert.equal(session.development!.current().status,'ready');await session.close();
  } finally {await f.close();}
});
test('malformed feature identity and direct-generator metadata are rejected before evaluating JSON hooks', async () => {
  for (const input of [{}, {id:undefined}, {id:42}, {id:''}, {id:'bad id'}, {id:'ok',stage:NaN}]) assert.throws(()=>defineReactFeature(input as never),hasCode('FEATURE_INVALID'));
  let executed=false;const meta={toJSON(){executed=true;return {title:'bad'}}};
  await assert.rejects(generateApplication('/unused',[{id:'x',path:'x',source:{},meta:meta as never}],[],'/','root'),hasCode('ROUTE_META_INVALID'));
  assert.equal(executed,false);
});
test('sparse arrays, extra array fields and non-JSON public runtime options are rejected', () => {
  const sparse=new Array(3), extra=Object.assign([1],{extra:'bad'});
  for(const value of [{data:sparse},{data:extra},{data:Symbol('private')},{data:1n}]) assert.throws(()=>routeMeta(value),hasCode('ROUTE_META_INVALID'));
});
test('an invalid feature cannot leave a partial route graph committed or erase previous generation', async () => {
  const f=await fixture();
  try {
    f.host.mount('valid',defineReactFeature(descriptor(f.from)));await f.host.ready();
    const first=await f.host.ctx.application.prepare(f.request);await first.close();
    const before=await readFile(join(f.root,'.cormi/app.tsx'),'utf8');
    const broken=f.host.mount('broken',defineReactFeature({id:'broken',routes:[{id:'broken',path:'broken',parentId:'nonexistent'}]}));await f.host.ready();
    await assert.rejects(f.host.ctx.application.prepare(f.request),hasCode('ROUTE_PARENT_MISSING'));
    assert.equal(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),before);
    await broken.dispose();const repaired=await f.host.ctx.application.prepare(f.request);await repaired.close();
    assert.equal(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),before);
  } finally {await f.close();}
});
test('metadata flows through final validation and feature stage ordering is deterministic', async () => {
  const routes=validateRoutes([{id:'root',path:'',source:{},meta:{title:'Home'}},{id:'child',parentId:'root',path:'child',source:{},meta:{title:'Child'}}]);
  assert.equal(routes[1]!.meta!.title,'Child');
  const host=new ProjectRuntime();host.mount('react',reactPlugin);
  host.mount('late',defineReactFeature({id:'late',stage:10,runtime:[{id:'late-runtime',module:{specifier:'late-client',exportName:'default'}}]}));
  host.mount('early',defineReactFeature({id:'early',stage:-10,runtime:[{id:'early-runtime',module:{specifier:'early-client',exportName:'default'}}]}));
  try {await host.ready();assert.deepEqual((await host.ctx.react.runtime.collect(undefined)).map(x=>x.id),['early-runtime','late-runtime']);}
  finally {await host.dispose();}
});
