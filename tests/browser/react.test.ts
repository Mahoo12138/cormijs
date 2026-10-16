import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import { cp, readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, cli } from '../launcher-helpers.js';
import { assertPortFree } from '../helpers.js';

async function browser(t: TestContext) {
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.ok(existsSync(executablePath), 'Set CORMI_BROWSER_EXECUTABLE to a Chromium-family browser executable.');
  const instance = await chromium.launch({ executablePath, headless: true });
  t.after(() => instance.close()); t.diagnostic(`Browser: ${instance.version()}`);
  const page = await instance.newPage(); page.setDefaultTimeout(10000);
  return page;
}
async function project(t: TestContext) {
  const f = await app(t);
  await cp(resolve('examples/basic/src'), join(f.root, 'src'), { recursive: true });
  await cp(resolve('examples/basic/index.html'), join(f.root, 'index.html'));
  await f.write('cormi.config.ts', `import { defineConfig } from 'cormijs'; import reactVite from '@cormijs/preset-react-vite';
export default defineConfig({ presets:[reactVite], app:{base:'/demo/', server:{port:0}, runtime:[{id:'theme',module:{specifier:'./src/runtime.tsx',exportName:'default'}}]} });`);
  return f;
}
async function text(page: Page, selector: string, expected: string) {
  try {
    await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent?.includes(expected), { selector, expected });
  } catch (cause) { throw new Error(`Expected ${selector} to contain ${expected}; body: ${await page.locator('body').innerText()}`, { cause }); }
}
async function generated(file: string, contains: string, present = true) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if ((await readFile(file, 'utf8')).includes(contains) === present) return;
    await delay(30);
  }
  throw new Error(`Expected generation ${present ? 'with' : 'without'} ${contains}`);
}

test('actual React rendering, nested routing and deep reload work under a base path', { timeout: 45000 }, async t => {
  const f = await project(t), page = await browser(t), failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '30000']);
  const ready = await dev.waitFor(event => event.type === 'ready', 0, 30000);
  await page.goto(ready.url); await text(page, 'h1', 'cormi is running.');
  assert.equal(await page.locator('[data-provider="example"]').count(), 1);
  if (process.env.CORMI_CAPTURE_SCREENSHOT === '1') {
    await mkdir(resolve('.cache'), { recursive: true });
    await page.screenshot({ path: resolve('.cache/cormi-react-example.png'), fullPage: true });
  }
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click(); await text(page, 'button', 'Count: 1');
  await page.getByRole('link', { name: '动态路由', exact: true }).click(); await text(page, 'h1', 'User 42');
  assert.equal(await page.locator('[data-layout="users"]').count(), 1);
  await page.reload(); await text(page, 'h1', 'User 42');
  await page.goto(new URL('docs/a/b', ready.url).href); await text(page, '[data-testid="splat"]', 'a/b');
  await page.goto(new URL('missing', ready.url).href); await text(page, 'h1', '404');
  assert.deepEqual(failures, []);
  await page.close(); assert.equal(await dev.stop(), 0); await assertPortFree(Number(new URL(ready.url).port));
});

test('Fast Refresh retains counter state and route structure changes regenerate the entry', { timeout: 45000 }, async t => {
  const f = await project(t), page = await browser(t);
  const messages: string[] = [];
  page.on('console', message => messages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', error => messages.push(`pageerror: ${error.message}`));
  t.after(() => { t.diagnostic(messages.join('\n').slice(-6000)); });
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '30000']);
  const ready = await dev.waitFor(event => event.type === 'ready', 0, 30000);
  await page.goto(ready.url); await text(page, 'h1', 'cormi is running.');
  await page.locator('button').click(); await page.locator('button').click(); await text(page, 'button', 'Count: 2');
  const home = join(f.root, 'src/pages/index.tsx');
  await writeFile(home, (await readFile(home, 'utf8')).replace('cormi is running.', 'cormi updated.'));
  await text(page, 'h1', 'cormi updated.'); await text(page, 'button', 'Count: 2');
  const added = join(f.root, 'src/pages/added.tsx'), entry = join(f.root, '.cormi/app.tsx');
  await writeFile(added, 'export default function Added(){return <h1>Added route</h1>}');
  await generated(entry, 'added.tsx');
  await page.goto(new URL('added', ready.url).href); await text(page, 'h1', 'Added route');
  const good = await readFile(entry, 'utf8');
  await writeFile(join(f.root, 'src/pages/added.jsx'), 'export default function Conflict(){return <h1>Conflict</h1>}');
  await delay(600); assert.equal(await readFile(entry, 'utf8'), good);
  await unlink(join(f.root, 'src/pages/added.jsx')); await unlink(added);
  await generated(entry, 'added.tsx', false);
  await page.goto(new URL('added', ready.url).href); await text(page, 'h1', '404');
  assert.equal(await dev.stop(), 0);
});

