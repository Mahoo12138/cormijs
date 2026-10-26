import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, cli } from '../launcher-helpers.js';
import { assertPortFree } from '../helpers.js';
import { writeFederationRemote, writeFederationHost, remoteEntryUrl, serveDirectory, verifyFederationPage } from '../../scripts/federation-fixture.js';

async function browser(t: TestContext) {
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'; assert.ok(existsSync(executablePath));
  const instance = await chromium.launch({ executablePath, headless: true }); t.after(() => instance.close());
  const page = await instance.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(15000); return page;
}

test('module federation shares React and merges remote routes in dev, build and preview', { timeout: 240000 }, async t => {
  const host = await app(t), remote = await app(t);
  await writeFederationRemote(remote.root);
  const page = await browser(t), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  const remoteDev = cli(t, remote.root, 'dev', ['--startup-timeout', '30000']);
  const remoteReady = await remoteDev.waitFor(event => event.type === 'ready', 0, 30000);
  await writeFederationHost(host.root, remoteEntryUrl(remoteReady.url));
  const hostDev = cli(t, host.root, 'dev', ['--startup-timeout', '30000']);
  const hostReady = await hostDev.waitFor(event => event.type === 'ready', 0, 30000);
  await verifyFederationPage(page, hostReady.url);
  assert.deepEqual(errors, []);
  await page.goto('about:blank');
  assert.equal(await hostDev.stop(), 0, JSON.stringify(hostDev.events) + hostDev.stderr);
  assert.equal(await remoteDev.stop(), 0, JSON.stringify(remoteDev.events) + remoteDev.stderr);
  await assertPortFree(Number(new URL(hostReady.url).port));
  await assertPortFree(Number(new URL(remoteReady.url).port));

  const hostTypes = cli(t, host.root, 'typecheck', ['--startup-timeout', '30000']);
  assert.equal(await hostTypes.finish(30000), 0, JSON.stringify(hostTypes.events) + hostTypes.stderr);
  const remoteTypes = cli(t, remote.root, 'typecheck', ['--startup-timeout', '30000']);
  assert.equal(await remoteTypes.finish(30000), 0, JSON.stringify(remoteTypes.events) + remoteTypes.stderr);

  const remoteBuild = cli(t, remote.root, 'build', ['--startup-timeout', '30000']);
  assert.equal(await remoteBuild.finish(120000), 0, JSON.stringify(remoteBuild.events) + remoteBuild.stderr);
  assert.ok(existsSync(join(remote.root, 'dist/remoteEntry.js')), 'remoteEntry.js');
  const served = await serveDirectory(join(remote.root, 'dist')); t.after(() => served.close());
  await writeFederationHost(host.root, remoteEntryUrl(served.url));

  const hostBuild = cli(t, host.root, 'build', ['--startup-timeout', '30000']);
  assert.equal(await hostBuild.finish(120000), 0, JSON.stringify(hostBuild.events) + hostBuild.stderr);
  const preview = cli(t, host.root, 'preview');
  const production = await preview.waitFor(event => event.type === 'ready');
  await verifyFederationPage(page, production.url);
  assert.deepEqual(errors, []);
  await page.goto('about:blank');
  assert.equal(await preview.stop(), 0, JSON.stringify(preview.events) + preview.stderr);
});
