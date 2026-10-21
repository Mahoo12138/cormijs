import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, cli } from '../launcher-helpers.js';
import { assertPortFree } from '../helpers.js';
import { writeSsrFixture, verifySsrPage } from '../../scripts/ssr-fixture.js';

async function browser(t: TestContext) {
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'; assert.ok(existsSync(executablePath));
  const instance = await chromium.launch({ executablePath, headless: true }); t.after(() => instance.close());
  const page = await instance.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(12000); return page;
}

test('SSR renders routes and loader data in preview and hydrates without errors', { timeout: 180000 }, async t => {
  const f = await app(t); await writeSsrFixture(f.root); const page = await browser(t), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '30000']), ready = await dev.waitFor(event => event.type === 'ready', 0, 30000);
  const devHome = await page.request.get(ready.url, { headers: { accept: 'text/html' } });
  assert.equal(devHome.status(), 200);
  assert.match(await devHome.text(), /<div id="root"><main><h1>SSR home<\/h1>/);
  const devBackend = await page.request.get(new URL('backend/7', ready.url).href, { headers: { accept: 'text/html' } });
  assert.equal(devBackend.status(), 200);
  assert.match(await devBackend.text(), /server loader(?:<!-- -->)?:(?:<!-- -->)?7(?:<!-- -->)?:(?:<!-- -->)?\/ssr\/backend\/7/);
  await page.goto(ready.url); await page.getByRole('heading', { name: 'SSR home', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Backend', exact: true }).click();
  await page.getByRole('heading', { name: 'SSR backend', exact: true }).waitFor();
  assert.equal(await page.locator('[data-server-loader]').innerText(), 'server loader:7:/ssr/backend/7');
  assert.deepEqual(errors, []);
  await page.goto('about:blank'); assert.equal(await dev.stop(), 0, JSON.stringify(dev.events) + dev.stderr); await assertPortFree(Number(new URL(ready.url).port));
  const types = cli(t, f.root, 'typecheck', ['--startup-timeout', '30000']); assert.equal(await types.finish(30000), 0, JSON.stringify(types.events) + types.stderr);
  const build = cli(t, f.root, 'build', ['--startup-timeout', '30000']); assert.equal(await build.finish(60000), 0, JSON.stringify(build.events) + build.stderr);
  assert.ok(existsSync(join(f.root, 'dist/.cormi/ssr/ssr.mjs')));
  assert.ok((await readdir(join(f.root, 'dist/assets'))).filter(name => name.endsWith('.js')).length >= 2, 'pages stay in separate chunks');
  assert.match(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), /lazy:async\(\)=>/);
  assert.match(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), /loader:serverLoaderOf\("backend","\/ssr\/"\)/);
  const serverEntry = await readFile(join(f.root, '.cormi/server-loaders.tsx'), 'utf8');
  assert.match(serverEntry, /src\/pages\/backend\.tsx/);
  assert.match(await readFile(join(f.root, 'dist/.cormi/ssr/ssr.mjs'), 'utf8'), /server loader/);
  const clientSources = await Promise.all((await readdir(join(f.root, 'dist/assets'))).filter(name => name.endsWith('.js'))
    .map(name => readFile(join(f.root, 'dist/assets', name), 'utf8')));
  assert.ok(clientSources.some(source => source.includes('.cormi/server-loader')), 'client navigation uses the fallback endpoint');
  const statusPage = await readFile(join(f.root, 'dist/status/index.html'), 'utf8');
  assert.match(statusPage, /<h1>SSR status<\/h1>/);
  assert.match(statusPage, /data-status="true">\/ssr\/status</);
  assert.match(statusPage, /__staticRouterHydrationData/);
  assert.match(statusPage, /<title>SSR status page · demo<\/title>/);
  assert.match(await readFile(join(f.root, 'dist/index.html'), 'utf8'), /<h1>SSR home<\/h1>/);
  assert.match(await readFile(join(f.root, 'dist/index.html'), 'utf8'), /<title>Helmet home title · demo<\/title>/);
  assert.match(await readFile(join(f.root, 'dist/guide/index.html'), 'utf8'), /data-guide="true">loaded on server</);
  const sitemap = await readFile(join(f.root, 'dist/sitemap.xml'), 'utf8');
  for (const url of ['https://example.com/ssr/', 'https://example.com/ssr/guide', 'https://example.com/ssr/status']) assert.ok(sitemap.includes(`<loc>${url}</loc>`), url);
  assert.doesNotMatch(sitemap, /backend/);
  assert.match(await readFile(join(f.root, 'dist/.cormi/shell.html'), 'utf8'), /<div id="root"><\/div>/);
  const preview = cli(t, f.root, 'preview'), production = await preview.waitFor(event => event.type === 'ready');
  await verifySsrPage(page, production.url);
  assert.deepEqual(errors, []);
  await page.goto('about:blank'); assert.equal(await preview.stop(), 0, JSON.stringify(preview.events) + preview.stderr);
  const serve = cli(t, f.root, 'serve'), served = await serve.waitFor(event => event.type === 'ready');
  await verifySsrPage(page, served.url);
  assert.deepEqual(errors, []);
  await page.goto('about:blank'); assert.equal(await serve.stop(), 0, JSON.stringify(serve.events) + serve.stderr);
});
