import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectRuntime } from '@cormijs/core';
import { validateRoutes } from '@cormijs/routes';
import { generateApplication, reactPlugin, defineReactFeature } from '@cormijs/plugin-react';
import { fixture, hasCode } from './helpers.js';

const boundary = { specifier: './src/Boundary.tsx', exportName: 'Boundary' };
const route = { id: 'shell', path: '', errorBoundary: boundary, source: {} };
async function setup(t: import('node:test').TestContext) {
  const f = await fixture(), root = await realpath(f.root), host = new ProjectRuntime();
  t.after(async () => { try { await host.dispose(); } finally { await f.clean(); } });
  await mkdir(join(root,'src'),{recursive:true});
  await writeFile(join(root,'src/author.ts'),'export {};');
  await writeFile(join(root,'index.html'),'<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  host.mount('react',reactPlugin); await host.ready();
  return {root,host,request:{root,command:'prepare' as const,mode:'test',options:{routes:[route]},signal:new AbortController().signal,serverOnlyFiles:[]}};
}
test('route error boundary references are validated and copied without confusing them with pages or JSX', () => {
  const input = {...route,errorBoundary:{...boundary}}, output=validateRoutes([input]);
  input.errorBoundary.specifier='./changed.tsx';
  assert.equal(output[0]!.errorBoundary!.specifier,boundary.specifier);
  assert.ok(Object.isFrozen(output[0]!.errorBoundary));
  for(const value of [null,{},'Boundary',()=>null,{specifier:'https://invalid/secret',exportName:'default'}]) {
    assert.throws(()=>validateRoutes([{...route,errorBoundary:value}]),hasCode('ROUTE_MODULE_INVALID'));
  }
});
test('boundaries are imported before lazy pages and generation never evaluates either module',async t=>{
  const {root}=await setup(t);
  await writeFile(join(root,'src/Boundary.tsx'),'throw Error("BOUNDARY_MUST_NOT_EXECUTE_IN_NODE"); export function Boundary(){return null}');
  await writeFile(join(root,'src/Page.tsx'),'throw Error("PAGE_MUST_NOT_EXECUTE_IN_NODE"); export default ()=>null');
  const routes=[{...route,module:{specifier:'./src/Page.tsx',exportName:'default'}},{id:'child',parentId:'shell',path:'child',errorBoundary:boundary,source:{}}];
  const code=await generateApplication(root,routes,[],'/admin/','root');
  assert.match(code,/import \* as boundary0 from "\.\.\/src\/Boundary.tsx"/);
  assert.match(code,/ErrorBoundary:boundary0\["Boundary"\]/);
  assert.equal((code.match(/import \* as boundary\d+ from/g)??[]).length,1);
  assert.match(code,/lazy:async\(\)=>\(\{Component:/); assert.doesNotMatch(code,/MUST_NOT_EXECUTE_IN_NODE/);
});
test('boundary references obey the same private, server and author directory restrictions',async t=>{
  const {root}=await setup(t);await writeFile(join(root,'src/Boundary.tsx'),'export const Boundary=()=>null');
  await assert.rejects(generateApplication(root,[route],[],'/','root',[join(root,'src/Boundary.tsx')]),hasCode('CLIENT_MODULE_INVALID'));
  await assert.rejects(generateApplication(root,[{...route,errorBoundary:{specifier:'@cormijs/core',exportName:'Context'}}],[],'/','root'),hasCode('CLIENT_SERVER_IMPORT'));
  const anchored={...route,errorBoundary:{specifier:'./Boundary.tsx',exportName:'Boundary',from:pathToFileURL(join(root,'src/author.ts')).href}};
  const code=await generateApplication(root,[anchored],[],'/','root'); assert.match(code,/Boundary.tsx/);
});
test('missing boundary recovers during the same compilation session and inspection sanitizes author URLs',async t=>{
  const f=await setup(t);const authored={...route,errorBoundary:{specifier:'./Boundary.tsx',exportName:'Boundary',from:pathToFileURL(join(f.root,'src/author.ts')).href}};
  const prepared=await f.host.ctx.application.prepare({...f.request,command:'dev',options:{routes:[authored]}});
  assert.equal(prepared.development!.current().status,'error');
  await writeFile(join(f.root,'src/Boundary.tsx'),'export const Boundary=()=>null');
  const deadline=Date.now()+7000;
  while(prepared.development!.current().status!=='ready'&&Date.now()<deadline) await delay(25);
  assert.equal(prepared.development!.current().status,'ready');
  const inspection=await readFile(join(f.root,'.cormi/inspect.jsonc'),'utf8');
  assert.match(inspection,/errorBoundary/); assert.doesNotMatch(inspection,/file:\/\//);assert.ok(!inspection.includes(f.root));await prepared.close();
});
test('feature boundary contribution is a snapshot and withdrawing it removes its route and boundary',async t=>{
  const f=await setup(t);await writeFile(join(f.root,'src/Boundary.tsx'),'export const Boundary=()=>null');
  const input={...route,errorBoundary:{...boundary}};
  const plugin=defineReactFeature({id:'feature:boundary',routes:[input]});input.errorBoundary.specifier='./bad.tsx';
  const mounted=f.host.mount('feature',plugin);await f.host.ready();
  const a=await f.host.ctx.application.prepare({...f.request,options:{routes:[]}});assert.match(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),/Boundary.tsx/);await a.close();
  await mounted.dispose();const b=await f.host.ctx.application.prepare({...f.request,options:{routes:[]}});assert.doesNotMatch(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),/Boundary.tsx/);await b.close();
});
test('StrictMode is explicit, included in generated mounting, and invalid values fail before writing',async t=>{
  const f=await setup(t);
  for(const strict of ['true',1,null]) await assert.rejects(f.host.ctx.application.prepare({...f.request,options:{routes:[],strict}}),hasCode('CONFIG_INVALID'));
  const a=await f.host.ctx.application.prepare({...f.request,options:{routes:[],strict:true}});
  assert.match(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),/strict:true/);await a.close();
  const b=await f.host.ctx.application.prepare({...f.request,options:{routes:[]}});
  assert.match(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),/strict:false/);await b.close();
});
