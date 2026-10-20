import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const appRuntimeSource = `import { defineApp } from '@cormijs/runtime';
import { Link } from 'react-router';
import type { RuntimeConfig } from '@cormijs/runtime';
if (typeof document === 'undefined') throw new Error('APP_EXECUTED_IN_NODE');
window.appTrace ??= []; window.appEvents ??= [];
const trace=window.appTrace;
export default defineApp({
  banner: 'Feature ready',
  setup({signal}) { trace.push('app:setup'); return ()=>{trace.push('app:dispose:'+signal.aborted);}; },
  async render(next) {
    trace.push('render:wait');
    const response=await fetch(import.meta.env.BASE_URL+'startup.json');
    if(!response.ok) throw new Error('Initialization failed');
    const value:unknown=await response.json(); if(!value || typeof value!=='object' || !('ready' in value))throw new Error('Bad initialization');
    trace.push('render:ready');await next();trace.push('render:after');
  },
  patchClientRoutes({routes}) {trace.push('routes:patch');routes.push({id:'app:injected',path:'injected',Component:()=> <main><h2>Injected route</h2><Link to="/">Home</Link></main>});},
  rootContainer(node,{basename}) {trace.push('root:wrap');return <section data-app-root="Application runtime" data-base={basename}><h1>Application runtime</h1>{node}</section>;},
  onRouteChange(event) { const {location,action,isFirst,basename,routes,clientRoutes}=event; window.appEvents.push({pathname:location.pathname,search:location.search,hash:location.hash,action,isFirst,basename,routes:routes.map(route=>String(route.id)),clientRoutes:clientRoutes.map(route=>String(route.id))}); },
} satisfies RuntimeConfig);
`;
export const appRuntimeConfiguration = `import {defineConfig} from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import {appRuntimePlugin} from '@cormijs/plugin-react';
const extension={name:'fixture:banner',inject:['react'],apply(ctx){
 ctx.effect(()=>ctx.react.appConfig.tap({id:'fixture:banner:key',owner:'fixture:banner',ownerOrder:0,run:()=>[{id:'fixture:banner',keys:['banner']}]}));
 ctx.effect(()=>ctx.react.runtime.tap({id:'fixture:banner:runtime',owner:'fixture:banner',ownerOrder:0,run:()=>[{id:'fixture:banner',module:{specifier:'./src/extension.tsx',exportName:'default'}}]}));
}};
export default defineConfig({presets:[preset],plugins:[{id:'app-runtime',plugin:appRuntimePlugin},{id:'extension',plugin:extension}],app:{base:'/runtime/',server:{port:0}}});
`;
export async function writeAppRuntimeFixture(root: string) {
  await mkdir(join(root,'src/pages'),{recursive:true}); await mkdir(join(root,'public'),{recursive:true});
  const files: Record<string,string> = {
    'index.html':'<!doctype html><html><head><title>cormi app runtime</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts':appRuntimeConfiguration,
    'src/app.tsx':appRuntimeSource,
    'src/features.d.ts':`import '@cormijs/runtime';declare module '@cormijs/runtime' {interface RuntimeConfig {banner?:string}}
declare global {interface Window {appTrace:string[];appEvents:Array<{pathname:string;search:string;hash:string;action:string;isFirst:boolean;basename:string;routes:string[];clientRoutes:string[]}>;}}`,
    'src/extension.tsx':`import type {RuntimePlugin} from '@cormijs/runtime';
export default {setup(){window.appTrace ??=[];window.appTrace.push('feature:setup');return ()=>{window.appTrace.push('feature:dispose');};},Provider({children,appConfig}){return <div data-extension={appConfig.banner??'inactive'}>{children}</div>;}} satisfies RuntimePlugin;`,
    'src/pages/index.tsx':`import {useState} from 'react';import {Link,useNavigate} from 'react-router';
export default function Home(){const [count,setCount]=useState(0);const navigate=useNavigate();return <main><h2>Runtime home</h2><button onClick={()=>setCount(n=>n+1)}>Count: {count}</button><Link to="/injected?q=one#anchor">Injected</Link><button onClick={()=>navigate('/injected?q=replace',{replace:true})}>Replace route</button></main>;}`,
    'public/startup.json':'{"ready":true}',
    'tsconfig.json':JSON.stringify({compilerOptions:{target:'ES2023',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,noEmit:true,skipLibCheck:false,lib:['ES2023','DOM','DOM.Iterable'],types:['react','react-dom']},include:['src','.cormi/**/*']},null,2),
  };
  for(const [name,content] of Object.entries(files))await writeFile(join(root,name),content);
}
export async function verifyAppRuntimePage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading',{name:'Runtime home',exact:true}).waitFor();
  assert.equal(await page.title(),'cormi app runtime'); assert.equal(new URL(page.url()).pathname,'/runtime/');
  assert.equal(await page.locator('[data-app-root="Application runtime"] [data-extension="Feature ready"]').count(),1);
  await page.getByRole('button',{name:'Count: 0',exact:true}).click(); await page.getByRole('button',{name:'Count: 1',exact:true}).waitFor();
  const origin = await page.evaluate(()=>performance.timeOrigin);
  await page.getByRole('link',{name:'Injected',exact:true}).click(); await page.getByRole('heading',{name:'Injected route'}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/runtime/injected');assert.equal(new URL(page.url()).search,'?q=one');assert.equal(new URL(page.url()).hash,'#anchor');
  await page.goBack(); await page.getByRole('heading',{name:'Runtime home',exact:true}).waitFor();
  await page.getByRole('button',{name:'Replace route'}).click();await page.getByRole('heading',{name:'Injected route'}).waitFor();
  assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);
  const observation=await page.evaluate('({trace:window.appTrace,events:window.appEvents})') as {trace:string[];events:Array<{action:string;isFirst:boolean;basename:string;pathname:string;search:string;hash:string;routes:string[];clientRoutes:string[]}>};
  assert.deepEqual(observation.trace,['feature:setup','app:setup','render:wait','render:ready','routes:patch','root:wrap','render:after']);
  assert.deepEqual(observation.events.map(row=>[row.action,row.isFirst,row.pathname,row.search,row.hash,row.basename]),
    [['POP',true,'/runtime/','','','/runtime/'],['PUSH',false,'/runtime/injected','?q=one','#anchor','/runtime/'],['POP',false,'/runtime/','','','/runtime/'],['REPLACE',false,'/runtime/injected','?q=replace','','/runtime/']]);
  assert.ok(observation.events.every(row=>!row.routes.includes('app:injected') && row.clientRoutes.includes('app:injected')));
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(),0);
  await page.reload();await page.getByRole('heading',{name:'Injected route'}).waitFor();
  return observation;
}
