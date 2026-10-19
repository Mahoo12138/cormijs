import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright-core';
import type { AdminModule } from './modules.js';

interface ChartData { type: string; series: unknown; categories: unknown; labels: unknown }
// Locked Apex 4.5 only registers charts with explicit ids. Anonymous charts are observed read-only
// through their bound resize listeners, rather than adding ids or modifying the application for tests.
async function observeCharts(page: Page): Promise<{ charts: ChartData[]; otherResizeListeners: number }> {
  const session = await page.context().newCDPSession(page), group = 'cormi-chart-observation';
  try {
    const list = await session.send('Runtime.evaluate', { expression: '(getEventListeners(window).resize || []).map(item => item.listener)', includeCommandLineAPI: true, objectGroup: group });
    assert.ok(list.result.objectId);
    const properties = await session.send('Runtime.getProperties', { objectId: list.result.objectId, ownProperties: true });
    const listeners = properties.result.filter(item => /^\d+$/.test(item.name));
    const found: Array<{ id: string; data: ChartData }> = [];
    for (const item of listeners) {
      assert.ok(item.value?.objectId);
      const functionProperties = await session.send('Runtime.getProperties', { objectId: item.value.objectId, ownProperties: true });
      const receiver = functionProperties.internalProperties?.find(property => property.name === '[[BoundThis]]')?.value?.objectId;
      if (!receiver) continue;
      const result = await session.send('Runtime.callFunctionOn', { objectId: receiver, returnByValue: true,
        functionDeclaration: 'function(){if(!this.w?.config?.chart||!this.w.globals?.dom?.baseEl)return null;const c=this.w.config;return {id:"apexcharts"+this.w.globals.chartID,data:{type:c.chart.type,series:c.series.map(item=>typeof item==="number"?item:{name:item.name??null,data:item.data,hidden:item.hidden===true}),categories:c.xaxis.categories,labels:c.labels}}}' });
      assert.equal(result.exceptionDetails, undefined);
      if (result.result.value) found.push(result.result.value as { id: string; data: ChartData });
    }
    const ids = await page.locator('.apexcharts-canvas').evaluateAll(elements => elements.map(element => element.id));
    assert.equal(new Set(found.map(item => item.id)).size, found.length, 'Duplicate chart listeners');
    assert.equal(found.length, ids.length, 'Chart listeners and DOM diverged');
    return { charts: ids.map(id => { const match = found.find(item => item.id === id); assert.ok(match); return match.data; }), otherResizeListeners: listeners.length - found.length };
  } finally { await session.send('Runtime.releaseObjectGroup', { objectGroup: group }); await session.detach(); }
}
async function settled(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll('.apexcharts-canvas').length === 8);
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    let last = '', stable = 0;
    const deadline = performance.now() + 12000;
    while (stable < 10) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const next = JSON.stringify([...document.querySelectorAll('.apexcharts-canvas, .apexcharts-series path')].map(element => {
        const r = element.getBoundingClientRect(); return [r.width, r.height, element.getAttribute('d')];
      }));
      stable = next === last ? stable + 1 : 0; last = next;
      if (performance.now() > deadline) throw Error('Chart geometry did not settle');
    }
  });
}
async function data(page: Page) { return (await observeCharts(page)).charts; }
async function tooltip(page: Page, chart: Locator, expected: readonly string[]) {
  const element = chart.locator('.apexcharts-tooltip');
  try {
    await page.waitForFunction(({ el, parts }) => el && getComputedStyle(el).opacity !== '0' && parts.every(part => el.textContent?.includes(part)), { el: await element.elementHandle(), parts: [...expected] });
  } catch (cause) { throw new Error('Tooltip mismatch: ' + JSON.stringify({ expected, actual: await element.innerText() }), { cause }); }
  return (await element.innerText()).trim();
}

