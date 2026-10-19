import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Page } from 'playwright-core';
import { appCommand, guardedSource, hash, withAdminServer } from './harness.js';

// Framework contract: installed plugin -> browser request -> scoped withdrawal -> production isolation.
// Uses the repository's isolated Playwright workflow; no Browser skill/runtime is listed.
const { values } = parseArgs({ strict: true, options: { app: { type: 'string' }, out: { type: 'string' } } });
assert.ok(values.app && values.out, 'Required: --app <new dedicated installed app> --out <new evidence directory>');
const app = await realpath(values.app), out = resolve(values.out);
assert.ok(!existsSync(out)); assert.ok(!existsSync(join(app, '.cormi.lock')), 'Never operate on a serving application');
await mkdir(out, { recursive: true });
const controlName = 'cormi-api-controls.ts', controlFile = join(app, controlName);
assert.ok(!existsSync(controlFile));
const config = await guardedSource(app, 'cormi.config.ts');
async function sources() {
  const result: Record<string, string> = {};
  for (const prefix of ['src', 'public']) {
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name); assert.ok(!entry.isSymbolicLink());
        if (entry.isDirectory()) await walk(file); else if (entry.isFile()) result[relative(app, file)] = hash(await readFile(file));
      }
    };
    await walk(join(app, prefix));
  }
  return result;
}
const before = await sources(), stages: Array<Record<string, unknown>> = [];
const report: Record<string, unknown> = { format: 'cormi:dev-api-integration:1', app, passed: false, stages };
const upstreamEvents: Array<Record<string, unknown>> = [];
let slowActive = 0, slowCancelled = 0;
const upstream = createServer(async (req, res) => {
  upstreamEvents.push({ method: req.method, url: req.url });
  if (req.url?.startsWith('/base/slow')) { slowActive++; res.once('close', () => { slowActive--; slowCancelled++; }); return; }
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString() }));
});
await new Promise<void>((accept, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', () => accept()); });
const address = upstream.address(); assert.ok(address && typeof address === 'object');
const target = `http://127.0.0.1:${address.port}/base`;
const controls = (enabled: boolean, label: string) => `export const controls = ${JSON.stringify({ enabled, label })};\n`;
await writeFile(controlFile, controls(true, 'first'), { flag: 'wx' });
const control = await guardedSource(app, controlName);
const original = config.original.toString(); assert.equal(original.split('export default defineConfig(').length, 2);
const wrapped = `import extension from '@cormi-test/dev-extension';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';
import { controls } from './cormi-api-controls';
${original.replace('export default defineConfig(', 'const originalConfig = defineConfig(')}
export default defineConfig(({ command }) => ({ ...originalConfig, plugins: [ ...(originalConfig.plugins ?? []),
 { id: 'validation:api-provider', plugin: devApiVitePlugin, options: { prefix: '/admin/api', timeoutMs: 4000,
   mocks: [{ method: 'GET', path: '/health', handle: () => ({ body: { status: 'ready' } }) }] } },
 { id: 'validation:installed-extension', plugin: extension, enabled: controls.enabled,
   options: { development: command === 'dev', label: controls.label, target: ${JSON.stringify(target)} } }
] }));
`;
const browser = await chromium.launch({ executablePath: process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
report.browser = browser.version();
async function until(check: () => Promise<boolean> | boolean, message: string) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (await check()) return; await delay(25); }
  throw Error(message);
}
async function call(page: Page, path: string, method = 'GET', body?: string) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body } : {}) });
    return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
  }, { path, method, body });
}
type ProbeWindow = Window & { apiProbe?: { controller: AbortController; done: boolean; result: string } };
async function pending(page: Page, path: string) {
  await page.evaluate(path => {
    const probe = { controller: new AbortController(), done: false, result: '' };
    (window as ProbeWindow).apiProbe = probe;
    void fetch(path, { signal: probe.controller.signal }).then(() => { probe.result = 'unexpected-response'; }, error => { probe.result = error.name; }).finally(() => { probe.done = true; });
  }, path);
}
async function abort(page: Page) {
  await page.evaluate(() => (window as ProbeWindow).apiProbe!.controller.abort());
  await page.waitForFunction(() => (window as ProbeWindow).apiProbe?.done);
  assert.equal(await page.evaluate(() => (window as ProbeWindow).apiProbe!.result), 'AbortError');
}
try {
  await config.replace(wrapped);
  await writeFile(join(out, 'typecheck.log'), appCommand(app, 'typecheck'));
  report.dev = await withAdminServer(app, 'dev', join(out, 'dev.log'), async (url, events) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(15000);
    const errors: string[] = [], consoleEvents: Array<{ text: string; url: string }> = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleEvents.push({ text: message.text(), url: message.location().url }); });
    try {
      await page.goto(new URL('user', url).href); await page.getByRole('heading', { name: 'Users', exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/admin/user'); assert.ok((await page.title()).length > 0);
      await page.waitForFunction(() => document.documentElement.dataset.cormiApiFixture === 'first');
      await page.getByPlaceholder('Search user...').fill('Billy'); assert.equal(await page.locator('tbody th').count(), 2);
      const good = await call(page, '/admin/api/items'); assert.equal(good.status, 200); assert.deepEqual(JSON.parse(good.text), [{ id: 1, title: 'cormi fixture' }]);
      assert.deepEqual(JSON.parse((await call(page, '/admin/api/items?empty')).text), []);
      const bad = await call(page, '/admin/api/items?error'); assert.equal(bad.status, 500); assert.deepEqual(JSON.parse(bad.text), { error: 'MOCK_HANDLER_FAILED' });
      const echoed = await call(page, '/admin/api/echo?tag=a&tag=%E4%B8%AD', 'POST', JSON.stringify({ value: '中文' }));
      assert.deepEqual(JSON.parse(echoed.text), { body: { value: '中文' }, tags: ['a', '中'] });
      stages.push({ id: 'installed-node-client-pair-and-mock-success-empty-failure-json', privateMarkerDisclosed: false });
      const proxied = await call(page, '/admin/api/remote/echo%2Fitem?q=%E4%B8%AD', 'POST', JSON.stringify({ value: '数据' }));
      assert.deepEqual(JSON.parse(proxied.text), { path: '/base/echo%2Fitem?q=%E4%B8%AD', method: 'POST', body: JSON.stringify({ value: '数据' }) });
      stages.push({ id: 'browser-through-fixed-proxy-to-real-upstream', encodingPreserved: true });
      await pending(page, '/admin/api/slow');
      await until(async () => JSON.parse((await call(page, '/admin/api/stats')).text).active === 1, 'Mock was never admitted');
      await abort(page);
      await until(async () => { const s = JSON.parse((await call(page, '/admin/api/stats')).text); return s.active === 0 && s.cancelled === 1; }, 'Mock did not receive cancellation');
      await pending(page, '/admin/api/remote/slow'); await until(() => slowActive === 1, 'Proxy was never admitted'); await abort(page);
      await until(() => slowActive === 0 && slowCancelled === 1, 'Proxy upstream socket did not close');
      stages.push({ id: 'browser-abort-reaches-mock-and-proxy', mockCancelled: 1, proxyCancelled: slowCancelled });
      let cursor = events.length;
      await control.replace(controls(false, 'disabled'));
      await until(() => events.slice(cursor).some(e => e.type === 'ready'), 'Disabled worker did not become ready');
      await page.waitForFunction(() => !document.documentElement.dataset.cormiApiFixture);
      await page.getByRole('heading', { name: 'Users', exact: true }).waitFor();
      const removed = await call(page, '/admin/api/items'); assert.equal(removed.status, 404); assert.equal(JSON.parse(removed.text).error, 'DEV_API_NOT_FOUND');
      assert.equal((await call(page, '/admin/api/health')).status, 200);
      cursor = events.length; await control.replace(controls(true, 'second'));
      await until(() => events.slice(cursor).some(e => e.type === 'ready'), 'Enabled worker did not become ready');
      await page.waitForFunction(() => document.documentElement.dataset.cormiApiFixture === 'second');
      assert.equal((await call(page, '/admin/api/items')).status, 200);
      assert.equal(events.filter(e => e.type === 'starting').length, 3);
      stages.push({ id: 'one-package-disable-reenable-withdraws-api-and-client', starts: 3, retainedPeer: 'health', manualReload: false });
      for (const path of ['cormi.config.ts?raw', controlName + '?raw']) assert.equal((await fetch(new URL(path, url))).status, 403);
      assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(), 0);
      assert.deepEqual(errors, []);
      const unexpected = consoleEvents.filter(e => !/Failed to load resource/.test(e.text) || !/^\/admin\/api\/items(?:\?error)?$/.test(new URL(e.url, url).pathname + new URL(e.url, url).search));
      assert.deepEqual(unexpected, []); report.expectedConsoleFailures = consoleEvents;
      await page.screenshot({ path: join(out, 'installed-extension-recovered.png') });
      return { browserErrors: errors, stages: stages.length };
    } finally { await page.close(); }
  });
  await writeFile(join(out, 'build.log'), appCommand(app, 'build'));
  const scan = async (directory: string): Promise<void> => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, item.name); if (item.isDirectory()) await scan(file);
      else if (/\.(?:js|css|html)$/.test(file)) { const text = await readFile(file, 'utf8'); assert.ok(!text.includes('CORMI_FIXTURE_PRIVATE_NODE_MARKER') && !text.includes(target), 'Node plugin content leaked into browser output'); }
    }
  }; await scan(join(app, 'dist'));
  const requestCount = upstreamEvents.length;
  report.preview = await withAdminServer(app, 'preview', join(out, 'preview.log'), async url => {
    const page = await browser.newPage();
    try {
      await page.goto(new URL('user', url).href); await page.getByRole('heading', { name: 'Users', exact: true }).waitFor();
      await page.waitForFunction(() => document.documentElement.dataset.cormiApiFixture === 'second');
      const response = await fetch(new URL('api/items', url)); const text = await response.text();
      assert.ok(response.status !== 200 || !response.headers.get('content-type')?.includes('application/json'));
      assert.ok(!text.includes('cormi fixture')); assert.equal(upstreamEvents.length, requestCount);
      return { browserExtensionPresent: true, mockAbsent: true, upstreamRequests: 0 };
    } finally { await page.close(); }
  });
  stages.push({ id: 'production-client-remains-api-and-node-private-code-absent' });
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.stack : String(error); }
finally {
  await browser.close();
  await new Promise<void>((accept, reject) => upstream.close(error => error ? reject(error) : accept()));
  try {
    assert.equal(existsSync(join(app, '.cormi.lock')), false, 'Owned worker must stop before restoration');
    await config.restore(); await control.restore(); await unlink(controlFile);
    assert.deepEqual(await sources(), before);
    await writeFile(join(out, 'restored-typecheck.log'), appCommand(app, 'typecheck'));
    await writeFile(join(out, 'restored-build.log'), appCommand(app, 'build'));
    report.businessSourcesUnchanged = true;
  } catch (error) { report.restoreError = String(error); report.passed = false; }
  report.upstreamEvents = upstreamEvents;
  await writeFile(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, stages: stages.length, error: report.error, restoreError: report.restoreError, out }));
  if (!report.passed) process.exitCode = 1;
}
