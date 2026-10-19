import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright-core';
import { hash, withAdminServer } from './harness.js';

// Existing project Playwright workflow: no browser skill/runtime is listed for connected-browser automation.
// Flow: direct deep link -> scroll/activate assets and navigate -> reload -> no request outside the deployment prefix.
const { values } = parseArgs({ strict: true, options: { app: { type: 'string' }, out: { type: 'string' }, command: { type: 'string' }, base: { type: 'string' } } });
assert.ok(values.app && values.out); const app = await realpath(values.app), out = resolve(values.out), command = values.command ?? 'dev', base = values.base ?? '/admin/';
assert.ok(command === 'dev' || command === 'preview'); assert.ok(/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base));
const migration = JSON.parse(await readFile(join(app, 'migration.json'), 'utf8'));
assert.equal(migration.upstream, '69e780a40c455d664b2e13c525faf1d492a072a7');
await mkdir(out);
async function filesAt(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!item.isSymbolicLink()); const file = join(directory, item.name);
    if (item.isDirectory()) result.push(...await filesAt(file)); else if (item.isFile()) result.push(file);
  }
  return result.sort();
}
const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const browser = await chromium.launch({ executablePath, headless: true });
const report: Record<string, unknown> = { app, command, base, browser: browser.version(), passed: false };
const fetched: Array<Record<string, unknown>> = [], screens: Array<Record<string, unknown>> = [], bad: Array<Record<string, unknown>> = [], requested = new Set<string>(), fonts = new Set<string>(), masks = new Set<string>();
const mime: Record<string, RegExp> = { '.svg': /image\/svg\+xml/, '.webp': /image\/webp/, '.jpg': /image\/jpeg/, '.ico': /image\/(?:x-icon|vnd.microsoft.icon)/, '.js': /(?:java|ecma)script/, '.css': /text\/css/, '.woff': /font\/woff|application\/font-woff/, '.woff2': /font\/woff2/ };
const generatedBefore = hash(await readFile(join(app, '.cormi/app.tsx')));
try {
  const result = await withAdminServer(app, command, join(out, 'server.log'), async address => {
    assert.equal(new URL(address).pathname, base);
    // All public files, not only those shown above the fold. Reject HTML fallback by byte hash and MIME.
    const publicRoot = join(app, 'public');
    for (const file of await filesAt(publicRoot)) {
      const path = relative(publicRoot, file).split('\\').join('/'), url = new URL(path, address).href;
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) }); const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(response.status, 200, url); assert.equal(hash(bytes), hash(await readFile(file)), url);
      if (mime[extname(file)]) assert.match(response.headers.get('content-type') ?? '', mime[extname(file)]!, url);
      fetched.push({ path, sha256: hash(bytes), type: response.headers.get('content-type') });
    }
    if (command === 'preview') for (const file of await filesAt(join(app, 'dist/assets'))) {
      if (!/\.(?:js|css|woff2?)$/.test(file)) continue;
      const path = relative(join(app, 'dist'), file).split('\\').join('/'), url = new URL(path, address).href;
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, url); assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(await readFile(file)), url);
      assert.match(response.headers.get('content-type') ?? '', mime[extname(file)]!, url);
      fetched.push({ path, built: true, sha256: hash(await readFile(file)) });
    }
    for (const [path, heading] of [['', 'Hi, Welcome back'], ['user', 'Users'], ['products', 'Products'], ['blog', 'Blog'], ['sign-in', 'Sign in'], ['404', 'Sorry, page not found']]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
      page.on('pageerror', error => bad.push({ kind: 'pageerror', message: error.message }));
      page.on('console', event => { if (event.type() === 'error') bad.push({ kind: 'console', message: event.text() }); });
      page.on('response', response => { if (response.status() >= 400) bad.push({ kind: 'http', url: response.url(), status: response.status() }); });
      page.on('requestfailed', request => bad.push({ kind: 'failed', url: request.url(), reason: request.failure()?.errorText }));
      page.on('websocket', socket => { if (!new URL(socket.url()).pathname.startsWith(base)) bad.push({ kind: 'websocket-outside-base', url: socket.url() }); });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (['blob:', 'data:'].includes(url.protocol)) return route.continue();
        requested.add(url.href);
        if (url.origin !== new URL(address).origin || !url.pathname.startsWith(base)) { bad.push({ kind: 'outside-base', url: url.href }); return route.abort('blockedbyclient'); }
        return route.continue();
      });
      try {
        const url = new URL(path!, address).href; await page.goto(url); await page.getByRole('heading', { name: new RegExp(heading!) }).first().waitFor();
        assert.equal(page.url(), url); assert.match(await page.title(), /Minimal/);
        await page.waitForLoadState('networkidle');
        // Visit the full page in real viewports so offscreen/lazy images and chart CSS are exercised.
        let total = await page.evaluate(() => document.documentElement.scrollHeight); assert.ok(total < 30000);
        for (let y = 0; y < total; y += 750) { await page.evaluate(y => scrollTo(0, y), y); await paint(page); }
        await page.waitForLoadState('networkidle'); await imageAndStyleCheck(page);
        const lower = path || 'dashboard'; await page.screenshot({ path: join(out, lower + '-lower.png') });
        await page.evaluate(() => scrollTo(0, 0)); await paint(page);
        await page.screenshot({ path: join(out, lower + '-desktop.png') });
        if (path === '') {
          const notification = page.locator('header button').filter({ has: page.locator('.MuiBadge-root') }); await notification.click();
          await page.getByText('You have 2 unread messages', { exact: true }).waitFor(); await page.waitForLoadState('networkidle'); await imageAndStyleCheck(page); await page.keyboard.press('Escape');
          await page.getByRole('button', { name: 'Languages button' }).click(); await page.getByRole('menuitem', { name: /French/ }).waitFor(); await imageAndStyleCheck(page); await page.keyboard.press('Escape');
          await page.getByRole('button', { name: /Team 1/ }).click(); await page.getByRole('menuitem', { name: /Team 3/ }).waitFor(); await imageAndStyleCheck(page); await page.keyboard.press('Escape');
        }
        const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => (node as HTMLAnchorElement).href));
        for (const link of links) { const target = new URL(link); if (target.origin === new URL(address).origin) assert.ok(target.pathname.startsWith(base), 'Internal link escapes base: ' + link); }
        if (path === 'user') {
          await page.getByRole('link', { name: 'Blog', exact: true }).click(); await page.getByRole('heading', { name: 'Blog', exact: true }).waitFor();
          assert.equal(new URL(page.url()).pathname, base + 'blog'); await page.goBack(); await page.getByRole('heading', { name: 'Users', exact: true }).waitFor();
          const logo = page.getByRole('link', { name: 'Logo', exact: true }); await logo.first().click(); await page.getByRole('heading', { name: /Hi, Welcome back/ }).waitFor(); assert.equal(new URL(page.url()).pathname, base);
          await page.waitForFunction(() => document.querySelectorAll('.apexcharts-canvas').length === 8);
          await page.waitForLoadState('networkidle');
        }
        await page.goto(url); await page.getByRole('heading', { name: new RegExp(heading!) }).first().waitFor(); await page.waitForLoadState('networkidle');
        await page.reload(); await page.getByRole('heading', { name: new RegExp(heading!) }).first().waitFor(); await page.waitForLoadState('networkidle');
        await page.setViewportSize({ width: 390, height: 844 }); await paint(page); await imageAndStyleCheck(page);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: join(out, lower + '-mobile.png') });
        assert.equal(await page.locator('vite-error-overlay,cormi-development-overlay,.error-boundary-root').count(), 0);
        screens.push({ path, links: links.length, desktop: [1440,1000], mobile: [390,844], refreshed: true });
      } finally { await page.close(); }
    }
    assert.ok([...fonts].some(family => /DM Sans/.test(family)), JSON.stringify([...fonts]));
    assert.ok([...fonts].some(family => /Barlow/.test(family)), JSON.stringify([...fonts]));
    assert.ok([...masks].some(value => value.includes(base + 'assets/icons/navbar/')));
    assert.ok([...masks].some(value => value.includes(base + 'assets/background/overlay.jpg')));
    assert.equal(bad.length, 0, JSON.stringify(bad));
    return { publicFiles: fetched.filter(file => !file.built).length, builtAssets: fetched.filter(file => file.built).length };
  });
  report.server = result; report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.stack : String(error); }