export const chartModules: readonly AdminModule[] = [{ id: 'AM04-detail', title: 'All chart kinds, resize and route cleanup', path: '', heading: /Hi, Welcome back/, async verify({ page, base, record, capture }) {
  await settled(page);
  const original = await data(page); assert.equal(original.length, 8);
  assert.deepEqual(original.map(item => item.type), ['line', 'line', 'line', 'line', 'pie', 'bar', 'bar', 'radar']);
  record('eight-chart-data', original);
  const tips: Array<{ chart: string; text: string }> = [];
  for (const [title, value] of [['Weekly sales', '22'], ['New users', '56'], ['Purchase orders', '40'], ['Messages', '56']]) {
    const card = page.locator('.MuiCard-root').filter({ hasText: title! }); assert.equal(await card.count(), 1);
    const chart = card.locator('.apexcharts-canvas'); await chart.scrollIntoViewIfNeeded();
    const point = await chart.locator('path.apexcharts-line').first().evaluate(element => {
      const path = element as SVGPathElement, p = path.getPointAtLength(1), matrix = path.getScreenCTM();
      if (!matrix) throw Error('No chart transform'); const point = new DOMPoint(p.x, p.y).matrixTransform(matrix); return { x: point.x, y: point.y };
    });
    await page.mouse.move(point.x, point.y);
    tips.push({ chart: title!, text: await tooltip(page, chart, ['Jan', value!]) });
    await page.mouse.move(0, 0);
  }
  const pie = page.locator('.MuiCard-root').filter({ hasText: 'Current visits' }).locator('.apexcharts-canvas');
  for (const [index, label, value] of [[0, 'America', '3,500'], [1, 'Asia', '2,500'], [2, 'Europe', '1,500'], [3, 'Africa', '500']] as const) {
    await pie.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const labelPoint = await pie.locator('.apexcharts-datalabels text').nth(index).evaluate(element => {
      const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    // Pie labels intentionally pass pointer events through to their slice. Move the real mouse to the observed label position.
    await page.mouse.move(labelPoint.x, labelPoint.y);
    tips.push({ chart: 'Current visits/' + label, text: await tooltip(page, pie, [label, value]) });
  }
  for (const [title, expected, barIndex] of [['Website visits', ['Jan', 'Team A', '43 visits'], 0], ['Website visits', ['Jan', 'Team B', '51 visits'], 9], ['Conversion rates', ['Italy', '2022', '44', '2023', '53'], 0]] as const) {
    const chart = page.locator('.MuiCard-root').filter({ hasText: title }).locator('.apexcharts-canvas');
    await chart.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await chart.locator('.apexcharts-bar-area').nth(barIndex).hover(); tips.push({ chart: title, text: await tooltip(page, chart, expected) });
  }
  const radar = page.locator('.MuiCard-root').filter({ hasText: 'Current subject' }).locator('.apexcharts-canvas');
  await radar.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const radarPoint = await radar.locator('.apexcharts-marker').first().evaluate(element => {
    const path = element as SVGGraphicsElement, matrix = path.getScreenCTM();
    if (!matrix) throw Error('Missing radar marker transform');
    const point = new DOMPoint(Number(path.getAttribute('cx')), Number(path.getAttribute('cy'))).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(radarPoint.x, radarPoint.y); tips.push({ chart: 'Current subject', text: await tooltip(page, radar, ['English', '80']) });
  record('pointer-tooltip-values', tips);
  await capture('radar-tooltip');
  const visits = page.locator('.MuiCard-root').filter({ hasText: 'Website visits' });
  const legend = visits.locator('.apexcharts-legend-text').filter({ hasText: /^Team A$/ });
  await legend.click(); assert.ok(await visits.locator('.apexcharts-series-collapsed').count() > 0); await legend.click();
  await page.waitForFunction(element => element?.querySelectorAll('.apexcharts-series-collapsed').length === 0, await visits.elementHandle());
  record('native-bar-legend-hide-restore', true);
  const dimensions: unknown[] = [];
  for (const [width, height] of [[1440, 1000], [900, 900], [390, 844], [1440, 1000]]) {
    await page.setViewportSize({ width: width!, height: height! }); await settled(page);
    await page.waitForFunction(() => [...document.querySelectorAll('.apexcharts-canvas')].every(element => {
      const r = element.getBoundingClientRect(), p = element.parentElement!.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.width <= p.width + 2;
    }));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(await data(page), original); dimensions.push({ width, height, charts: await page.locator('.apexcharts-canvas').count() });
  }
  record('resize-keeps-data-and-container-bounds', dimensions);
  const origin = await page.evaluate(() => performance.timeOrigin), cycles: unknown[] = [];
  // Other components have different listeners on Dashboard and Users; compare each page to itself across cycles.
  let userOther: number | undefined, dashboardOther: number | undefined;
  {
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.getByRole('link', { name: 'User', exact: true }).click(); await page.getByRole('heading', { name: 'Users', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.apexcharts-canvas,.apexcharts-tooltip').length === 0);
      const after = await observeCharts(page); assert.equal(after.charts.length, 0);
      userOther ??= after.otherResizeListeners;
      assert.equal(after.otherResizeListeners, userOther, 'Users listeners grew across visits');
      await page.setViewportSize({ width: 1000, height: 900 }); await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('link', { name: 'Dashboard', exact: true }).click(); await settled(page);
      assert.equal(new URL(page.url()).pathname, new URL(base).pathname); assert.deepEqual(await data(page), original);
      const again = await observeCharts(page); dashboardOther ??= again.otherResizeListeners;
      assert.equal(again.otherResizeListeners, dashboardOther, 'Dashboard listeners grew across visits');
      assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
      cycles.push({ cycle, mountedChartListeners: 8, unmountedChartListeners: 0, userOtherListeners: userOther, dashboardOtherListeners: dashboardOther });
    }
  }
  record('three-unmount-remount-cycles', cycles);
  // The separate legends used by pie/radar are presentation, not clickable Apex legend controls.
  record('custom-pie-radar-legends-are-presentational', true);
} }];
