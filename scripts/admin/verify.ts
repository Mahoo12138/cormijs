import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { adminModules, type Observation } from './modules.js';
import { headerModules } from './header-contracts.js';
import { chartModules } from './chart-contracts.js';

// No Browser skill/runtime is listed in this session. Use the existing isolated Playwright dependency.
async function visualReady(page: import('playwright-core').Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // Observe real geometry/paths through paint frames. Network-idle alone does not finish chart animation.
  await page.evaluate(async () => {
    const until = performance.now() + 12000; let previous = '', stable = 0;
    for (;;) {
      await new Promise<void>(accept => requestAnimationFrame(() => accept()));
      const elements = [...document.querySelectorAll('main,header,.apexcharts-canvas,.apexcharts-series path')];
      const signature = JSON.stringify(elements.map(element => {
        const rect = element.getBoundingClientRect();
        return [Math.round(rect.x * 10), Math.round(rect.y * 10), Math.round(rect.width * 10), Math.round(rect.height * 10), element.getAttribute('d')];
      }));
      stable = signature === previous ? stable + 1 : 0; previous = signature;
      if (stable >= 8) return;
      if (performance.now() > until) throw new Error('Layout/chart paint did not settle');
    }
  });
}
async function layoutGeometry(page: import('playwright-core').Page) {
  return page.evaluate(() => {
    const wrapper = document.querySelector('.minimal__layout__sidebar__container');
    const main = document.querySelector('main'), header = document.querySelector('header');
    return { width: innerWidth, mainX: main?.getBoundingClientRect().x ?? null,
      headerX: header?.getBoundingClientRect().x ?? null,
      sidebarPadding: wrapper ? Number.parseFloat(getComputedStyle(wrapper).paddingLeft) : null };
  });
}

const { values } = parseArgs({ options: { app: { type: 'string' }, kind: { type: 'string' }, command: { type: 'string' }, base: { type: 'string' }, out: { type: 'string' }, suite: { type: 'string' } }, strict: true });
assert.ok(values.app && values.out, 'Required: --app <independent app> --out <new evidence directory>');
const app = await realpath(values.app), out = resolve(values.out), kind = values.kind ?? 'upstream', command = values.command ?? 'dev';
assert.ok(['upstream', 'cormi'].includes(kind)); assert.ok(['dev', 'preview'].includes(command));
const suite = values.suite ?? 'modules';
assert.ok(['modules', 'business', 'header-original', 'header-fixed', 'charts'].includes(suite), 'Unknown Admin suite');
const modules = suite === 'modules' ? adminModules : suite === 'business' ? adminModules.filter(module => module.id !== 'AM03') : suite === 'charts' ? chartModules : headerModules(suite === 'header-fixed');
assert.ok(!existsSync(out), 'Evidence output must be a new directory'); await mkdir(out, { recursive: true });
const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
assert.ok(existsSync(executablePath), 'An installed Chromium browser is required');
const args = kind === 'upstream'
  ? [join(app, 'node_modules/vite/bin/vite.js'), ...(command === 'preview' ? ['preview'] : []), '--host', '127.0.0.1', '--port', '0', '--strictPort']
  : [join(app, 'node_modules/cormijs/dist/cli.js'), command, '--json', '--startup-timeout', '60000'];
