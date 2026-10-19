import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { templateFiles } from '../../packages/create/src/templates.js';
import { app, cli } from '../launcher-helpers.js';
import { assertPortFree } from '../helpers.js';

// Real HTTP: invalid response -> retry -> a pending handler -> route unmount -> cancellation -> fresh request.
test('application Mock example validates payloads retries and cancels the real request when its page unmounts', { timeout: 60000 }, async t => {
  const f = await app(t), files = templateFiles('react-api');
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(f.root, path)), { recursive: true }); await writeFile(join(f.root, path), text); }
  await f.write('cormi.config.ts', files['cormi.config.ts']!.replace("const base = '/';", "const base = '/app/';").replace('port: 8000', 'port: 0'));
  await f.write('src/pages/_layout.tsx', "import {Link,Outlet} from 'react-router';export default function Layout(){return <><Link to='/'>首页</Link><Link to='/other'>其他页面</Link><Outlet/></>}");
  await f.write('src/pages/other.tsx', 'export default function Other(){return <h1>其他页面</h1>}');
  await f.write('mock.ts', `import {appendFile} from 'node:fs/promises';import type {MockRule} from '@cormijs/plugin-dev-api';
let count=0;
export const mocks:readonly MockRule[]=[{method:'GET',path:'/hello',async handle({signal}){
 const current=++count;await appendFile('api-events.log','start:'+current+'\\n');
 if(current===1)return {body:{message:7}};
 if(current===3){await new Promise<void>(resolve=>{signal.addEventListener('abort',()=>resolve(),{once:true});if(signal.aborted)resolve()});await appendFile('api-events.log','cancelled:3\\n');}
 return {body:{message:'response:'+current}};
}}];`);
  const browser = await chromium.launch({ executablePath: process.env.CORMI_BROWSER ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
  t.after(() => browser.close()); const page = await browser.newPage(); page.setDefaultTimeout(12000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  const dev = cli(t, f.root, 'dev'); const ready = await dev.waitFor(e => e.type === 'ready');
  await page.goto(ready.url); assert.equal(page.url(), ready.url); assert.equal(await page.title(), 'cormi app');
  const action = page.getByRole('button', { name: '请求 Mock', exact: true });
  await action.click(); await page.locator('output').filter({ hasText: 'Invalid API response' }).waitFor();
  assert.ok(await action.isEnabled()); await action.click(); await page.locator('output').filter({ hasText: 'response:2' }).waitFor();
  await action.click(); await page.getByRole('button', { name: '请求中…', exact: true }).waitFor();
  async function waitLog(value: string) { const until = Date.now() + 10000; while (Date.now() < until) {
    if ((await readFile(join(f.root, 'api-events.log'), 'utf8')).includes(value)) return; await delay(20);
  } throw new Error('Missing API lifecycle marker: ' + value); }
  await waitLog('start:3'); const documentId = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole('link', { name: '其他页面', exact: true }).click(); await page.getByRole('heading', { name: '其他页面', exact: true }).waitFor();
  await waitLog('cancelled:3'); assert.equal(await page.evaluate(() => performance.timeOrigin), documentId);
  await page.getByRole('link', { name: '首页', exact: true }).click(); await page.locator('output').filter({ hasText: '尚未请求' }).waitFor();
  await action.click(); await page.locator('output').filter({ hasText: 'response:4' }).waitFor();
  assert.equal(dev.events.filter(e => e.type === 'starting').length, 1);
  assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(), 0); assert.deepEqual(errors, []);
  await page.close(); assert.equal(await dev.stop(), 0); await assertPortFree(Number(new URL(ready.url).port));
});
