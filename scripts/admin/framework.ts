import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, lstat, realpath, unlink, rmdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Page } from 'playwright-core';
import { appCommand, guardedSource, hash, withAdminServer } from './harness.js';
import { settingsSource, validationPlugin, validationRuntime } from './framework-fixture.js';

// Existing remote-Mac Playwright workflow; no connected Browser browser-skill is listed.
// Flow: real Users state -> config/plug-in failure or contribution change -> current cormi generation and UI.
const { values } = parseArgs({ strict:true, options:{ app:{type:'string'},out:{type:'string'} } });
assert.ok(values.app && values.out);
const app = await realpath(values.app), out = resolve(values.out), probeDir = join(app,'_cormi_validation');
assert.equal(existsSync(join(app,'.cormi.lock')),false,'Do not mutate a running application');
const migration = JSON.parse(await readFile(join(app,'migration.json'),'utf8'));
assert.equal(migration.upstream,'69e780a40c455d664b2e13c525faf1d492a072a7');
assert.equal(migration.headerFixes,false,'Use a faithful framework-validation fixture, not the UI-enhanced fork');
await mkdir(out); await mkdir(probeDir);
const config = await guardedSource(app,'cormi.config.ts');
const owned = new Map<string,Awaited<ReturnType<typeof guardedSource>>>();
async function create(name:string,content:string) {
  await writeFile(join(probeDir,name),content,{flag:'wx'});
  const guard = await guardedSource(app,'_cormi_validation/'+name); owned.set(name,guard); return guard;
}
async function tree(directory:string):Promise<Record<string,string>> {
  const files:Record<string,string>={};
  for(const item of await readdir(directory,{withFileTypes:true})) {
    assert.ok(!item.isSymbolicLink()); const path=join(directory,item.name);
    if(item.isDirectory())for(const [child,digest]of Object.entries(await tree(path)))files[item.name+'/'+child]=digest;
    else if(item.isFile())files[item.name]=hash(await readFile(path));
  } return files;
}
const sourceBefore=await tree(join(app,'src')), publicBefore=await tree(join(app,'public'));
const stages:Array<Record<string,unknown>>=[], report:Record<string,unknown>={app,passed:false,stages};
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
let settings:Awaited<ReturnType<typeof guardedSource>>|undefined, routeState:Awaited<ReturnType<typeof guardedSource>>|undefined;
async function until(predicate:()=>boolean|Promise<boolean>,label:string,ms=30000) {
  const end=Date.now()+ms;
  while(!await predicate()){assert.ok(Date.now()<end,label);await delay(25);}
}
async function snapshot(page:Page) {
  return page.evaluate(()=>({origin:performance.timeOrigin,filter:(document.querySelector('input[placeholder="Search user..."]') as HTMLInputElement|null)?.value,
    names:[...document.querySelectorAll('tbody th')].map(n=>n.textContent),checked:[...document.querySelectorAll<HTMLInputElement>('tbody input[type=checkbox]')].map(n=>n.checked)}));
}
try {
  settings=await create('settings.ts',settingsSource());
  routeState=await create('routes.json',JSON.stringify({path:'user',enabled:true}));
  await create('plugin.ts',validationPlugin);await create('runtime.ts',validationRuntime);
  const text=config.original.toString();assert.equal(text.split('export default defineConfig(').length,2);assert.ok(text.trimEnd().endsWith(');'));
  await config.replace("import { withValidation } from './_cormi_validation/plugin';\n"+text.replace('export default defineConfig(','export default withValidation(defineConfig(').trimEnd().slice(0,-2)+'));\n');
  await writeFile(join(out,'typecheck-probe.log'),appCommand(app,'typecheck'));
  browser=await chromium.launch({executablePath:process.env.CORMI_BROWSER_EXECUTABLE??'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
  report.browser=browser.version();
  report.dev=await withAdminServer(app,'dev',join(out,'dev.log'),async(address,events)=>{
    const page=await browser!.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(20000);
    const browserErrors:Array<{phase:string;message:string}>=[];let phase='normal';
    page.on('pageerror',e=>browserErrors.push({phase,message:e.message}));
    const consoleMessages:Array<{phase:string;level:string;message:string}>=[];
    page.on('console',message=>{if(['error','warning'].includes(message.type()))consoleMessages.push({phase,level:message.type(),message:message.text()});});
    report.consoleMessages=consoleMessages;
    const latestGeneration=()=>Math.max(...events.filter(e=>e.type==='starting').map(e=>Number(e.generation)));
    async function nextReady(from:number) {
      await until(()=>events.slice(from).some(e=>e.type==='ready'),'new worker did not become ready');
      return events.slice(from).find(e=>e.type==='ready')!;
    }
    async function users(version:string,load=false,path='user') {
      if(load)await page.goto(new URL(path,address).href);
      await page.waitForFunction(v=>document.documentElement.dataset.cormiValidation===v,version);
      await page.getByRole('heading',{name:'Users',exact:true}).waitFor();
      assert.equal(new URL(page.url()).pathname,new URL(path,address).pathname);
      assert.match(await page.title(),/Minimal/);
      assert.equal(await page.locator('vite-error-overlay,cormi-development-overlay').count(),0);
      assert.equal(await page.locator('#root').count(),1);
    }
    try {
      await users('initial',true);await page.getByPlaceholder('Search user...').fill('Billy');
      await until(()=>page.locator('tbody th').count().then(n=>n===2),'filter result');
      await page.locator('tbody input[type=checkbox]').first().check();
      const before=await snapshot(page), generated=hash(await readFile(join(app,'.cormi/app.tsx'))), generation=latestGeneration();
      let cursor=events.length;await settings!.replace('export const state = { broken syntax');
      await until(()=>events.slice(cursor).some(e=>e.code==='CONFIG_COMPILE_FAILED'&&e.servingPrevious===true),'compile failure must preserve previous worker');
      await delay(700);assert.equal(latestGeneration(),generation);assert.deepEqual(await snapshot(page),before);
      assert.equal(hash(await readFile(join(app,'.cormi/app.tsx'))),generated);
      stages.push({id:'config-syntax-preserves-worker-state',generation,servingPrevious:true});
      cursor=events.length;await settings!.replace(settingsSource('repaired'));const repaired=await nextReady(cursor);
      await users('repaired');assert.notEqual((await snapshot(page)).origin,before.origin);
      stages.push({id:'transitive-config-repair',generation:repaired.generation,automaticBrowserReload:true});

      phase='runtime-failure';cursor=events.length;await settings!.replace(settingsSource('invalid',true,true));
      await until(()=>events.slice(cursor).some(e=>e.type==='error'&&e.servingPrevious===false),'runtime failure must not claim old worker');
      await until(()=>events.slice(cursor).some(e=>e.type==='watching'),'failed worker must return to watch');
      const failedStarts=latestGeneration();await delay(700);assert.equal(latestGeneration(),failedStarts);
      await assert.rejects(fetch(new URL('__cormi_validation_version',address),{signal:AbortSignal.timeout(1000)}));
      cursor=events.length;await settings!.replace(settingsSource('runtime-repaired'));await nextReady(cursor);await users('runtime-repaired');phase='normal';
      stages.push({id:'runtime-failure-stops-and-recovers',servingPrevious:false,restartStorm:false});

      cursor=events.length;await settings!.replace(settingsSource('slow-owner',true,false,true));await nextReady(cursor);await users('slow-owner');
      cursor=events.length;await settings!.replace(settingsSource('obsolete'));
      await until(()=>existsSync(join(probeDir,'stopping.flag')),'old owner disposal checkpoint');
      await settings!.replace(settingsSource('newest'));await writeFile(join(probeDir,'release.flag'),'yes',{flag:'wx'});
      const newest=await nextReady(cursor);await users('newest');
      const applied=(await readFile(join(probeDir,'applied.log'),'utf8')).trim().split('\n');assert.ok(!applied.includes('obsolete'),JSON.stringify(applied));
      assert.ok(events.slice(cursor).some(e=>e.type==='superseded'&&e.phase==='before-start'));
      stages.push({id:'reload-during-disposal-discards-obsolete-plugin',generation:newest.generation,applied});

      const stableGeneration=latestGeneration();await page.getByPlaceholder('Search user...').fill('Billy');
      await until(()=>page.locator('tbody th').count().then(n=>n===2),'filter after restart');
      const routeBefore=await snapshot(page), entryBefore=hash(await readFile(join(app,'.cormi/app.tsx')));
      await routeState!.replace(JSON.stringify({path:'products',enabled:true}));
      await page.locator('cormi-development-overlay [role=alert]').waitFor();
      assert.equal(hash(await readFile(join(app,'.cormi/app.tsx'))),entryBefore);assert.deepEqual(await snapshot(page),routeBefore);
      await routeState!.replace(JSON.stringify({path:'user',enabled:true}));
      await page.locator('cormi-development-overlay').waitFor({state:'detached'});assert.deepEqual(await snapshot(page),routeBefore);
      stages.push({id:'route-contribution-conflict-preserves-last-entry',sameContentRepairPreservesState:true});
      await routeState!.replace(JSON.stringify({path:'staff',enabled:true}));
      await page.getByRole('heading',{name:'Sorry, page not found!',exact:false}).waitFor();
      await users('newest',true,'staff');assert.equal(latestGeneration(),stableGeneration);
      await routeState!.replace(JSON.stringify({path:'staff',enabled:false}));
      await page.getByRole('heading',{name:'Sorry, page not found!',exact:false}).waitFor();
      await routeState!.replace(JSON.stringify({path:'user',enabled:true}));
      await users('newest',true);assert.equal(latestGeneration(),stableGeneration);
      stages.push({id:'route-rename-remove-restore',workerUnchanged:true});

      cursor=events.length;await settings!.replace(settingsSource('disabled',false));await nextReady(cursor);
      await page.getByRole('heading',{name:'Sorry, page not found!',exact:false}).waitFor();
      assert.equal(await page.locator('html').getAttribute('data-cormi-validation'),null);
      assert.doesNotMatch(await readFile(join(app,'.cormi/app.tsx'),'utf8'),/validation:runtime/);
      cursor=events.length;await settings!.replace(settingsSource('enabled-again'));await nextReady(cursor);await users('enabled-again');
      const inspection=await readFile(join(app,'.cormi/inspect.jsonc'),'utf8');assert.match(inspection,/validation:users/);
      stages.push({id:'plugin-disable-removes-route-runtime-and-reenable',automaticBrowserReload:true});
      for(const name of ['settings.ts','plugin.ts'])assert.equal((await fetch(new URL('_cormi_validation/'+name+'?raw',address))).status,403);
      assert.deepEqual(browserErrors,[]);report.browserErrors=browserErrors;
      await page.screenshot({path:join(out,'framework-recovered.png')});
    } finally {
      // Release only our test gate even on an assertion failure, so the owned worker can
      // finish normal disposal instead of being left waiting for test code that has exited.
      if (existsSync(join(probeDir,'stopping.flag')) && !existsSync(join(probeDir,'release.flag'))) {
        await writeFile(join(probeDir,'release.flag'),'yes',{flag:'wx'});
      }
      await page.close();
    }
  });
  await writeFile(join(out,'typecheck-final-probe.log'),appCommand(app,'typecheck'));
  report.passed=true;
} catch(error){report.error=error instanceof Error?error.stack:String(error);}
finally {
  await browser?.close();
  // The supervisor owns its stop. Never remove its lease or edit another running instance.
  try {
    assert.equal(existsSync(join(app,'.cormi.lock')),false,'Stop must release the owned project lock before restoration');
    await config.restore();
    for(const [name,guard] of owned){await guard.restore();await unlink(join(probeDir,name));}
    for(const name of ['applied.log','stopping.flag','release.flag'])if(existsSync(join(probeDir,name))){const s=await lstat(join(probeDir,name));assert.ok(s.isFile()&&!s.isSymbolicLink());await unlink(join(probeDir,name));}
    await rmdir(probeDir);
    assert.deepEqual(await tree(join(app,'src')),sourceBefore);assert.deepEqual(await tree(join(app,'public')),publicBefore);
    await writeFile(join(out,'restored-typecheck.log'),appCommand(app,'typecheck'));
    report.businessSourcesUnchanged=true;report.restored=true;
  }catch(error){report.restoreError=String(error);report.passed=false;}
  await writeFile(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,stages:stages.length,error:report.error,restoreError:report.restoreError,out}));
  if(!report.passed)process.exitCode=1;
}
