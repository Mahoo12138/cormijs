import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export interface Observation { readonly check: string; readonly value: unknown }
export interface ModuleContext { page: Page; base: string; record(check: string, value: unknown): void }
export interface AdminModule { id: string; title: string; path: string; heading: RegExp; verify(ctx: ModuleContext): Promise<void> }
const userNames = (page: Page) => page.locator('tbody th').allTextContents();
const productNames = (page: Page) => page.locator('main .MuiCard-root a').allTextContents();

/** Original-template behavior contracts; a control state change is not automatically a data operation. */
export const adminModules: readonly AdminModule[] = [
  { id: 'AM03', title: 'Layout and header', path: 'user', heading: /^Users$/, async verify({ page, base, record }) {
    const language = page.getByRole('button', {name:'Languages button'});
    await language.click(); await page.getByRole('menuitem', {name:/German/}).click();
    assert.equal(await language.locator('img').getAttribute('alt'), 'German');
    await page.getByRole('heading', {name:'Users',exact:true}).waitFor(); record('language-flag-not-content-translation', true);
    const notification = page.locator('header button').filter({has:page.locator('.MuiBadge-root')});
    // The original button has no accessible name; its unique badge is the observed anchor.
    await notification.click(); await page.getByText('You have 2 unread messages', {exact:true}).waitFor();
    await page.getByRole('button', {name:/Mark all as read/}).click();
    const zeroUnread = page.getByText('You have 0 unread messages', {exact:true});
    await zeroUnread.waitFor();
    record('focus-after-read-button-disappears', await page.evaluate(() => document.activeElement?.tagName));
    await page.keyboard.press('Escape');
    assert.equal(await zeroUnread.isVisible(), true, 'Record the original focus-loss behavior, not an assumed dismissal');
    record('escape-after-read-all-does-not-dismiss-original-popover', true);
    await page.getByRole('button', {name:'View all',exact:true}).focus();
    await page.keyboard.press('Escape'); await zeroUnread.waitFor({state:'hidden'});
    record('refocus-then-escape-dismisses', true);
    record('mark-all-notifications-read-in-memory', true);
    await page.getByRole('button', {name:/Team 1/}).click(); await page.getByRole('menuitem', {name:/Team 2/}).click();
    await page.getByRole('button', {name:/Team 2/}).waitFor(); record('workspace-label-switch-not-tenant-isolation',true);
    await page.getByRole('link', {name:'Blog',exact:true}).click(); await page.getByRole('heading', {name:'Blog',exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname,new URL('blog',base).pathname);
    await page.goBack(); await page.getByRole('heading',{name:'Users',exact:true}).waitFor();
    record('sidebar-client-navigation-and-browser-back',true);
    await page.setViewportSize({width:390,height:844});
    const menu=page.locator('header button').first(); // Original MenuButton is first in HeaderSection.leftArea.
    await menu.click(); const mobileNav=page.locator('.MuiDrawer-paper');
    await mobileNav.getByRole('link',{name:'Blog',exact:true}).click(); await page.getByRole('heading',{name:'Blog',exact:true}).waitFor();
    await mobileNav.waitFor({state:'hidden'}); record('mobile-drawer-navigates-and-closes',true);
    await page.setViewportSize({width:1440,height:1000});
  } },

  { id: 'AM04', title: 'Dashboard', path: '', heading: /Hi, Welcome back/, async verify({ page, record }) {
    await page.locator('.apexcharts-canvas').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.apexcharts-canvas').length >= 8);
    const charts = await page.locator('.apexcharts-canvas').count(); assert.ok(charts >= 8); record('rendered-chart-instances', charts);
    const legend = page.locator('.apexcharts-legend-text').filter({ hasText: /^Team A$/ }).first();
    await legend.click(); // Locator click retries during chart redraw instead of retaining a detached element.
    const hidden = await page.locator('.apexcharts-series-collapsed').count(); assert.ok(hidden > 0); record('legend-hides-series', hidden);
    await legend.click();
    const tasks = page.locator('input[type=checkbox]'); assert.ok(await tasks.count() > 0);
    const first = tasks.first(), previous = await first.isChecked(); await first.click(); assert.equal(await first.isChecked(), !previous); await first.click();
    record('task-toggle-and-restore', true);
  } },
  { id: 'AM05', title: 'Users', path: 'user', heading: /^Users$/, async verify({ page, record }) {
    const search = page.getByPlaceholder('Search user...');
    const initial = (await userNames(page)).map(name => name.trim()); assert.equal(initial.length, 5); record('initial-names', initial);
    const all = [...initial];
    for (let index = 0; index < 4; index++) {
      await page.getByRole('button', {name:'Go to next page'}).click();
      all.push(...(await userNames(page)).map(name => name.trim()));
    }
    assert.equal(all.length,24); assert.equal(new Set(all).size,24);
    assert.deepEqual(all,[...all].sort((a,b)=>a<b?-1:a>b?1:0));
    assert.equal(await page.getByRole('button',{name:'Go to next page'}).isDisabled(),true);
    for (let index=0;index<4;index++) await page.getByRole('button',{name:'Go to previous page'}).click();
    record('all-pages-preserve-all-24-users-in-ascending-order',all);
    await page.getByRole('button', { name: 'Go to next page' }).click();
    const nextPage = (await userNames(page)).map(name => name.trim()); assert.equal(nextPage.length, 5); assert.notDeepEqual(nextPage, initial);
    await search.fill(initial[0]!); await page.waitForFunction(() => document.querySelectorAll('tbody th').length === 1);
    assert.equal((await userNames(page))[0]?.trim(), initial[0]);
    assert.equal(await page.getByRole('button', { name: 'Go to previous page' }).isDisabled(), true);
    record('search-from-second-page-resets-page', true);
    record('filtered-pagination-label', await page.locator('.MuiTablePagination-displayedRows').innerText());
    await page.locator('thead input[type=checkbox]').check();
    await page.getByText('24 selected', {exact:true}).waitFor();
    assert.equal(await page.locator('tbody th').count(),1); record('select-all-under-filter-selects-all-24-original-rows',true);
    await page.locator('thead input[type=checkbox]').uncheck(); await search.waitFor();
    await search.fill('CORMI_NO_SUCH_USER_987'); await page.getByText(/No results found for/).waitFor(); assert.equal(await page.locator('tbody th').count(), 0);
    await search.fill(''); await page.waitForFunction(() => document.querySelectorAll('tbody th').length === 5);
    await page.locator('thead').getByRole('button', { name: /^Name/ }).click();
    const reversed = (await userNames(page)).map(name => name.trim()); assert.deepEqual(reversed, [...all].reverse().slice(0,5)); record('descending-names', reversed);
    const row = page.locator('tbody tr').filter({ has: page.locator('th') }).first();
    await row.locator('input[type=checkbox]').check(); await page.getByText('1 selected', { exact: true }).waitFor();
    await row.locator('input[type=checkbox]').uncheck(); await search.waitFor();
    await row.getByRole('button').click(); await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    assert.deepEqual((await userNames(page)).map(name => name.trim()), reversed); record('delete-is-upstream-close-only', true);
    await page.getByRole('button', { name: 'New user', exact: true }).click(); assert.equal(await page.getByRole('dialog').count(), 0);
    record('new-user-is-upstream-placeholder', true);
    await page.getByRole('combobox', { name: 'Rows per page:' }).click(); await page.getByRole('option', { name: '10', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody th').length === 10); record('rows-per-page-ten', true);
  } },
  { id: 'AM06', title: 'Products', path: 'products', heading: /^Products$/, async verify({ page, record }) {
    const before = await productNames(page); assert.equal(before.length, 24, 'All original product cards must be present'); record('initial-links', before);
    await page.getByRole('button', { name: /Sort By:/ }).click(); await page.getByRole('menuitem', { name: 'Price: Low-High', exact: true }).click();
    await page.getByRole('button', { name: /Price: Low-High/ }).waitFor();
    assert.deepEqual(await productNames(page), before); record('sort-state-does-not-sort-original-data', true);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    const women = page.getByRole('checkbox', { name: 'Women', exact: true }); await women.check(); assert.equal(await women.isChecked(), true);
    await page.getByRole('radio', { name: 'Above $75', exact: true }).check();
    record('filter-controls-change', true); await page.keyboard.press('Escape'); await women.waitFor({ state: 'hidden' });
    assert.deepEqual(await productNames(page), before); record('filters-do-not-filter-original-data', true);
    await page.getByRole('button', { name: 'Go to page 2', exact: true }).click(); assert.deepEqual(await productNames(page), before);
    record('pagination-is-upstream-control-only', true);
  } },
  { id: 'AM07', title: 'Blog', path: 'blog', heading: /^Blog$/, async verify({ page, record }) {
    const before = await page.locator('main a').allTextContents(); assert.equal(before.length, 23, 'All original post cards must be present');
    const search = page.getByPlaceholder('Search post...'); await search.fill('Whiteboard');
    await page.getByRole('listbox').waitFor(); const suggestions = await page.getByRole('option').allTextContents(); assert.ok(suggestions.length > 0); record('autocomplete-suggestions', suggestions);
    await page.getByRole('option').first().click(); assert.deepEqual(await page.locator('main a').allTextContents(), before);
    record('search-selects-text-without-filtering-cards', true);
    await page.getByRole('button', { name: 'Latest', exact: true }).click(); await page.getByRole('menuitem', { name: 'Oldest', exact: true }).click();
    assert.deepEqual(await page.locator('main a').allTextContents(), before); record('sort-is-upstream-control-only', true);
    await page.getByRole('button', { name: 'New post', exact: true }).click(); assert.equal(await page.getByRole('dialog').count(), 0);
    record('new-post-is-upstream-placeholder', true);
  } },
  { id: 'AM08', title: 'Sign in', path: 'sign-in', heading: /^Sign in$/, async verify({ page, base, record }) {
    const input = page.locator('input[name=password]'); assert.equal(await input.getAttribute('type'), 'password');
    await input.locator('..').getByRole('button').click(); assert.equal(await input.getAttribute('type'), 'text');
    await page.getByRole('textbox', { name: 'Email address', exact: true }).fill('not-a-real-login@example.invalid');
    await input.fill('not-a-real-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('heading', { name: /Hi, Welcome back/ }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.apexcharts-canvas').length === 8);
    assert.equal(new URL(page.url()).pathname, new URL(base).pathname); record('sign-in-navigation-not-authentication', true);
  } },
  { id: 'AM09', title: 'Not found', path: '404', heading: /Sorry, page not found/, async verify({ page, base, record }) {
    await page.goto(new URL('this-route-does-not-exist', base).href); await page.getByRole('heading', { name: /Sorry, page not found/ }).waitFor();
    await page.getByRole('link', { name: 'Go to home', exact: true }).click(); await page.getByRole('heading', { name: /Hi, Welcome back/ }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.apexcharts-canvas').length === 8);
    assert.equal(new URL(page.url()).pathname, new URL(base).pathname); record('catch-all-and-home-return', true);
  } },
];
