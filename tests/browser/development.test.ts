import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import { cp, readFile, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, cli } from '../launcher-helpers.js';

async function project(t: TestContext, runtime = "'./src/runtime.tsx'") {
  const f = await app(t);
  await cp(resolve('examples/basic/src'), join(f.root, 'src'), { recursive: true });
  await cp(resolve('examples/basic/index.html'), join(f.root, 'index.html'));
  await f.write('cormi.config.ts', `import { defineConfig } from 'cormijs'; import reactVite from '@cormijs/preset-react-vite';
export default defineConfig({ presets:[reactVite], app:{base:'/demo/',server:{port:0},runtime:[{id:'theme',module:{specifier:${runtime},exportName:'default'}}]} });`);
  return f;
}
async function browser(t: TestContext) {
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.ok(existsSync(executablePath), 'Set CORMI_BROWSER_EXECUTABLE to an installed Chromium-family browser.');
  const instance = await chromium.launch({ executablePath, headless: true }); t.after(() => instance.close());
  const context = await instance.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => { t.diagnostic(`Browser: ${instance.version()}; pageerrors: ${JSON.stringify(errors)}`); });
  return { page, errors };
}
const overlay = (page: Page) => page.locator('cormi-development-overlay');
async function heading(page: Page, text: string) {
  try { await page.waitForFunction(value => document.querySelector('h1')?.textContent?.includes(value), text); }
  catch (cause) { throw new Error(`Expected ${text}; body=${await page.locator('body').innerText()}; overlay=${await overlay(page).locator('.panel').allTextContents()}`, { cause }); }
}
const options = { timeout: 50000 };