test('built React assets render in preview and preview does not regenerate deleted source pages', { timeout: 45000 }, async t => {
  const f = await project(t), page = await browser(t);
  const build = cli(t, f.root, 'build', ['--startup-timeout', '30000']);
  assert.equal(await build.finish(30000), 0, JSON.stringify(build.events) + build.stderr);
  const generatedFile = join(f.root, '.cormi/app.tsx'), before = await stat(generatedFile);
  await unlink(join(f.root, 'src/pages/users/[id].tsx'));
  const preview = cli(t, f.root, 'preview'); const ready = await preview.waitFor(event => event.type === 'ready');
  await page.goto(new URL('users/73', ready.url).href); await text(page, 'h1', 'User 73');
  assert.equal((await stat(generatedFile)).mtimeMs, before.mtimeMs);
  await page.goto(ready.url); await text(page, 'h1', 'cormi is running.');
  await page.locator('button').click(); await text(page, 'button', 'Count: 1');
  assert.equal(await preview.stop(), 0);
});

test('runtime providers compose in order, repeated disposal is idempotent, and failed setup rolls back acquired effects', { timeout: 45000 }, async t => {
  const f = await project(t), page = await browser(t);
  await f.write('runtime-harness.ts', `
import { createElement } from 'react';
import { mountApplication } from '@cormijs/runtime';
export async function exercise() {
  const trace = [], aborted = [], element = document.createElement('div'); document.body.append(element);
  const plugin = name => ({
    Provider: ({children}) => createElement('div', {'data-runtime-provider': name}, children),
    async setup({signal}) { trace.push(name+':setup'); return () => { trace.push(name+':dispose'); aborted.push(signal.aborted); }; }
  });
  const options = { element, base:'/demo/', routes:[{id:'probe',path:'*',Component:()=>createElement('p',null,'runtime probe')}],
    plugins:[{id:'outer',plugin:plugin('outer')},{id:'inner',plugin:plugin('inner')}] };
  const handle = await mountApplication(options);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const nested = !!element.querySelector('[data-runtime-provider="outer"] [data-runtime-provider="inner"]');
  await Promise.all([handle.dispose(),handle.dispose()]); const empty = element.textContent === '';
  let failure = '';
  try { await mountApplication({...options, plugins:[{id:'first',plugin:plugin('first')},{id:'broken',plugin:{setup(){throw new Error('setup failure')}}}]}); }
  catch (error) { failure=error.message; }
  element.remove(); return {trace,aborted,nested,empty,failure};
}`);
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '30000']);
  const ready = await dev.waitFor(event => event.type === 'ready', 0, 30000);
  await page.goto(ready.url); await text(page, 'h1', 'cormi is running.');
  const result = await page.evaluate('import(' + JSON.stringify(new URL('runtime-harness.ts', ready.url).href) + ').then(module=>module.exercise())');
  assert.deepEqual(result, {trace:['outer:setup','inner:setup','inner:dispose','outer:dispose','first:setup','first:dispose'],aborted:[true,true,true],nested:true,empty:true,failure:'setup failure'});
  assert.equal(await dev.stop(), 0);
});
