import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright-core';
import type { AdminModule } from './modules.js';

const focusInfo = (page: Page) => page.evaluate(() => {
  const element = document.activeElement;
  return { tag: element?.tagName, role: element?.getAttribute('role'), label: element?.getAttribute('aria-label'), text: element?.textContent?.trim().slice(0, 100) };
});
async function focused(locator: Locator) {
  await locator.page().waitForFunction(element => element === document.activeElement, await locator.elementHandle());
}
async function openFromKeyboard(page: Page, trigger: Locator, key = 'Enter') {
  await trigger.focus(); await page.keyboard.press(key);
}
async function trap(page: Page, popup: Locator) {
  for (const key of [...Array<string>(9).fill('Tab'), ...Array<string>(9).fill('Shift+Tab')]) {
    await page.keyboard.press(key);
    assert.equal(await popup.evaluate(element => element.contains(document.activeElement)), true, 'Focus escaped the active popup');
  }
}

/** Separate expectations preserve the upstream defect evidence; ordinary business contracts are untouched. */
export function headerModules(fixed: boolean): readonly AdminModule[] {
  return [
    { id: 'AM03-notifications', title: 'Notification focus lifecycle', path: 'user', heading: /^Users$/, async verify({ page, record, capture }) {
      const trigger = page.locator('header button').filter({ has: page.locator('.MuiBadge-root') });
      await openFromKeyboard(page, trigger);
      const count = page.getByText('You have 2 unread messages', { exact: true }); await count.waitFor();
      const popup = page.locator('.MuiPopover-paper');
      record('initial-focus', await focusInfo(page));
      const mark = page.getByRole('button', { name: /Mark all as read/ });
      await mark.focus(); await page.keyboard.press('Enter');
      const zero = page.getByText('You have 0 unread messages', { exact: true }); await zero.waitFor();
      const after = await focusInfo(page); record('focus-after-read', after);
      if (fixed) {
        assert.notEqual(after.tag, 'BODY', 'Mark-all removed the focused button without transferring focus');
        assert.equal(await popup.evaluate(element => element.contains(document.activeElement)), true);
        await focused(page.getByRole('heading', { name: 'Notifications', exact: true }));
        await capture('after-read-focus');
        await page.keyboard.press('Escape'); await zero.waitFor({ state: 'hidden' }); await focused(trigger);
      } else {
        assert.equal(after.tag, 'BODY'); await page.keyboard.press('Escape'); assert.equal(await zero.isVisible(), true);
        // Explicit baseline workaround, not credited as repaired product behavior.
        await page.getByRole('button', { name: 'View all', exact: true }).focus(); await page.keyboard.press('Escape'); await zero.waitFor({ state: 'hidden' });
      }
      record('escape-without-refocus-dismisses', fixed);
      await openFromKeyboard(page, trigger, 'Space'); await zero.waitFor();
      assert.equal(await popup.locator('.MuiListItemButton-root').count(), 5);
      assert.equal(await page.getByRole('button', { name: /Mark all as read/ }).count(), 0);
      if (fixed) {
        assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.getByRole('dialog', { name: 'Notifications', exact: true }).count(), 1);
        await trap(page, popup);
      }
      await page.keyboard.press('Escape'); await zero.waitFor({ state: 'hidden' });
      if (fixed) await focused(trigger);
      await openFromKeyboard(page, trigger); await zero.waitFor();
      await page.locator('.MuiPopover-root .MuiBackdrop-root').click({ position: { x: 1, y: 1 } });
      await zero.waitFor({ state: 'hidden' }); if (fixed) await focused(trigger);
      record('reopen-zero-unread-five-items-and-backdrop-close', true);
    } },
    { id: 'AM03-menus', title: 'Language, workspace and account keyboard behavior', path: 'user', heading: /^Users$/, async verify({ page, base, record, capture }) {
      const language = page.getByRole('button', { name: 'Languages button' });
      await openFromKeyboard(page, language); const languageItems = page.getByRole('menuitem'); await languageItems.first().waitFor();
      record('language-open-focus', await focusInfo(page));
      if (fixed) await focused(languageItems.first()); else await languageItems.first().focus();
      await page.keyboard.press('End'); await focused(languageItems.last());
      await page.keyboard.press('Home'); await focused(languageItems.first());
      await page.keyboard.press('ArrowDown'); await focused(languageItems.nth(1));
      const chosen = (await languageItems.nth(1).innerText()).trim();
      await page.keyboard.press('Enter'); await languageItems.first().waitFor({ state: 'hidden' }); await focused(language);
      assert.equal(await language.locator('img').getAttribute('alt'), chosen);
      record('language-home-end-arrows-enter-flag-only', chosen);
      const workspace = page.getByRole('button', { name: /Team 1/ });
      await openFromKeyboard(page, workspace); const workspaceItems = page.getByRole('menuitem'); await workspaceItems.first().waitFor();
      if (fixed) await focused(workspaceItems.first()); else await workspaceItems.first().focus();
      await page.keyboard.press('End'); await focused(workspaceItems.last()); await page.keyboard.press('Enter');
      const team3 = page.getByRole('button', { name: /Team 3/ }); await team3.waitFor(); await focused(team3);
      record('workspace-keyboard-label-only', 'Team 3');
      const account = page.locator('header button').filter({ has: page.locator('.MuiAvatar-root') });
      await openFromKeyboard(page, account); const home = page.getByRole('menuitem', { name: 'Home', exact: true }); await home.waitFor();
      if (fixed) await focused(home); else await home.focus();
      await page.keyboard.press('End'); await page.keyboard.press('Tab');
      const logout = page.getByRole('button', { name: 'Logout', exact: true }); await focused(logout);
      const before = page.url(); await page.keyboard.press('Enter'); assert.equal(page.url(), before); assert.equal(await logout.isVisible(), true);
      record('logout-remains-an-upstream-placeholder', true);
      await page.keyboard.press('Escape'); await logout.waitFor({ state: 'hidden' }); await focused(account);
      await openFromKeyboard(page, account); await home.waitFor(); await home.focus(); await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: /Hi, Welcome back/ }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.apexcharts-canvas').length === 8);
      await page.waitForLoadState('networkidle'); assert.equal(new URL(page.url()).pathname, new URL(base).pathname);
      record('account-home-navigation-keeps-base', true);
    } },
    { id: 'AM03-search', title: 'Search opening, cancellation and focus', path: 'user', heading: /^Users$/, async verify({ page, record, capture }) {
      const trigger = fixed ? page.getByRole('button', { name: 'Open search', exact: true }) : page.locator('header button:visible').first();
      await openFromKeyboard(page, trigger); const input = page.getByPlaceholder('Search…'); await input.waitFor(); await focused(input);
      await input.fill('cormi no real search'); await page.keyboard.press('Escape');
      if (fixed) { await input.waitFor({ state: 'hidden' }); await focused(trigger); }
      else { assert.equal(await input.isVisible(), true); await page.getByRole('button', { name: 'Search', exact: true }).click(); await input.waitFor({ state: 'hidden' }); }
      record('escape-cancels-and-restores-trigger', fixed);
      await openFromKeyboard(page, trigger); await input.waitFor(); await input.fill('another query');
      if (fixed) await page.keyboard.press('Enter'); else await page.getByRole('button', { name: 'Search', exact: true }).click();
      await input.waitFor({ state: 'hidden' }); if (fixed) await focused(trigger);
      assert.equal(await page.locator('tbody th').count(), 5); record('search-submit-closes-only-no-results-api', true);
      await openFromKeyboard(page, trigger); await input.waitFor();
      const userInput = page.getByPlaceholder('Search user...'); await userInput.click(); await input.waitFor({ state: 'hidden' }); await focused(userInput);
      record('click-away-does-not-steal-target-focus', true);
    } },
    { id: 'AM03-mobile', title: 'Nested mobile navigation focus', path: 'user', heading: /^Users$/, async verify({ page, base, record, capture }) {
      await page.setViewportSize({ width: 390, height: 844 });
      const trigger = fixed ? page.getByRole('button', { name: 'Open navigation', exact: true }) : page.locator('header button:visible').first();
      await openFromKeyboard(page, trigger); const drawer = page.locator('.MuiDrawer-paper'); await drawer.waitFor();
      if (fixed) assert.equal(await page.getByRole('dialog', { name: 'Navigation', exact: true }).count(), 1);
      await trap(page, drawer);
      const workspace = drawer.getByRole('button', { name: /Team 1/ }); await openFromKeyboard(page, workspace);
      const menu = page.getByRole('menu'); await menu.waitFor();
      if (fixed) await capture('nested-mobile-menu');
      await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' }); await focused(workspace); assert.equal(await drawer.isVisible(), true);
      await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' }); await focused(trigger);
      await openFromKeyboard(page, trigger); await drawer.waitFor();
      const blog = drawer.getByRole('link', { name: 'Blog', exact: true }); await blog.focus(); await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'Blog', exact: true }).waitFor(); await drawer.waitFor({ state: 'hidden' });
      assert.equal(new URL(page.url()).pathname, new URL('blog', base).pathname); await focused(trigger);
      record('nested-escape-and-keyboard-navigation-restore-focus', true);
      await page.setViewportSize({ width: 1440, height: 1000 });
    } },
  ];
}
