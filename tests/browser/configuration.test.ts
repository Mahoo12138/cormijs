import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { app, cli } from '../launcher-helpers.js';
import { assertPortFree } from '../helpers.js';

// Browser skill/runtime is not listed; reuse the project's isolated Playwright workflow.
// Flow: explain staging configuration -> dev deep route + interaction -> build/preview same derived base.
test('configuration provenance agrees with rendered staging routes and production asset base', {timeout:60000}, async t => {
  const f = await app(t), source = resolve('examples/features');
  await cp(source, f.root, {recursive:true, filter:file=>!relative(source,file).split(sep).some(part=>['node_modules','.cormi','.cormi.lock','dist'].includes(part))});
  await f.write('cormi.config.ts',(await readFile(join(f.root,'cormi.config.ts'),'utf8')).replace('port: 8002','port: 0'));
  const explain=cli(t,f.root,'config',['--for','build','--mode','staging']);
  assert.equal(await explain.finish(),0,JSON.stringify(explain.events)+explain.stderr);
  const field=explain.events.find(e=>e.type==='result')!.data.fields.find((x:{path:string})=>x.path==='/base');
  assert.equal(field.value,'/staging/');assert.equal(field.history.at(-1).id,'example:deployment:base');
  assert.equal(existsSync(join(f.root,'.cormi/app.tsx')),false);
  const executablePath=process.env.CORMI_BROWSER_EXECUTABLE??'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.ok(existsSync(executablePath),'An installed Chromium browser is required.');
  const instance=await chromium.launch({executablePath,headless:true});t.after(()=>instance.close());
  const page=await instance.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(12000);
  const failures:string[]=[],consoleErrors:string[]=[];page.on('pageerror',e=>failures.push(e.message));
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text() + ' at ' + msg.location().url);});
  page.on('response',response=>{if(response.status()>=400)t.diagnostic(`HTTP ${response.status()}: ${response.url()}`);});
  t.diagnostic(`Browser: ${instance.version()}`);
  const dev=cli(t,f.root,'dev',['--mode','staging','--startup-timeout','30000']);const ready=await dev.waitFor(e=>e.type==='ready',0,30000);
  assert.equal(new URL(ready.url).pathname,field.value);
  await page.goto(new URL('status',ready.url).href);assert.match(await page.title(),/cormi/i);
  assert.equal(new URL(page.url()).pathname,'/staging/status');
  await page.getByRole('heading',{name:'插件已经接入。',exact:true}).waitFor();
  await page.getByRole('button',{name:'Count: 0',exact:true}).click();await page.getByRole('button',{name:'Count: 1',exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'插件已经接入。',exact:true}).waitFor();
  assert.equal(await page.locator('[data-status-provider]').count(),1);
  assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(),0);
  assert.equal(failures.length,0,failures.join('\n'));assert.equal(consoleErrors.length,0,consoleErrors.join('\n'));
  if(process.env.CORMI_CAPTURE_SCREENSHOT==='1'){
    await page.evaluate(()=>document.fonts.ready);await mkdir(resolve('.cache'),{recursive:true});
    await page.screenshot({path:resolve('.cache/cormi-staging-config.png'),fullPage:true});
  }
  await page.close();assert.equal(await dev.stop(),0);await assertPortFree(Number(new URL(ready.url).port));
  const build=cli(t,f.root,'build',['--mode','staging','--startup-timeout','30000']);assert.equal(await build.finish(30000),0,JSON.stringify(build.events)+build.stderr);
  assert.match(await readFile(join(f.root,'dist/index.html'),'utf8'),/\/staging\/assets\//);
  const generatedBefore=await stat(join(f.root,'.cormi/app.tsx'));
  const preview=cli(t,f.root,'preview',['--mode','staging']);const serving=await preview.waitFor(e=>e.type==='ready');
  const production=await instance.newPage();production.setDefaultTimeout(12000);production.on('pageerror',e=>failures.push(e.message));
  await production.goto(new URL('status',serving.url).href);await production.getByRole('heading',{name:'插件已经接入。',exact:true}).waitFor();
  assert.equal(new URL(production.url()).pathname,'/staging/status');
  await production.getByRole('button',{name:'Count: 0',exact:true}).click();await production.getByRole('button',{name:'Count: 1',exact:true}).waitFor();
  assert.deepEqual(failures,[]);assert.equal((await stat(join(f.root,'.cormi/app.tsx'))).mtimeMs,generatedBefore.mtimeMs);
  await production.close();assert.equal(await preview.stop(),0);await assertPortFree(Number(new URL(serving.url).port));
});
