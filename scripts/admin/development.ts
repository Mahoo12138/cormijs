import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright-core';
import { appCommand, guardedSource, hash, withAdminServer } from './harness.js';

// Only the original view files in a supplied migrated test copy are mutated, guarded and finally restored.
// Flow: filter + sort + select -> change the actual view module -> live text and identical interaction state.
const { values } = parseArgs({ strict: true, options: { app: { type: 'string' }, out: { type: 'string' } } });
assert.ok(values.app && values.out); const app = await realpath(values.app), out = resolve(values.out);
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const migration = JSON.parse(await readFile(join(app, 'migration.json'), 'utf8'));
assert.equal(migration.upstream, '69e780a40c455d664b2e13c525faf1d492a072a7');
const upstream = JSON.parse(await readFile(join(project, 'artifacts/admin-upstream.json'), 'utf8')).source_files;
const userName = 'src/sections/user/view/user-view.tsx', productName = 'src/sections/product/view/products-view.tsx';
const user = await guardedSource(app, userName), product = await guardedSource(app, productName);
assert.equal(hash(user.original), upstream[userName].sha256); assert.equal(hash(product.original), upstream[productName].sha256);
await mkdir(out);
const browser = await chromium.launch({ executablePath: process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const stages: Array<Record<string, unknown>> = [], bad: Array<Record<string, unknown>> = [];
const report: Record<string, unknown> = { app, browser: browser.version(), passed: false, stages, bad };
function changed(source: Buffer, old: string, replacement: string): string {
  const text = source.toString(); assert.equal(text.split(old).length, 2); return text.replace(old, replacement);
}
async function newPage(url: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
  page.on('pageerror', error => bad.push({ kind: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') bad.push({ kind: 'console', message: message.text() }); });
  page.on('requestfailed', request => bad.push({ kind: 'requestfailed', url: request.url() }));
  page.on('response', response => { if (response.status() >= 400) bad.push({ kind: 'http', status: response.status(), url: response.url() }); });
  await page.route('**/*', async route => {
    const target = new URL(route.request().url()), root = new URL(url);
    if (['blob:', 'data:'].includes(target.protocol) || target.origin === root.origin && target.pathname.startsWith(root.pathname)) return route.continue();
    bad.push({ kind: 'escaped-base', url: target.href }); return route.abort('blockedbyclient');
  });
  return page;
}
async function tableState(page: Page) {
  return page.evaluate(() => ({
    names: [...document.querySelectorAll('tbody th')].map(node => node.textContent?.trim()),
    checked: [...document.querySelectorAll<HTMLInputElement>('tbody input[type=checkbox]')].map(node => node.checked),
    order: document.querySelector('thead [aria-sort]')?.getAttribute('aria-sort'),
    rows: document.querySelector('.MuiTablePagination-select')?.textContent,
    label: document.querySelector('.MuiTablePagination-displayedRows')?.textContent,
    origin: performance.timeOrigin,
  }));
}
async function tree(path: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink()); const file = join(path, entry.name);
    if (entry.isDirectory()) for (const [key, value] of Object.entries(await tree(file))) result[entry.name + '/' + key] = value;
    else result[entry.name] = hash(await readFile(file));
  }
  return result;
}
try {
  report.dev = await withAdminServer(app, 'dev', join(out, 'dev.log'), async (url, events) => {
    const page = await newPage(url);
    try {
      await page.goto(new URL('user', url).href); await page.getByRole('heading', { name: 'Users', exact: true }).waitFor(); await page.waitForLoadState('networkidle');
      await page.getByRole('combobox', { name: 'Rows per page:' }).click(); await page.getByRole('option', { name: '10', exact: true }).click();
      await page.locator('thead').getByRole('button', { name: /^Name/ }).click();
      await page.getByPlaceholder('Search user...').fill('Billy'); await page.waitForFunction(() => document.querySelectorAll('tbody th').length === 2);
      await page.locator('tbody input[type=checkbox]').first().check(); await page.getByText('1 selected', { exact: true }).waitFor();
      const before = await tableState(page);
      for (let cycle = 1; cycle <= 2; cycle++) {
        await user.replace(changed(user.original, '          Users\n', `          Users live ${cycle}\n`));
        await page.getByRole('heading', { name: `Users live ${cycle}`, exact: true }).waitFor();
        assert.deepEqual(await tableState(page), before); await page.getByText('1 selected', { exact: true }).waitFor();
        if (cycle === 2) await page.screenshot({ path: join(out, 'users-hmr-state.png') });
        await user.restore(); await page.getByRole('heading', { name: 'Users', exact: true }).waitFor(); assert.deepEqual(await tableState(page), before);
      }
      await page.locator('tbody input[type=checkbox]').first().uncheck();
      assert.equal(await page.getByPlaceholder('Search user...').inputValue(), 'Billy');
      stages.push({ name: 'users-fast-refresh', cycles: 2, state: before, filterRestored: 'Billy', fullReload: false });
      await page.getByRole('link', { name: /^Product/ }).click(); await page.getByRole('heading', { name: 'Products', exact: true }).waitFor(); await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: /Sort By:/ }).click(); await page.getByRole('menuitem', { name: 'Price: Low-High', exact: true }).click();
      await page.getByRole('button', { name: 'Go to page 2', exact: true }).click();
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Women', exact: true }).check(); await page.getByRole('radio', { name: 'Above $75', exact: true }).check();
      const origin = await page.evaluate(() => performance.timeOrigin);
      const names = await page.locator('main .MuiCard-root a').allTextContents(); assert.equal(names.length, 24);
      for (let cycle = 1; cycle <= 2; cycle++) {
        await product.replace(changed(product.original, '        Products\n', `        Products live ${cycle}\n`));
        await page.getByRole('heading', { name: `Products live ${cycle}`, exact: true, includeHidden: true }).waitFor();
        assert.equal(await page.getByRole('checkbox', { name: 'Women', exact: true }).isChecked(), true);
        assert.equal(await page.getByRole('radio', { name: 'Above $75', exact: true }).isChecked(), true);
        assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
        assert.deepEqual(await page.locator('main .MuiCard-root a').allTextContents(), names);
        if (cycle === 2) await page.screenshot({ path: join(out, 'products-hmr-state.png') });
        await product.restore(); await page.getByRole('heading', { name: 'Products', exact: true, includeHidden: true }).waitFor();
      }
      await page.keyboard.press('Escape'); await page.getByRole('checkbox', { name: 'Women', exact: true }).waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: /Price: Low-High/ }).waitFor(); assert.equal(await page.locator('main .MuiPagination-root [aria-current=page]').innerText(), '2');
      stages.push({ name: 'products-fast-refresh', cycles: 2, women: true, price: 'Above $75', sort: 'Price: Low-High', page: 2, cards: names.length, fullReload: false });
      assert.equal(events.filter(event => event.type === 'starting').length, 1); assert.equal(bad.length, 0, JSON.stringify(bad));
      return { workerStarts: 1, sourceRestored: true };
    } finally { await page.close(); await user.restore(); await product.restore(); }
  });
  await writeFile(join(out, 'build.log'), appCommand(app, 'build'));
  const previous = await tree(join(app, 'dist'));
  let failed = false;
  try {
    await user.replace('export function UserView( { invalid syntax');
    try { appCommand(app, 'build'); } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      assert.equal(failure.status, 1); failed = true;
      await writeFile(join(out, 'expected-build-failure.log'), String(failure.stdout ?? '') + String(failure.stderr ?? ''));
    }
    assert.equal(failed, true, 'Broken source must reject build'); assert.deepEqual(await tree(join(app, 'dist')), previous);
    stages.push({ name: 'failed-build-preserves-every-published-file', files: Object.keys(previous).length });
  } finally { await user.restore(); }
  await writeFile(join(out, 'restored-typecheck.log'), appCommand(app, 'typecheck'));
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.stack : String(error); }
finally {
  try { await user.restore(); await product.restore(); report.restored = true; }
  catch (error) { report.passed = false; report.restoreError = String(error); }
  await browser.close(); await writeFile(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, restored: report.restored, stages: stages.length, error: report.error, out }));
  if (!report.passed) process.exitCode = 1;
}