finally {
  await browser.close();
  report.generatedUnchanged = hash(await readFile(join(app, '.cormi/app.tsx'))) === generatedBefore;
  if (command === 'preview' && !report.generatedUnchanged) report.passed = false;
  Object.assign(report, { fetched, screens, bad, requested: [...requested], fonts: [...fonts], cssImages: [...masks] });
  await writeFile(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, command, base, screens: screens.length, files: fetched.length, error: report.error, out }));
  if (!report.passed) process.exitCode = 1;
}
async function paint(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity));
  await page.evaluate(() => new Promise<void>(accept => requestAnimationFrame(() => requestAnimationFrame(() => accept()))));
}
async function imageAndStyleCheck(page: Page) {
  await page.waitForLoadState('networkidle');
  const state = await page.evaluate(async () => {
    await document.fonts.ready;
    // currentSrc can still be empty for a newly mounted popup image with a queued request.
    // Wait for declared sources before closing the popup instead of ignoring those requests.
    const images = [...document.images].filter(image => image.getAttribute('src') && (image.loading !== 'lazy' || image.complete));
    await Promise.all(images.map(image => image.decode()));
    const css = new Set<string>();
    for (const element of document.querySelectorAll('*')) for (const pseudo of [null, '::before', '::after']) {
      const style = getComputedStyle(element, pseudo);
      for (const value of [style.backgroundImage, style.maskImage, style.webkitMaskImage]) if (value.includes('url(')) css.add(value);
    }
    return { fonts: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family), css: [...css], images: images.length };
  });
  for (const family of state.fonts) fonts.add(family);
  for (const value of state.css) masks.add(value);
}