const child = spawn(process.execPath, args, { cwd: app, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', address = '', ended = false;
const done = new Promise<{code:number|null;signal:NodeJS.Signals|null}>((accept, reject) => {
  child.once('error', reject); child.once('close', (code, signal) => { ended = true; accept({code, signal}); });
});
void done.catch(() => {});
child.stdout.on('data', chunk => {
  const text = String(chunk).replace(/\u001b\[[0-9;]*m/g, ''); log += text;
  if (kind === 'upstream') address ||= /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0] ?? '';
  else for (const line of log.split('\n')) { try { const event = JSON.parse(line); if (event.type === 'ready') address = event.url; } catch {} }
});
child.stderr.on('data', chunk => { log += String(chunk); });
const report: { app:string;kind:string;command:string;url?:string;browser?:string;modules:Array<Record<string,unknown>>;passed:boolean;fatal?:string;cleanup?:unknown } = { app, kind, command, modules: [], passed:false };
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const deadline = Date.now() + 60000;
  while (!address && !ended && Date.now() < deadline) await delay(50);
  assert.ok(address, 'Server did not become ready: ' + log.slice(-8000));
  const base = new URL(values.base ?? '/', address).href; report.url = base;
  browser = await chromium.launch({ executablePath, headless:true }); report.browser = browser.version();
  for (const module of modules) {
    const page = await browser.newPage({ viewport: { width:1440, height:1000 } }); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(25000);
    const observations: Observation[] = [], errors: string[] = [], consoleErrors: string[] = [], consoleWarnings: string[] = [], failedResources: unknown[] = [], external: string[] = [];
    const item: Record<string, unknown> = { id: module.id, title: module.title, observations, errors, consoleErrors, consoleWarnings, failedResources, external, passed:false };
    report.modules.push(item);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      const line = message.text() + ' @' + message.location().url;
      if (message.type() === 'error') consoleErrors.push(line);
      else if (message.type() === 'warning') consoleWarnings.push(line);
    });
    page.on('response', response => { if (response.status() >= 400) failedResources.push({url:response.url(),status:response.status()}); });
    page.on('requestfailed', request => { failedResources.push({url:request.url(),error:request.failure()?.errorText}); });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['data:','blob:'].includes(url.protocol) || url.origin === new URL(base).origin && url.pathname.startsWith(new URL(base).pathname)) await route.continue();
      else { external.push(url.origin + url.pathname); await route.abort('blockedbyclient'); }
    });
    try {
      const url = new URL(module.path, base).href; await page.goto(url);
      await page.getByRole('heading', {name:module.heading}).first().waitFor();
      assert.equal(new URL(page.url()).pathname, new URL(url).pathname); item.titleObserved = await page.title();
      assert.match(item.titleObserved as string, /Minimal|cormi/i);
      assert.equal(await page.locator('vite-error-overlay,cormi-development-overlay').count(), 0);
      await page.waitForLoadState('networkidle');
      if (module.id === 'AM04') await page.waitForFunction(() => document.querySelectorAll('.apexcharts-canvas').length === 8);
      await visualReady(page);
      const geometry = await layoutGeometry(page); item.desktopGeometry = geometry;
      if (geometry.sidebarPadding !== null) {
        assert.equal(geometry.sidebarPadding, 300); assert.equal(geometry.mainX, 300);
      }
      // Full-page capture changed the original responsive layout during capture; use fixed viewport evidence.
      await page.screenshot({ path:join(out, module.id + '-desktop.png'), fullPage:false });
      assert.deepEqual(await layoutGeometry(page), geometry, 'Screenshot must not change the measured layout');
      await module.verify({page,base,record:(check,value)=>observations.push({check,value}), capture: async name => {
         assert.ok(/^[a-z0-9-]+$/.test(name)); await page.evaluate(() => document.fonts.ready);
         await page.screenshot({path:join(out,module.id+'-'+name+'.png'),fullPage:false});
       }});
      await page.waitForLoadState('networkidle');
      await page.goto(url); await page.getByRole('heading', {name:module.heading}).first().waitFor();
      if (module.id === 'AM04') await page.waitForFunction(() => document.querySelectorAll('.apexcharts-canvas').length === 8);
      await page.waitForLoadState('networkidle');
      await page.reload(); await page.getByRole('heading', {name:module.heading}).first().waitFor();
      if (module.id === 'AM04') await page.waitForFunction(() => document.querySelectorAll('.apexcharts-canvas').length === 8);
      await page.waitForLoadState('networkidle');
      observations.push({check:'deep-reload',value:true});
      await page.setViewportSize({width:390,height:844}); await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
      item.viewportOverflow = await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      await visualReady(page);
      item.mobileGeometry = await layoutGeometry(page);
      await page.screenshot({path:join(out,module.id+'-mobile.png'),fullPage:false});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'Mobile viewport overflows');
      const images = await page.locator('img').evaluateAll(nodes=>nodes.filter((node):node is HTMLImageElement=>node instanceof HTMLImageElement).map(image=>({src:image.currentSrc,complete:image.complete,width:image.naturalWidth,loading:image.loading})));
      item.images = images; assert.equal(images.filter(image=>image.complete && image.width===0 && image.src).length,0,'Broken image');
      assert.equal(errors.length,0,errors.join('\n')); assert.equal(consoleErrors.length,0,consoleErrors.join('\n')); assert.equal(failedResources.length,0,JSON.stringify(failedResources));
      item.passed = true;
    } catch (error) {
      item.failure = error instanceof Error ? error.message : String(error);
      await writeFile(join(out,module.id+'-failure-dom.txt'),await page.locator('body').innerText().catch(()=>''));
      await page.screenshot({path:join(out,module.id+'-failure.png'),fullPage:true}).catch(()=>{});
    } finally { await page.close(); }
    console.log(JSON.stringify({id:module.id,passed:item.passed,failure:item.failure,observations:observations.length}));
    await writeFile(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
  }
  report.passed = report.modules.length === modules.length && report.modules.every(item=>item.passed);
} catch (error) { report.fatal = error instanceof Error ? error.message : String(error); }
finally {
  try { await browser?.close(); }
  catch (error) { report.passed = false; report.fatal = 'Browser cleanup failed: ' + String(error); }
  const stopRequested = !ended;
  if (stopRequested) child.kill('SIGTERM');
  let timer: NodeJS.Timeout | undefined;
  try {
    const exit = await Promise.race([done,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned server cleanup timed out')),10000);})]);
    report.cleanup = { ...exit, stopRequested };
    // Locked upstream Vite 6 closes its server and exits with 128+SIGTERM (143).
    // This is not the cormi CLI contract: only our explicitly requested upstream stop admits it.
    const accepted = kind === 'cormi' ? exit.code === 0 && exit.signal === null
      : stopRequested && (exit.code === 0 || exit.code === 143 && exit.signal === null || exit.signal === 'SIGTERM');
    if (!accepted) report.passed = false;
    if (address) {
      const socket = createServer();
      await new Promise<void>((accept, reject) => {
        socket.once('error', reject);
        socket.listen(Number(new URL(address).port), '127.0.0.1', () => socket.close(error => error ? reject(error) : accept()));
      });
      report.cleanup = { ...exit, stopRequested, portRebound: true };
    }
  }
  catch(error) {
    report.passed=false; report.cleanup={error:String(error),stopRequested};
    if(!ended) {
      child.kill('SIGKILL'); clearTimeout(timer);
      try { await Promise.race([done,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned server termination unconfirmed')),3000);})]); }
      catch(termination) { report.fatal=String(termination); }
    }
  }
  finally { clearTimeout(timer); }
  await writeFile(join(out,'server.log'),log); await writeFile(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,modules:report.modules.length,out}));
  if(!report.passed)process.exitCode=1;
}
