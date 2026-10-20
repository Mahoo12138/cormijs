import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { app, cli } from '../launcher-helpers.js';
import { assertPortFree } from '../helpers.js';
import { writeConfigRoutesFixture, verifyConfigRoutesPage } from '../../scripts/config-routes-fixture.js';
const expected = /member exploded|The above error occurred|React Router caught/;
async function browser(t: TestContext) {
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'; assert.ok(existsSync(executablePath));
  const b = await chromium.launch({ executablePath, headless: true }); t.after(() => b.close());
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(12000); return page;
}
test('nested configured routes drive dev, typecheck, build and preview with params and error boundaries', { timeout: 120000 }, async t => {
  const f = await app(t); await writeConfigRoutesFixture(f.root); const page = await browser(t), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !expected.test(message.text())) errors.push(message.text()); });
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '30000']), ready = await dev.waitFor(e => e.type === 'ready', 0, 30000);
  await verifyConfigRoutesPage(page, ready.url);
  await mkdir(resolve('.cache'), { recursive: true }); await page.screenshot({ path: resolve('.cache/f1c-config-routes-dev.png') });
  await page.getByRole('navigation').getByRole('link', { name: 'About', exact: true }).click();
  await page.getByRole('heading', { name: 'About config', exact: true }).waitFor();
  const about = join(f.root, 'src/pages/About.tsx'), original = await readFile(about, 'utf8');
  await writeFile(about, original.replace('About config', 'About edited')); await page.getByRole('heading', { name: 'About edited', exact: true }).waitFor();
  await writeFile(about, original); await page.getByRole('heading', { name: 'About config', exact: true }).waitFor();
  assert.equal(dev.events.filter(e => e.type === 'starting').length, 1);
  await page.goto('about:blank'); assert.equal(await dev.stop(), 0); await assertPortFree(Number(new URL(ready.url).port));
  const types = cli(t, f.root, 'typecheck', ['--startup-timeout', '30000']); assert.equal(await types.finish(30000), 0, JSON.stringify(types.events) + types.stderr);
  const build = cli(t, f.root, 'build', ['--startup-timeout', '30000']); assert.equal(await build.finish(30000), 0, JSON.stringify(build.events) + build.stderr);
  const built = await readFile(join(f.root, '.cormi/app.tsx'), 'utf8');
  const preview = cli(t, f.root, 'preview'), production = await preview.waitFor(e => e.type === 'ready');
  await verifyConfigRoutesPage(page, production.url);
  await page.screenshot({ path: resolve('.cache/f1c-config-routes-preview.png') });
  assert.equal(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), built);
  assert.deepEqual(errors, []); await page.goto('about:blank'); assert.equal(await preview.stop(), 0);
});
