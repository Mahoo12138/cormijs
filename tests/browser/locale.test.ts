import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { app, cli } from '../launcher-helpers.js';
import { assertPortFree } from '../helpers.js';
import { writeLocaleFixture, verifyLocalePage } from '../../scripts/locale-fixture.js';

async function browser(t: TestContext) {
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'; assert.ok(existsSync(executablePath));
  const instance = await chromium.launch({ executablePath, headless: true }); t.after(() => instance.close());
  const page = await instance.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(12000); return page;
}

test('locale switching, fallback, formatting and persistence work in dev, build and preview', { timeout: 120000 }, async t => {
  const f = await app(t); await writeLocaleFixture(f.root); const page = await browser(t), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '30000']), ready = await dev.waitFor(event => event.type === 'ready', 0, 30000);
  await verifyLocalePage(page, ready.url);
  await page.goto('about:blank'); assert.equal(await dev.stop(), 0); await assertPortFree(Number(new URL(ready.url).port));
  const types = cli(t, f.root, 'typecheck', ['--startup-timeout', '30000']); assert.equal(await types.finish(30000), 0, JSON.stringify(types.events) + types.stderr);
  const build = cli(t, f.root, 'build', ['--startup-timeout', '30000']); assert.equal(await build.finish(30000), 0, JSON.stringify(build.events) + build.stderr);
  const preview = cli(t, f.root, 'preview'), production = await preview.waitFor(event => event.type === 'ready');
  await verifyLocalePage(page, production.url);
  assert.deepEqual(errors, []);
  await page.goto('about:blank'); assert.equal(await preview.stop(), 0);
});
