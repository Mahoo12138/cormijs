import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { app, cli } from '../launcher-helpers.js';
import { listen, close, assertPortFree } from '../helpers.js';
import { writeEnvironmentFixture, verifyEnvironmentPage, privateMarkers } from '../../scripts/environment-fixture.js';

// Browser skill runtime is absent; reuse the repository's isolated Playwright workflow.
// Flow: selected mode -> compare Node/browser/HTML -> invalid edit preserves state -> repair -> build -> immutable preview.
test('one accepted environment snapshot reaches Node plugins HTML and React through recovery build and preview',{timeout:90000},async t=>{
 const f=await app(t),portServer=createServer();const port=await listen(portServer);await close(portServer);
 // app() owns a basic HTML fixture; replace only that known file before the create-only environment fixture.
 await rm(join(f.root,'index.html'));
 await writeEnvironmentFixture(f.root,'/stage/',port);
 const browser=await chromium.launch({executablePath:process.env.CORMI_BROWSER??'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
 t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1280,height:800}});const errors:string[]=[];
 page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text())});
 const dev=cli(t,f.root,'dev',['--mode','staging']);const first=await dev.waitFor(e=>e.type==='ready');
 await verifyEnvironmentPage(page,first.url,'selected',false);const documentId=await page.evaluate(()=>performance.timeOrigin);
 for(const path of ['.env','.env.local','.env.staging','.env.staging.local','cormi.config.ts']) assert.equal((await fetch(new URL(path+'?raw',first.url))).status,403,path);
 const start=dev.events.length;await writeFile(join(f.root,'.env.staging.local'),'CORMI_PUBLIC_VALUE="INCOMPLETE_PRIVATE_MARKER');
 const failure=await dev.waitFor(e=>e.type==='error',start);assert.equal(failure.servingPrevious,true);
 await page.getByRole('button',{name:'Count: 1',exact:true}).waitFor();assert.equal(await page.evaluate(()=>performance.timeOrigin),documentId);
 await writeFile(join(f.root,'.env.staging.local'),'CORMI_PUBLIC_VALUE=recovered');
 const ready=await dev.waitFor(e=>e.type==='ready',start);assert.equal(ready.url,first.url);
 await verifyEnvironmentPage(page,ready.url,'recovered',false,false);assert.notEqual(await page.evaluate(()=>performance.timeOrigin),documentId);
 assert.equal(await dev.stop(),0);await assertPortFree(port);
 const types=cli(t,f.root,'typecheck',['--mode','staging']);assert.equal(await types.finish(),0,types.stderr+JSON.stringify(types.events));
 const build=cli(t,f.root,'build',['--mode','staging']);assert.equal(await build.finish(),0,JSON.stringify(build.events)+build.stderr);
 async function scan(directory:string){for(const item of await readdir(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory())await scan(path);else for(const marker of privateMarkers)assert.equal((await readFile(path)).includes(Buffer.from(marker)),false,path)}}
 await scan(join(f.root,'dist'));await scan(join(f.root,'.cormi'));
 const generated=await readFile(join(f.root,'.cormi/app.tsx'));
 await writeFile(join(f.root,'.env.staging.local'),'CORMI_PUBLIC_VALUE=changed-after-build');
 const preview=cli(t,f.root,'preview',['--mode','staging']);const served=await preview.waitFor(e=>e.type==='ready');
 await page.setViewportSize({width:390,height:844});await verifyEnvironmentPage(page,served.url,'recovered',true);
 assert.deepEqual(await readFile(join(f.root,'.cormi/app.tsx')),generated);assert.deepEqual(errors,[]);
 if(process.env.CORMI_CAPTURE_SCREENSHOT==='1'){await mkdir(resolve('.cache'),{recursive:true});await page.screenshot({path:resolve('.cache/cormi-environment-preview.png'),fullPage:false})}
 assert.equal(await preview.stop(),0);await assertPortFree(port);
});
