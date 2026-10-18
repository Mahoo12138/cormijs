import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { app, cli } from '../launcher-helpers.js';
import { templateFiles } from '../../packages/create/src/templates.js';
import { assertPortFree } from '../helpers.js';

// Flow: scaffold page -> real Mock request -> edit Mock module -> fresh worker response -> production absence.
// No in-app Browser skill/runtime is supplied; use the repository's existing Playwright harness.
test('scaffold Mock UI works, imported Mock edits reload and invalid edits retain the previous worker', {timeout:60000}, async t=>{
  const f=await app(t), files=templateFiles('react-api');
  for(const [name,text] of Object.entries(files)) { await mkdir(dirname(join(f.root,name)),{recursive:true});await writeFile(join(f.root,name),text); }
  await f.write('cormi.config.ts',files['cormi.config.ts']!.replace('port: 8000','port: 0'));
  await mkdir(join(f.root,'.cormi-local'),{recursive:true});await f.write('.cormi-local/manifest.json','{"private":"local delivery metadata"}');
  const executablePath=process.env.CORMI_BROWSER_EXECUTABLE??'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.ok(existsSync(executablePath));const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
  t.diagnostic('Browser: '+browser.version());const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(10000);
  const failures:string[]=[];page.on('pageerror',error=>failures.push(error.message));
  const dev=cli(t,f.root,'dev',['--startup-timeout','30000']);let ready=await dev.waitFor(e=>e.type==='ready',0,30000);
  await page.goto(ready.url);assert.equal(await page.title(),'cormi app');assert.equal(new URL(page.url()).origin,new URL(ready.url).origin);
  await page.getByRole('heading',{name:'开始构建你的应用。',exact:true}).waitFor();
  await page.getByRole('button',{name:'Count: 0',exact:true}).click();await page.getByRole('button',{name:'Count: 1',exact:true}).waitFor();
  await page.getByRole('button',{name:'请求 Mock',exact:true}).click();await page.locator('output').filter({hasText:'Hello, cormi!'}).waitFor();
  assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(),0);
  for(const path of ['/mock.ts?raw','/.cormi-local/manifest.json?raw'])assert.equal((await fetch(new URL(path,ready.url))).status,403);
  await page.evaluate(()=>document.fonts.ready);await mkdir(resolve('.cache'),{recursive:true});
  await page.screenshot({path:resolve('.cache/cormi-created-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve('.cache/cormi-created-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:800});
  const original=files['mock.ts']!, invalidFrom=dev.events.length;
  await f.write('mock.ts','export const mocks = [ broken syntax');
  await dev.waitFor(e=>e.type==='error'&&e.code==='CONFIG_COMPILE_FAILED',invalidFrom);
  assert.deepEqual(await (await fetch(new URL('/api/hello?name=cormi',ready.url))).json(),{message:'Hello, cormi!'});
  await f.write('mock.ts',original.replace('Hello, ','Updated, '));
  const next=await dev.waitFor(e=>e.type==='ready'&&e.generation===2,0,30000);assert.notEqual(next.pid,ready.pid);
  // A replacement worker may intentionally bind the same configured/default port.
  if(new URL(next.url).port!==new URL(ready.url).port)await assertPortFree(Number(new URL(ready.url).port));ready=next;
  await page.goto(ready.url);await page.getByRole('button',{name:'请求 Mock',exact:true}).click();await page.locator('output').filter({hasText:'Updated, cormi!'}).waitFor();
  assert.deepEqual(failures,[]);await page.close();assert.equal(await dev.stop(),0);await assertPortFree(Number(new URL(ready.url).port));
  const build=cli(t,f.root,'build',['--startup-timeout','30000']);assert.equal(await build.finish(30000),0,JSON.stringify(build.events)+build.stderr);
  const manifest=JSON.parse(await readFile(join(f.root,'dist/.cormi-build.json'),'utf8'));assert.ok(manifest);
  const preview=cli(t,f.root,'preview');const serving=await preview.waitFor(e=>e.type==='ready');const response=await fetch(new URL('/api/hello',serving.url));assert.doesNotMatch(await response.text(),/Updated, cormi/);assert.equal(await preview.stop(),0);
});
