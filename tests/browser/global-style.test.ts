import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, cli } from '../launcher-helpers.js';
import { assertPortFree } from '../helpers.js';
import { writeGlobalStyleFixture, verifyGlobalStylePage } from '../../scripts/global-style-fixture.js';

async function browser(t: TestContext) {
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'; assert.ok(existsSync(executablePath));
  const instance = await chromium.launch({ executablePath, headless: true }); t.after(() => instance.close());
  const page = await instance.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(12000); return page;
}

const globalCss = ':root { --cormi-band: rgb(37, 99, 128); }\n[data-global-band] { background-color: var(--cormi-band); padding: 4px 8px; border-radius: 6px; color: rgb(255, 255, 255); }\n';

test('the global stylesheet convention applies in dev, typecheck, build and preview', { timeout: 150000 }, async t => {
  const f = await app(t); await writeGlobalStyleFixture(f.root); const page = await browser(t), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '30000']), ready = await dev.waitFor(event => event.type === 'ready', 0, 30000);
  await verifyGlobalStylePage(page, ready.url);
  await page.goto('about:blank'); assert.equal(await dev.stop(), 0); await assertPortFree(Number(new URL(ready.url).port));
  const types = cli(t, f.root, 'typecheck', ['--startup-timeout', '30000']); assert.equal(await types.finish(30000), 0, JSON.stringify(types.events) + types.stderr);
  const build = cli(t, f.root, 'build', ['--startup-timeout', '30000']); assert.equal(await build.finish(30000), 0, JSON.stringify(build.events) + build.stderr);
  const preview = cli(t, f.root, 'preview'), production = await preview.waitFor(event => event.type === 'ready');
  await verifyGlobalStylePage(page, production.url);
  assert.deepEqual(errors, []);
  await page.goto('about:blank'); assert.equal(await preview.stop(), 0);
});

test('creating src/global.css during dev regenerates the entry and styles the page', { timeout: 150000 }, async t => {
  const f = await app(t); await writeGlobalStyleFixture(f.root);
  await writeFile(join(f.root, 'src/global.css'), '/* placeholder without the rule */\n');
  const page = await browser(t);
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '30000']), ready = await dev.waitFor(event => event.type === 'ready', 0, 30000);
  await page.goto(ready.url); await page.getByRole('heading', { name: 'Global style home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-global-band]').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
  await writeFile(join(f.root, 'src/global.css'), globalCss);
  let painted = 'rgba(0, 0, 0, 0)';
  for (let attempt = 0; attempt < 40 && painted !== 'rgb(37, 99, 128)'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    await page.reload(); painted = await page.locator('[data-global-band]').evaluate(element => getComputedStyle(element).backgroundColor);
  }
  assert.equal(painted, 'rgb(37, 99, 128)');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
  await page.goto('about:blank'); assert.equal(await dev.stop(), 0);
});