test('initial route conflict displays a responsive diagnostic and repairs without restarting the CLI worker', options, async t => {
  const f = await project(t), { page, errors } = await browser(t);
  await f.write('src/pages/about.jsx', 'export default function Duplicate(){return null}');
  const dev = cli(t, f.root, 'dev', ['--startup-timeout','30000']);
  const ready = await dev.waitFor(event => event.type === 'ready', 0, 30000);
  assert.equal(ready.applicationStatus, 'error');
  assert.equal(existsSync(join(f.root, '.cormi/app.tsx')), false);
  await page.goto(new URL('users/73', ready.url).href);
  assert.equal(await page.title(), 'cormi · React example');
  assert.equal(new URL(page.url()).pathname, '/demo/users/73');
  await overlay(page).locator('[role=alert]').waitFor({ state: 'visible' });
  assert.match(await overlay(page).locator('pre').innerText(), /ROUTE_CONFLICT/);
  assert.match(await overlay(page).locator('.hint').innerText(), /no valid application/);
  assert.equal(await page.locator('#root h1').count(), 0);
  if (process.env.CORMI_CAPTURE_SCREENSHOT === '1') await page.screenshot({ path: resolve('.cache/cormi-development-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await overlay(page).locator('.panel').boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 391);
  if (process.env.CORMI_CAPTURE_SCREENSHOT === '1') await page.screenshot({ path: resolve('.cache/cormi-development-mobile.png') });
  await overlay(page).getByRole('button', { name: 'Minimize' }).click();
  await overlay(page).getByRole('button', { name: 'cormi: compilation error' }).click();
  await overlay(page).locator('[role=alert]').waitFor({ state: 'visible' });
  await unlink(join(f.root, 'src/pages/about.jsx'));
  await heading(page, 'User 73'); await overlay(page).waitFor({ state: 'detached' });
  assert.equal(await page.locator('#root header').count(), 1, 'recovery must mount one application layout');
  assert.equal(await page.locator('#root [data-provider="example"]').count(), 1);
  assert.equal(await page.locator('#root footer').innerText(), 'Plugins compose the application. The kernel stays small.');
  if (process.env.CORMI_CAPTURE_SCREENSHOT === '1') {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Capture after the resized viewport has completed layout/paint, not during a compositor transition.
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    assert.equal(await page.locator('#root header').count(), 1);
    await page.screenshot({ path: resolve('.cache/cormi-development-recovered.png') });
  }
  assert.equal(dev.events.filter(event => event.type === 'starting').length, 1);
  assert.deepEqual(errors, []); assert.equal(await dev.stop(), 0);
});
test('cold-start failure never runs an old disk entry and repairs even when generated output is unchanged', options, async t => {
  const f = await project(t), { page, errors } = await browser(t);
  const prepare = cli(t, f.root, 'prepare');
  assert.equal(await prepare.finish(), 0, JSON.stringify(prepare.events) + prepare.stderr);
  const file = join(f.root, '.cormi/app.tsx'), old = await readFile(file, 'utf8'), time = (await stat(file)).mtimeMs;
  const manifest = await readFile(join(f.root, '.cormi/inspect.jsonc'), 'utf8');
  await f.write('src/pages/about.jsx', 'export default ()=>null');
  const dev = cli(t, f.root, 'dev'); const ready = await dev.waitFor(event => event.type === 'ready');
  assert.equal(ready.applicationStatus, 'error');
  await page.goto(ready.url); await overlay(page).locator('[role=alert]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#root h1').count(), 0, 'old output is not current-session readiness');
  assert.equal(await readFile(file, 'utf8'), old);
  assert.equal(await readFile(join(f.root, '.cormi/inspect.jsonc'), 'utf8'), manifest);
  await unlink(join(f.root, 'src/pages/about.jsx'));
  await heading(page, 'cormi is running.'); await overlay(page).waitFor({ state: 'detached' });
  assert.equal((await stat(file)).mtimeMs, time);
  await page.locator('#root button').click(); assert.match(await page.locator('#root button').innerText(), /Count: 1/);
  assert.equal(dev.events.filter(event => event.type === 'starting').length, 1);
  assert.deepEqual(errors, []); assert.equal(await dev.stop(), 0);
});

test('live route conflicts preserve the rendered app and state, replay to fresh tabs, and clear on repair', options, async t => {
  const f = await project(t), { page } = await browser(t);
  const dev = cli(t, f.root, 'dev'); const ready = await dev.waitFor(event => event.type === 'ready');
  await page.goto(ready.url); await heading(page, 'cormi is running.');
  await page.locator('#root button').click(); await page.locator('#root button').click();
  const entry = join(f.root, '.cormi/app.tsx'), before = await readFile(entry, 'utf8'), time = (await stat(entry)).mtimeMs;
  await f.write('src/pages/about.jsx', 'export default ()=>null');
  await overlay(page).locator('[role=alert]').waitFor({ state: 'visible' });
  assert.match(await page.locator('#root button').innerText(), /Count: 2/);
  assert.equal(await readFile(entry, 'utf8'), before);
  const second = await page.context().newPage(); await second.goto(ready.url);
  await overlay(second).locator('[role=alert]').waitFor({ state: 'visible' });
  assert.match(await overlay(second).locator('pre').innerText(), /about\.jsx/);
  await unlink(join(f.root, 'src/pages/about.jsx'));
  await overlay(page).waitFor({ state: 'detached' }); await overlay(second).waitFor({ state: 'detached' });
  assert.match(await page.locator('#root button').innerText(), /Count: 2/);
  assert.equal((await stat(entry)).mtimeMs, time); await second.close(); assert.equal(await dev.stop(), 0);
});
test('missing runtime module is recoverable from a cold start without configuration changes', options, async t => {
  const f = await project(t, "'./src/later.ts'"), { page } = await browser(t);
  const dev = cli(t, f.root, 'dev'); const ready = await dev.waitFor(event => event.type === 'ready');
  assert.equal(ready.applicationStatus, 'error'); await page.goto(ready.url);
  await overlay(page).locator('[role=alert]').waitFor({ state: 'visible' });
  assert.match(await overlay(page).locator('pre').innerText(), /ENOENT/);
  await f.write('src/later.ts', 'export default {};');
  await heading(page, 'cormi is running.'); await overlay(page).waitFor({ state: 'detached' });
  assert.equal(dev.events.filter(event => event.type === 'starting').length, 1); assert.equal(await dev.stop(), 0);
});
test('diagnostic text is not HTML and hook exceptions do not expose private values to browser clients', options, async t => {
  const f = await project(t), { page, errors } = await browser(t);
  const config = await readFile(join(f.root, 'cormi.config.ts'), 'utf8');
  await f.write('cormi.config.ts', config.replace('presets:[reactVite]', `presets:[reactVite],plugins:[{id:'fault',plugin:{inject:['react'],apply(ctx){ctx.effect(()=>ctx.react.routes.tap({id:'<img src=x onerror=globalThis.cormiInjected=1>',owner:'local',ownerOrder:0,run(){throw new Error('PRIVATE_SENTINEL_82093')}}));}}}]`));
  const dev = cli(t, f.root, 'dev'); const ready = await dev.waitFor(event => event.type === 'ready');
  await page.goto(ready.url); await overlay(page).locator('[role=alert]').waitFor({ state: 'visible' });
  const text = await overlay(page).locator('pre').innerText(); assert.match(text, /<img src=x/);
  assert.equal(await overlay(page).locator('img').count(), 0);
  assert.equal(await page.evaluate(() => (globalThis as any).cormiInjected), undefined);
  const response = await fetch(new URL('@id/__x00__cormi:development-client', ready.url));
  assert.doesNotMatch(await response.text(), /PRIVATE_SENTINEL_82093/);
  assert.deepEqual(errors, []); assert.equal(await dev.stop(), 0);
});
test('development diagnostics are absent from production HTML and JavaScript assets', options, async t => {
  const f = await project(t);
  const build = cli(t, f.root, 'build', ['--startup-timeout','30000']);
  assert.equal(await build.finish(30000), 0, JSON.stringify(build.events) + build.stderr);
  const files: string[] = [join(f.root, 'dist/index.html')];
  for (const name of await readdir(join(f.root, 'dist/assets'))) if (name.endsWith('.js')) files.push(join(f.root, 'dist/assets', name));
  for (const file of files) assert.doesNotMatch(await readFile(file, 'utf8'), /cormi-development-overlay|cormi:development-client|cormi:development:state/);
});
