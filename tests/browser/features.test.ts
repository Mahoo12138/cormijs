import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { app, cli } from '../launcher-helpers.js';

// Browser skill is not listed in this session; use the repository's existing isolated Playwright workflow.
async function browser(t: TestContext) {
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.ok(existsSync(executablePath), 'An installed Chromium browser is required.');
  const instance = await chromium.launch({ executablePath, headless: true }); t.after(() => instance.close());
  const page = await instance.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(12000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  t.diagnostic(`Browser: ${instance.version()}`); return { page, errors };
}
async function project(t: TestContext) {
  const f = await app(t), source = resolve('examples/features');
  await cp(source, f.root, { recursive: true, filter: file => !relative(source, file).split(sep).some(part => ['node_modules','.cormi','.cormi.lock','dist'].includes(part)) });
  const config = (await readFile(join(f.root,'cormi.config.ts'),'utf8')).replace('port: 8002','port: 0');
  await f.write('cormi.config.ts',config); return { ...f, config };
}
async function has(page: Page, selector: string, text: string) {
  await page.waitForFunction(({selector,text}) => document.querySelector(selector)?.textContent?.includes(text), {selector,text});
}
async function command(t: TestContext, root: string, name: string) {
  const child = cli(t,root,name,['--startup-timeout','30000']);
  assert.equal(await child.finish(30000),0,JSON.stringify(child.events)+child.stderr);
}

test('a feature owns page, metadata and Provider; component HMR preserves state and configuration disable withdraws the feature', {timeout:60000}, async t => {
  const f=await project(t), {page,errors}=await browser(t);
  await command(t,f.root,'typecheck');
  const dev=cli(t,f.root,'dev',['--startup-timeout','30000']);
  const first=await dev.waitFor(e=>e.type==='ready',0,30000);
  await page.goto(new URL('status',first.url).href);
  assert.match(await page.title(),/cormi/); assert.match(page.url(),/\/workspace\/status$/);
  await has(page,'h1','插件已经接入。');await has(page,'[data-testid="feature-label"]','本地工作台');
  await has(page,'[data-testid="breadcrumbs"]','工作台 / 功能插件');
  assert.equal(await page.locator('[data-status-provider]').count(),1);
  assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(),0);
  const nodeSource=await fetch(new URL('features/status/plugin.ts?raw',first.url)); assert.equal(nodeSource.status,403);
  await page.getByRole('button',{name:'Count: 0',exact:true}).click();await page.getByRole('button',{name:'Count: 1',exact:true}).click();
  const file=join(f.root,'features/status/client/Page.tsx');
  await writeFile(file,(await readFile(file,'utf8')).replace('插件已经接入。','插件页面已更新。'));
  await has(page,'h1','插件页面已更新。');await has(page,'button','Count: 2');
  if(process.env.CORMI_CAPTURE_SCREENSHOT==='1') {
    await mkdir(resolve('.cache'),{recursive:true});await page.screenshot({path:resolve('.cache/cormi-feature-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('#root header').count(),1);
    assert.equal(await page.locator('[data-status-provider]').count(),1);
    assert.equal(await page.locator('#root footer').innerText(),'应用选择功能，插件维护实现。内核不绑定 React 或 Vite。');
    await page.screenshot({path:resolve('.cache/cormi-feature-mobile.png'),fullPage:true});await page.setViewportSize({width:1280,height:800});
  }
  await f.write('cormi.config.ts',f.config.replace('enabled: true','enabled: false'));
  const disabled=await dev.waitFor(e=>e.type==='ready'&&e.generation===2,0,30000);
  await page.goto(new URL('status',disabled.url).href);await has(page,'h1','404');
  assert.equal(await page.locator('[data-status-provider]').count(),0);
  assert.doesNotMatch(await readFile(join(f.root,'.cormi/app.tsx'),'utf8'),/features\/status\/client/);
  await f.write('cormi.config.ts',f.config.replace('本地工作台','重新启用'));
  const enabled=await dev.waitFor(e=>e.type==='ready'&&e.generation===3,0,30000);
  await page.goto(new URL('status',enabled.url).href);await has(page,'[data-testid="feature-label"]','重新启用');
  assert.equal(await page.locator('[data-status-provider]').count(),1);
  assert.deepEqual(errors,[]);assert.equal(await dev.stop(),0);
  await command(t,f.root,'build');
  await unlink(file); // preview uses already built feature assets, not a fresh generation.
  const preview=cli(t,f.root,'preview');const serving=await preview.waitFor(e=>e.type==='ready');
  await page.goto(new URL('status',serving.url).href);await has(page,'h1','插件页面已更新。');
  await has(page,'[data-testid="breadcrumbs"]','工作台 / 功能插件');
  assert.deepEqual(errors,[]);assert.equal(await preview.stop(),0);
});

test('explicit external client anchors render without broad filesystem allowance and recover a missing file', {timeout:60000}, async t => {
  const external=await realpath(await mkdtemp(join(tmpdir(),'cormi external 插件-')));
  t.after(()=>rm(external,{recursive:true,force:true}));
  await writeFile(join(external,'plugin.mjs'),'export {};');
  await writeFile(join(external,'runtime.ts'),'export default {setup(){document.documentElement.dataset.externalFeature="ready";return ()=>{delete document.documentElement.dataset.externalFeature}}};');
  await writeFile(join(external,'unimported.ts'),'export const PRIVATE_MARKER="NOT_TO_SERVE";');
  const f=await app(t), {page,errors}=await browser(t);
  await f.write('index.html','<!doctype html><title>cormi external feature</title><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  const from=JSON.stringify(pathToFileURL(join(external,'plugin.mjs')).href);
  await f.write('cormi.config.ts',`import {defineConfig} from 'cormijs';import preset from '@cormijs/preset-react-vite';import {defineReactFeature,clientModule} from '@cormijs/plugin-react';
export default defineConfig({presets:[preset],plugins:[{id:'external',plugin:defineReactFeature({id:'external',routes:[{id:'external-page',path:'external',module:clientModule('./Page.tsx',${from}),meta:{title:'External'}}],runtime:[{id:'external-runtime',module:clientModule('./runtime.ts',${from})}]})}],app:{routes:[],server:{port:0}}});`);
  const dev=cli(t,f.root,'dev',['--startup-timeout','30000']);const ready=await dev.waitFor(e=>e.type==='ready',0,30000);
  assert.equal(ready.applicationStatus,'error');
  await page.goto(new URL('external',ready.url).href);await page.locator('cormi-development-overlay [role=alert]').waitFor();
  await writeFile(join(external,'Page.tsx'),'export default function External(){return <h1>External feature works</h1>}');
  await has(page,'h1','External feature works');
  assert.equal(await page.locator('cormi-development-overlay').count(),0);
  assert.equal(await page.locator('html').getAttribute('data-external-feature'),'ready');
  const blocked=await fetch(new URL('/@fs/'+join(external,'unimported.ts'),ready.url));assert.equal(blocked.status,403);
  assert.equal(dev.events.filter(e=>e.type==='starting').length,1);
  assert.deepEqual(errors,[]);assert.equal(await dev.stop(),0);
  const missingPeer=cli(t,f.root,'typecheck',['--startup-timeout','30000']);
  assert.equal(await missingPeer.finish(30000),1);assert.match(JSON.stringify(missingPeer.events),/TYPECHECK_FAILED/);
  // An external source package must have its own installed peers; the framework must not silently borrow them.
  await symlink(resolve('node_modules'),join(external,'node_modules'),'dir');
  await command(t,f.root,'typecheck');await command(t,f.root,'build');
  const preview=cli(t,f.root,'preview');const serving=await preview.waitFor(e=>e.type==='ready');
  await page.goto(new URL('external',serving.url).href);await has(page,'h1','External feature works');
  assert.deepEqual(errors,[]);assert.equal(await preview.stop(),0);
});
