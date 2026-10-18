import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { app, cli } from '../launcher-helpers.js';
import { assertPortFree } from '../helpers.js';

// No Browser skill/runtime is listed. Run isolated Playwright against the project's actual generated entry.
// Flow: nested page -> render/import/transport failure -> nearest boundary or parent -> explicit recovery.
async function browser(t: TestContext) {
  const executablePath=process.env.CORMI_BROWSER_EXECUTABLE??'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.ok(existsSync(executablePath)); const instance=await chromium.launch({executablePath,headless:true});
  t.after(()=>instance.close());t.diagnostic(`Browser: ${instance.version()}`);return instance;
}
const ref=(file:string,exportName='default')=>({specifier:'./src/'+file+'.tsx',exportName});
async function project(t:TestContext) {
  const f=await app(t);await mkdir(join(f.root,'src'),{recursive:true});
  await f.write('index.html','<!doctype html><html><head><title>cormi boundaries</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>');
  const routes=[
    {id:'shell',path:'',module:ref('Shell'),errorBoundary:ref('Boundaries','RootBoundary'),source:{}},
    {id:'home',parentId:'shell',index:true,module:ref('Home'),source:{}},
    {id:'nested',parentId:'shell',path:'nested',module:ref('Nested'),errorBoundary:ref('Boundaries','ChildBoundary'),source:{}},
    {id:'render',parentId:'nested',path:'render',module:ref('RenderFailure'),source:{}},
    {id:'eval',parentId:'nested',path:'eval',module:ref('EvalFailure'),source:{}},
    {id:'transport',parentId:'nested',path:'transport',module:ref('Deferred'),errorBoundary:ref('Boundaries','ChildBoundary'),source:{}},
    {id:'broken-boundary',parentId:'shell',path:'broken-boundary',module:ref('RenderFailure'),errorBoundary:ref('Boundaries','BrokenBoundary'),source:{}},
    {id:'unhandled',parentId:'shell',path:'unhandled',module:ref('RenderFailure'),source:{}},
    {id:'missing',parentId:'shell',path:'*',module:ref('Missing'),source:{}},
  ];
  await f.write('cormi.config.ts',`import {defineConfig} from 'cormijs';import preset from '@cormijs/preset-react-vite';export default defineConfig({presets:[preset],app:{base:'/admin/',strict:true,server:{port:0},routes:${JSON.stringify(routes)}}});`);
  await f.write('src/Shell.tsx',`import {Outlet,Link,useLocation} from 'react-router';export default function Shell(){const location=useLocation();return <><header data-shell><Link to="/">Home</Link><span>{location.pathname}</span></header><Outlet/></>}`);
  await f.write('src/Nested.tsx',`import {Outlet} from 'react-router';export default function Nested(){return <section data-nested><Outlet/></section>}`);
  await f.write('src/Boundaries.tsx',`import {useRouteError,Link} from 'react-router';export function RootBoundary(){const error=useRouteError();return <section role="alert"><h1>Root boundary</h1><p>{error instanceof Error?error.message:String(error)}</p><Link to="/">Recover home</Link></section>}export function ChildBoundary(){const error=useRouteError();return <section role="alert"><h1>Child boundary</h1><p>{error instanceof Error?error.message:String(error)}</p><Link to="/">Recover home</Link></section>}export function BrokenBoundary(){throw Error('BOUNDARY_RENDER_FAILURE');return null}`);
  await f.write('src/Home.tsx',`import {useState} from 'react';export default function Home(){const [n,set]=useState(0);return <main><h1>Working home</h1><button onClick={()=>set(n+1)}>Count: {n}</button></main>}`);
  await f.write('src/RenderFailure.tsx',`export default function RenderFailure(){throw Error('ROUTE_RENDER_FAILURE');return null}`);
  await f.write('src/EvalFailure.tsx',`throw Error('ROUTE_EVALUATION_FAILURE');export default function EvalFailure(){return null}`);
  await f.write('src/Deferred.tsx',`export default function Deferred(){return <h1>Deferred recovered</h1>}`);
  await f.write('src/Missing.tsx',`export default function Missing(){return <h1>Application 404</h1>}`);
  return f;
}
async function normal(page:Page,url:string) {
  await page.goto(url);await page.getByRole('heading',{name:'Working home',exact:true}).waitFor();
  assert.match(await page.title(),/cormi boundaries/);assert.equal(await page.locator('[data-shell]').count(),1);
  await page.getByRole('button',{name:'Count: 0',exact:true}).click();await page.getByRole('button',{name:'Count: 1',exact:true}).waitFor();
}
async function errors(page:Page,base:string) {
  for(const [path,heading,message,shell] of [
    ['nested/render','Child boundary','ROUTE_RENDER_FAILURE',1],
    ['nested/eval','Child boundary','ROUTE_EVALUATION_FAILURE',1],
    ['broken-boundary','Root boundary','BOUNDARY_RENDER_FAILURE',0],
    ['unhandled','Root boundary','ROUTE_RENDER_FAILURE',0],
  ] as const){
    await page.goto(new URL(path,base).href);await page.getByRole('heading',{name:heading,exact:true}).waitFor();
    assert.ok((await page.getByRole('alert').innerText()).includes(message));assert.equal(await page.locator('[data-shell]').count(),shell);
    assert.equal(await page.getByRole('heading',{name:'Application 404',exact:true}).count(),0);
    await page.getByRole('link',{name:'Recover home',exact:true}).click();await page.getByRole('heading',{name:'Working home',exact:true}).waitFor();
  }
  await page.goto(new URL('unknown-path',base).href);await page.getByRole('heading',{name:'Application 404',exact:true}).waitFor();
}
test('generated boundaries catch render/evaluation failures, bubble failed boundaries and preserve application 404 in dev and preview',{timeout:90000},async t=>{
  const f=await project(t),instance=await browser(t),page=await instance.newPage();page.setDefaultTimeout(12000);
  const actual:string[]=[];page.on('pageerror',e=>actual.push(e.message));
  const dev=cli(t,f.root,'dev',['--startup-timeout','30000']);const ready=await dev.waitFor(e=>e.type==='ready',0,30000);
  await normal(page,ready.url);assert.equal(actual.length,0);await errors(page,ready.url);
  await f.write('src/RenderFailure.tsx',`export default function Repaired(){return <h1>Repaired render</h1>}`);
  const until=Date.now()+7000;let transformed='';
  while(Date.now()<until){transformed=await (await fetch(new URL('src/RenderFailure.tsx',ready.url))).text();if(transformed.includes('Repaired render'))break;await new Promise(r=>setTimeout(r,20));}
  assert.ok(transformed.includes('Repaired render'),'Dev transform must reflect repaired source before explicit recovery navigation');
  await page.goto(new URL('nested/render',ready.url).href);await page.getByRole('heading',{name:'Repaired render',exact:true}).waitFor();
  assert.equal(dev.events.filter(e=>e.type==='starting').length,1);
  await page.close();assert.equal(await dev.stop(),0);await assertPortFree(Number(new URL(ready.url).port));
  await f.write('src/RenderFailure.tsx',`export default function RenderFailure(){throw Error('ROUTE_RENDER_FAILURE');return null}`);
  const build=cli(t,f.root,'build',['--startup-timeout','30000']);assert.equal(await build.finish(30000),0,build.stderr);
  const preview=cli(t,f.root,'preview'),serving=await preview.waitFor(e=>e.type==='ready');
  const production=await instance.newPage();production.setDefaultTimeout(12000);await normal(production,serving.url);await errors(production,serving.url);
  await production.close();assert.equal(await preview.stop(),0);await assertPortFree(Number(new URL(serving.url).port));
  assert.ok(actual.every(message=>/ROUTE_RENDER_FAILURE|ROUTE_EVALUATION_FAILURE|BOUNDARY_RENDER_FAILURE/.test(message)),JSON.stringify(actual));
});
test('page transport failure reaches its statically available same-route boundary and reload repairs it',{timeout:45000},async t=>{
  const f=await project(t),instance=await browser(t),page=await instance.newPage();page.setDefaultTimeout(12000);
  const dev=cli(t,f.root,'dev',['--startup-timeout','30000']),ready=await dev.waitFor(e=>e.type==='ready',0,30000);
  const requests:string[]=[],failures:string[]=[],messages:string[]=[];page.on('request',r=>requests.push(r.url()));
  page.on('pageerror',e=>failures.push(e.stack??e.message));page.on('console',m=>messages.push(m.type()+': '+m.text()));
  let intercepted=0;await page.route('**/src/Deferred.tsx*',async route=>{intercepted++;await route.abort('failed');});
  await page.goto(new URL('nested/transport',ready.url).href);
  try { await page.getByRole('heading',{name:'Child boundary',exact:true}).waitFor(); }
  catch(error){t.diagnostic(JSON.stringify({intercepted,requests,failures,messages,html:await page.locator('#root').innerHTML(),body:await page.locator('body').innerText()}));throw error;}
  assert.ok(intercepted>0);assert.equal(await page.locator('[data-shell]').count(),1);
  await page.unroute('**/src/Deferred.tsx*');await page.reload();await page.getByRole('heading',{name:'Deferred recovered',exact:true}).waitFor();
  assert.equal(await page.locator('vite-error-overlay,cormi-development-overlay').count(),0);
  await page.close();assert.equal(await dev.stop(),0);await assertPortFree(Number(new URL(ready.url).port));
});
test('runtime claims one root during asynchronous setup and StrictMode effects balance without duplicating runtime setup',{timeout:45000},async t=>{
  const f=await project(t),instance=await browser(t),page=await instance.newPage();page.setDefaultTimeout(12000);
  await f.write('src/probe.tsx',`import {useEffect,createElement} from 'react';import {mountApplication} from '@cormijs/runtime';
export async function probe(){const element=document.createElement('div');document.body.append(element);const events:string[]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r);const plugin={setup:async()=>{events.push('setup');await gate;return ()=>{events.push('dispose')}}};function Page(){useEffect(()=>{events.push('effect');return()=>{events.push('cleanup')}},[]);return createElement('p',{'data-probe':true},'Probe')}
const first=mountApplication({element,strict:true,routes:[{path:'*',Component:Page}],plugins:[{id:'probe',plugin}]});let duplicate='';try{await mountApplication({element,routes:[]})}catch(error){duplicate=String(error)}release();const handle=await first;const deadline=performance.now()+5000;while(events.filter(e=>e==='effect').length<2){if(performance.now()>deadline)throw Error('StrictMode effects did not settle');await new Promise<void>(r=>requestAnimationFrame(()=>r()))}return {element,events,handle,duplicate,mountApplication};}
`);
  const dev=cli(t,f.root,'dev',['--startup-timeout','30000']),ready=await dev.waitFor(e=>e.type==='ready',0,30000);await normal(page,ready.url);
  const result=await page.evaluate(async(url)=>{
    const m=await import(url),p=await m.probe();await p.handle.dispose();await p.handle.dispose();
    const balanced={duplicate:p.duplicate,events:[...p.events],remaining:document.querySelectorAll('[data-probe]').length};
    const again=await p.mountApplication({element:p.element,routes:[]});await again.dispose();p.element.remove();return balanced;
  },new URL('src/probe.tsx',ready.url).href);
  assert.match(result.duplicate,/already owned/);assert.equal(result.remaining,0);
  assert.equal(result.events.filter((e:string)=>e==='setup').length,1);assert.equal(result.events.filter((e:string)=>e==='dispose').length,1);
  assert.equal(result.events.filter((e:string)=>e==='effect').length,2);assert.equal(result.events.filter((e:string)=>e==='cleanup').length,2);
  await page.close();assert.equal(await dev.stop(),0);await assertPortFree(Number(new URL(ready.url).port));
});
