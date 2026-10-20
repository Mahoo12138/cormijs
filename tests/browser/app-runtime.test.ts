import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {app,cli} from '../launcher-helpers.js';
import {assertPortFree,gate} from '../helpers.js';
import {writeAppRuntimeFixture,verifyAppRuntimePage,appRuntimeSource,appRuntimeConfiguration} from '../../scripts/app-runtime-fixture.js';
async function browser(t:TestContext){
 const executablePath=process.env.CORMI_BROWSER_EXECUTABLE??'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';assert.ok(existsSync(executablePath));
 const b=await chromium.launch({executablePath,headless:true});t.after(()=>b.close());t.diagnostic('Browser: '+b.version());const page=await b.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(10000);return page;
}
test('app initialization blocks first render; root container, patched routes and complete events work in dev and production', {timeout:90000},async t=>{
 const f=await app(t);await writeAppRuntimeFixture(f.root);const page=await browser(t),errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text());});
 const dev=cli(t,f.root,'dev',['--startup-timeout','30000']),ready=await dev.waitFor(e=>e.type==='ready',0,30000);
 const entered=gate(),release=gate();
 await page.route('**/startup.json',async route=>{entered.resolve();await release.promise;await route.continue();});
 try {
  await page.goto(ready.url);await entered.promise;assert.equal(await page.locator('#root').innerHTML(),'');
  assert.deepEqual(await page.evaluate('window.appTrace'),['feature:setup','app:setup','render:wait']);release.resolve();
  await page.getByRole('heading',{name:'Runtime home',exact:true}).waitFor();
 } finally {release.resolve();await page.unrouteAll({behavior:'wait'});}
 await verifyAppRuntimePage(page,ready.url);
 await mkdir(resolve('.cache'),{recursive:true});await page.screenshot({path:resolve('.cache/f1a-runtime-dev.png')});
 await page.goto(ready.url);await page.getByRole('button',{name:'Count: 0',exact:true}).click();
 const home=join(f.root,'src/pages/index.tsx'),original=await readFile(home,'utf8');
 await writeFile(home,original.replace('Runtime home','Updated home'));await page.getByRole('heading',{name:'Updated home'}).waitFor();await page.getByRole('button',{name:'Count: 1',exact:true}).waitFor();
 await writeFile(home,original);await page.getByRole('heading',{name:'Runtime home',exact:true}).waitFor();
 await f.write('src/app.tsx',appRuntimeSource.replaceAll('Application runtime','Application changed'));
 await page.getByRole('heading',{name:'Application changed',exact:true}).waitFor();assert.equal(await page.locator('[data-app-root]').count(),1);
 await f.write('src/app.tsx',appRuntimeSource);await page.getByRole('heading',{name:'Application runtime',exact:true}).waitFor();
 assert.equal(dev.events.filter(e=>e.type==='starting').length,1);
 await page.goto('about:blank');assert.equal(await dev.stop(),0);await assertPortFree(Number(new URL(ready.url).port));
 const types=cli(t,f.root,'typecheck',['--startup-timeout','30000']);assert.equal(await types.finish(30000),0,JSON.stringify(types.events));
 const build=cli(t,f.root,'build',['--startup-timeout','30000']);assert.equal(await build.finish(30000),0,JSON.stringify(build.events)+build.stderr);
 const preview=cli(t,f.root,'preview'),production=await preview.waitFor(e=>e.type==='ready');await verifyAppRuntimePage(page,production.url);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve('.cache/f1a-runtime-preview.png')});
 assert.deepEqual(errors,[]);await page.goto('about:blank');assert.equal(await preview.stop(),0);
});
test('app convention removal and explicit replacement retain independent runtime contributions', {timeout:60000},async t=>{
 const f=await app(t);await writeAppRuntimeFixture(f.root);const page=await browser(t);
 const dev=cli(t,f.root,'dev',['--startup-timeout','30000']),ready=await dev.waitFor(e=>e.type==='ready',0,30000);
 await page.goto(ready.url);await page.getByRole('heading',{name:'Application runtime',exact:true}).waitFor();
 await f.write('src/app.ts','export default {};');await page.locator('cormi-development-overlay').getByText(/More than one application runtime/).waitFor();
 assert.equal(await page.locator('[data-app-root]').count(),1);await unlink(join(f.root,'src/app.ts'));
 await page.locator('cormi-development-overlay').waitFor({state:'detached'});
 const start=dev.events.length;
 await f.write('cormi.config.ts',appRuntimeConfiguration.replace("{id:'app-runtime',plugin:appRuntimePlugin}","{id:'app-runtime',plugin:appRuntimePlugin,enabled:false}"));
 const off=await dev.waitFor(e=>e.type==='ready',start,30000);await page.goto(off.url);await page.getByRole('heading',{name:'Runtime home',exact:true}).waitFor();
 assert.equal(await page.locator('[data-app-root]').count(),0);assert.equal(await page.locator('[data-extension="inactive"]').count(),1);
 const current=dev.events.length;
 await f.write('cormi.config.ts',appRuntimeConfiguration.replace("{id:'app-runtime',plugin:appRuntimePlugin}","{id:'app-runtime',plugin:appRuntimePlugin,enabled:false}").replace("app:{base:","app:{runtimeConfig:{specifier:'./src/app.tsx',exportName:'*'},base:"));
 const explicit=await dev.waitFor(e=>e.type==='ready',current,30000);await page.goto(explicit.url);await page.getByRole('heading',{name:'Application runtime',exact:true}).waitFor();
 assert.equal(await page.locator('[data-extension="Feature ready"]').count(),1);await page.goto('about:blank');assert.equal(await dev.stop(),0);
});
test('runtime failure and startup cancellation drain acquired effects without creating a late root', {timeout:60000},async t=>{
 const f=await app(t);await writeAppRuntimeFixture(f.root);const page=await browser(t);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text());});
 t.after(()=>t.diagnostic('Runtime probe errors: '+JSON.stringify(errors)));
 await f.write('exercise.ts',`import {mountApplication,resolveAppConfig} from '@cormijs/runtime';import {createElement} from 'react';
export async function exercise(){
 const node=document.createElement('div');document.body.append(node);const trace=[];
 const options={element:node,base:'/runtime/',routes:[{path:'*',Component:()=>createElement('div',null,'mounted')}],plugins:[{id:'feature',plugin:{setup(){trace.push('feature:start');return ()=>trace.push('feature:stop');}}}]};
 let failure='';try{await mountApplication({...options,appConfig:{setup(){return ()=>trace.push('app:stop');},rootContainer(){throw new Error('root-failure');}}});}catch(error){failure=error.message;}
 const controller=new AbortController();let next,enter;const entered=new Promise(resolve=>{enter=resolve;});
 const pending=mountApplication({...options,signal:controller.signal,appConfig:{render(callback){next=callback;enter();}}});
 const result=pending.then(()=>false,error=>error.message);await entered;controller.abort(new Error('cancelled-start'));const cancelled=await result;
 let late='';try{await next();}catch(error){late=error.message;}
 const handle=await mountApplication(options);
 try {const end=performance.now()+5000;while(node.innerText!=='mounted'){if(performance.now()>end)throw new Error('Mount did not paint: '+node.outerHTML+' connected='+node.isConnected+' location='+location.href+' '+JSON.stringify(trace));await new Promise(r=>setTimeout(r,20));}}
 finally {if(node.innerText!=='mounted')await handle.dispose();}
 const visible=node.innerText;await Promise.all([handle.dispose(),handle.dispose()]);
 const empty=node.innerHTML==='';node.remove();return {failure,cancelled,late,visible,empty,trace};
}`);
 const dev=cli(t,f.root,'dev',['--startup-timeout','30000']),ready=await dev.waitFor(e=>e.type==='ready',0,30000);await page.goto(ready.url);await page.getByRole('heading',{name:'Runtime home',exact:true}).waitFor();
 const result=await page.evaluate('import('+JSON.stringify(new URL('exercise.ts',ready.url).href)+').then(m=>m.exercise())') as {failure:string;cancelled:string;late:string;visible:string;empty:boolean;trace:string[]};
 assert.equal(result.failure,'root-failure');assert.equal(result.cancelled,'cancelled-start');assert.match(result.late,/APP_RENDER_NEXT_INVALID/);assert.equal(result.visible,'mounted');assert.equal(result.empty,true);
 assert.deepEqual(errors,[]);
 assert.deepEqual(result.trace,['feature:start','app:stop','feature:stop','feature:start','feature:stop','feature:start','feature:stop']);
 await page.goto('about:blank');assert.equal(await dev.stop(),0);
});
