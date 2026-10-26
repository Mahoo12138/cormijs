import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const federationRemoteConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { routeConfigPlugin } from '@cormijs/plugin-react';
import { federationPlugin } from '@cormijs/plugin-federation';
const routes = [
  { id: 'remote-home', index: true, component: './src/screens/home.tsx', meta: { title: 'Remote Home', order: 1 } },
  { id: 'remote-orders', path: 'orders', component: './src/screens/orders.tsx', clientLoader: 'clientLoader', meta: { title: 'Orders', order: 2 } },
];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'remote-routes', routes } },
    { id: 'federation', plugin: federationPlugin, options: { name: 'CormiRemote', exposeRoutes: true } },
  ],
  app: { base: '/', server: { port: 0 } },
});
`;

export function federationHostConfiguration(remoteEntry: string): string {
  return `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { menuPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
import { federationPlugin } from '@cormijs/plugin-federation';
const routes = [
  { id: 'host-home', index: true, component: './src/screens/home.tsx', meta: { title: 'Home', order: 1 } },
];
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'host-routes', routes } },
    { id: 'federation', plugin: federationPlugin, options: { name: 'CormiHost', remotes: [
      { name: 'CormiRemote', entry: ${JSON.stringify(remoteEntry)}, prefix: '/remote' },
    ] } },
    { id: 'menu', plugin: menuPlugin },
  ],
  app: { base: '/', server: { port: 0 } },
});
`;
}

const tsconfig = JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
  strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2);

const indexHtml = '<!doctype html><html><head><title>cormi federation</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>';

const homePage = `import { useEffect } from 'react';
import * as React from 'react';
import { Link, useMenu } from '@cormijs/runtime';
export default function HostHome() {
  const menu = useMenu();
  useEffect(() => { (window as unknown as Record<string, unknown>).__hostReact = React; });
  return <main><h1>Federation host</h1><p data-host-home>host index</p><nav data-menu-list>{menu.map(item => <Link key={item.id} data-menu={item.id} to={item.path}>{item.title}</Link>)}</nav></main>;
}
`;

const remoteHome = `import { useEffect } from 'react';
import * as React from 'react';
export default function RemoteHome() {
  useEffect(() => { (window as unknown as Record<string, unknown>).__remoteReact = React; });
  return <main><h1>Remote home</h1><p data-remote-home>remote index</p></main>;
}
`;

const remoteOrders = `import { useEffect, useState } from 'react';
import * as React from 'react';
import { useLoaderData } from 'react-router';
export async function clientLoader() { return { items: ['A-1', 'B-2'] }; }
export default function RemoteOrders() {
  const data = useLoaderData() as { items: string[] };
  const [count, setCount] = useState(0);
  useEffect(() => { (window as unknown as Record<string, unknown>).__remoteReact = React; });
  return <main><h1>Remote orders</h1><p data-remote-orders>{data.items.join(',')}</p><button data-remote-increment onClick={() => setCount(value => value + 1)}>{count}</button></main>;
}
`;

async function writeFiles(root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
}

export async function writeFederationRemote(root: string) {
  await writeFiles(root, {
    'index.html': indexHtml,
    'cormi.config.ts': federationRemoteConfiguration,
    'tsconfig.json': tsconfig,
    'src/screens/home.tsx': remoteHome,
    'src/screens/orders.tsx': remoteOrders,
  });
}

export async function writeFederationHost(root: string, remoteEntry: string) {
  await writeFiles(root, {
    'index.html': indexHtml,
    'cormi.config.ts': federationHostConfiguration(remoteEntry),
    'tsconfig.json': tsconfig,
    'src/screens/home.tsx': homePage,
  });
}

export function remoteEntryUrl(base: string): string {
  return new URL('remoteEntry.js', base).href;
}

const contentTypes: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
};

/** Production remotes are cross-origin in typical deployments; CORS is part of the entry contract. */
export async function serveDirectory(root: string): Promise<{ readonly url: string; close(): Promise<void> }> {
  const base = normalize(root);
  const server: Server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const file = normalize(join(base, pathname === '/' ? 'index.html' : pathname));
      if (!file.startsWith(base + sep) || !existsSync(file)) throw new Error('not found');
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
        'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'access-control-allow-origin': '*' }); response.end('Not found');
    }
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('No server address'));
    });
  });
  return Object.freeze({ url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }) });
}

export async function verifyFederationPage(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Federation host', exact: true }).waitFor();
  await page.locator('[data-menu]', { hasText: 'Orders' }).click();
  await page.waitForURL(/\/remote\/orders$/);
  await page.getByRole('heading', { name: 'Remote orders', exact: true }).waitFor();
  assert.equal(await page.locator('[data-remote-orders]').innerText(), 'A-1,B-2');
  await page.locator('[data-remote-increment]').click();
  await page.waitForFunction(() => document.querySelector('[data-remote-increment]')?.textContent === '1');
  await page.waitForFunction(() => {
    const scope = window as unknown as { __remoteReact?: unknown; __hostReact?: unknown };
    return scope.__remoteReact !== undefined && scope.__hostReact !== undefined;
  });
  const react = await page.evaluate(() => {
    const scope = window as unknown as { __remoteReact: typeof import('react'); __hostReact: typeof import('react') };
    return { sameUseState: scope.__remoteReact.useState === scope.__hostReact.useState,
      sameCreateContext: scope.__remoteReact.createContext === scope.__hostReact.createContext,
      sameVersion: scope.__remoteReact.version === scope.__hostReact.version };
  });
  assert.deepEqual(react, { sameUseState: true, sameCreateContext: true, sameVersion: true }, 'React must be shared');
  // Deep links load remote routes before the router exists.
  await page.goto(new URL('remote/orders', url).href);
  await page.getByRole('heading', { name: 'Remote orders', exact: true }).waitFor();
  assert.equal(await page.locator('[data-remote-orders]').innerText(), 'A-1,B-2');
  await page.goto(new URL('remote', url).href);
  await page.getByRole('heading', { name: 'Remote home', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
