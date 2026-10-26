import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, cli } from '../launcher-helpers.js';
import { assertPortFree } from '../helpers.js';
import { writeFederationRemote, writeFederationHost, writeFederationManifestHost, remoteEntryUrl, serveDirectory,
  verifyFederationPage } from '../../scripts/federation-fixture.js';

async function browser(t: TestContext) {
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'; assert.ok(existsSync(executablePath));
  const instance = await chromium.launch({ executablePath, headless: true }); t.after(() => instance.close());
  const page = await instance.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(15000); return page;
}

test('public manifests compose separately deployed remotes in dev, build and preview', { timeout: 240000 }, async t => {
  const host = await app(t), remote = await app(t);
  await writeFederationRemote(remote.root);
  const page = await browser(t), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  const remoteDev = cli(t, remote.root, 'dev', ['--startup-timeout', '30000']);
  const remoteReady = await remoteDev.waitFor(event => event.type === 'ready', 0, 30000);
  const manifestUrl = new URL('cormi-federation.json', remoteReady.url).href;
  const manifest = await (await fetch(manifestUrl)).json() as Record<string, unknown>;
  assert.equal(manifest.format, 'cormi:federation:1');
  assert.equal(manifest.name, 'CormiRemote');
  assert.equal(manifest.entry, './remoteEntry.js');
  assert.equal(manifest.routes, './routes');
  assert.equal(manifest.prefix, '/remote');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.hasRoutes, true);
  assert.equal(typeof manifest.buildId, 'string');

  // Static remotes remain build-time explicit.
  await writeFederationHost(host.root, remoteEntryUrl(remoteReady.url));
  const staticHost = cli(t, host.root, 'dev', ['--startup-timeout', '30000']);
  const staticReady = await staticHost.waitFor(event => event.type === 'ready', 0, 30000);
  await verifyFederationPage(page, staticReady.url);
  assert.deepEqual(errors, []);
  await page.goto('about:blank');
  assert.equal(await staticHost.stop(), 0, JSON.stringify(staticHost.events) + staticHost.stderr);
  await assertPortFree(Number(new URL(staticReady.url).port));

  // PACKAGE_PUBLIC_URL supplies manifests without listing any static remote.
  await writeFederationManifestHost(host.root);
  const manifestHost = cli(t, host.root, 'dev', ['--startup-timeout', '30000'], { PACKAGE_PUBLIC_URL: remoteReady.url });
  const manifestReady = await manifestHost.waitFor(event => event.type === 'ready', 0, 30000);
  await verifyFederationPage(page, manifestReady.url);
  assert.deepEqual(errors, []);
  await page.goto('about:blank');
  assert.equal(await manifestHost.stop(), 0, JSON.stringify(manifestHost.events) + manifestHost.stderr);
  assert.equal(await remoteDev.stop(), 0, JSON.stringify(remoteDev.events) + remoteDev.stderr);
  await assertPortFree(Number(new URL(manifestReady.url).port));
  await assertPortFree(Number(new URL(remoteReady.url).port));

  const remoteTypes = cli(t, remote.root, 'typecheck', ['--startup-timeout', '30000']);
  assert.equal(await remoteTypes.finish(30000), 0, JSON.stringify(remoteTypes.events) + remoteTypes.stderr);
  const remoteBuild = cli(t, remote.root, 'build', ['--startup-timeout', '30000']);
  assert.equal(await remoteBuild.finish(120000), 0, JSON.stringify(remoteBuild.events) + remoteBuild.stderr);
  assert.ok(existsSync(join(remote.root, 'dist/remoteEntry.js')), 'remoteEntry.js');
  const builtManifest = JSON.parse(await readFile(join(remote.root, 'dist/cormi-federation.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(builtManifest.format, 'cormi:federation:1');
  assert.equal(builtManifest.name, 'CormiRemote');
  assert.equal(builtManifest.entry, './remoteEntry.js');
  assert.equal(builtManifest.routes, './routes');
  assert.equal(builtManifest.prefix, '/remote');
  assert.equal(builtManifest.hasRoutes, true);
  assert.equal(typeof builtManifest.buildId, 'string');

  // A published npm-style package can carry the manifest in package.json; entry stays relative to it.
  await writeFile(join(remote.root, 'dist/package.json'), JSON.stringify({ name: 'cormi-remote-product', version: '1.0.0',
    cormi: { federation: builtManifest } }, null, 2));
  const served = await serveDirectory(join(remote.root, 'dist')); t.after(() => served.close());
  const packageManifestUrl = new URL('package.json', served.url).href;
  // An empty publicUrls list opts into runtime discovery; deployment injects the URL without rebuilding.
  await writeFederationManifestHost(host.root, []);
  const hostTypes = cli(t, host.root, 'typecheck', ['--startup-timeout', '30000']);
  assert.equal(await hostTypes.finish(30000), 0, JSON.stringify(hostTypes.events) + hostTypes.stderr);
  const hostBuild = cli(t, host.root, 'build', ['--startup-timeout', '30000']);
  assert.equal(await hostBuild.finish(120000), 0, JSON.stringify(hostBuild.events) + hostBuild.stderr);
  for (const file of await readdir(join(host.root, 'dist/assets'))) {
    if (!file.endsWith('.js')) continue;
    assert.equal((await readFile(join(host.root, 'dist/assets', file), 'utf8')).includes(served.url), false, 'host build must not embed the remote URL');
  }
  await page.addInitScript(url => { (window as unknown as { __CORMI_PACKAGE_PUBLIC_URL__?: string }).__CORMI_PACKAGE_PUBLIC_URL__ = url; }, packageManifestUrl);
  const preview = cli(t, host.root, 'preview');
  const production = await preview.waitFor(event => event.type === 'ready');
  await verifyFederationPage(page, production.url);
  assert.deepEqual(errors, []);
  await page.goto('about:blank');
  assert.equal(await preview.stop(), 0, JSON.stringify(preview.events) + preview.stderr);
});
