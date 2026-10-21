import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectClientLoader, detectServerLoader, pageLoaderExports } from '@cormijs/plugin-react';
import { routesFromFiles } from '@cormijs/routes';

test('detectClientLoader reads exported declarations through the AST', () => {
  assert.equal(detectClientLoader('export async function clientLoader(){ return {}; }'), 'clientLoader');
  assert.equal(detectClientLoader('export function clientLoader() { return {}; }'), 'clientLoader');
  assert.equal(detectClientLoader('export const clientLoader = async () => ({ id: 1 });'), 'clientLoader');
  assert.equal(detectClientLoader('// export function clientLoader(){}\nexport default function Page(){ return null; }'), undefined);
  assert.equal(detectClientLoader('const text = "export function clientLoader"; export default () => null;'), undefined);
  assert.equal(detectClientLoader('declare function clientLoader(): void; export default () => null;'), undefined);
  assert.equal(detectClientLoader('export type clientLoader = () => void;'), undefined);
  assert.equal(detectClientLoader('function clientLoader(){ return {}; } export default function Page(){ return null; }'), undefined);
  assert.equal(detectClientLoader('export { clientLoader } from "./loaders";'), 'clientLoader');
  assert.equal(detectClientLoader('export { load as clientLoader } from "./loaders";'), 'clientLoader');
  assert.equal(detectClientLoader('function load(){ return {}; } export { load as clientLoader };'), 'clientLoader');
  assert.equal(detectClientLoader('export type { clientLoader } from "./loaders";'), undefined);
  assert.equal(detectClientLoader('export { clientLoader as load } from "./loaders";'), undefined);
});

test('detectServerLoader uses the same declaration rules for the server-only export', () => {
  assert.equal(detectServerLoader('export async function serverLoader(){ return {}; }'), 'serverLoader');
  assert.equal(detectServerLoader('export const serverLoader = () => ({});'), 'serverLoader');
  assert.equal(detectServerLoader('export { load as serverLoader } from "./loaders";'), 'serverLoader');
  assert.equal(detectServerLoader('// export function serverLoader(){}\nexport default () => null;'), undefined);
  assert.equal(detectServerLoader('const text = "export function serverLoader";'), undefined);
  assert.equal(detectServerLoader('declare function serverLoader(): void;'), undefined);
  assert.equal(detectServerLoader('export type { serverLoader } from "./loaders";'), undefined);
  assert.equal(detectServerLoader('export { serverLoader as load } from "./loaders";'), undefined);
});

test('conventional routes pick up clientLoader exports from page files', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-page-loaders 中文-')));
  await mkdir(join(root, 'src/pages/member'), { recursive: true });
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default function Home(){return null;}\nexport const clientLoader = async () => ({ home: true });');
  await writeFile(join(root, 'src/pages/member/[id].tsx'), 'export default function Member(){return null;}\nexport async function clientLoader({ params }: { params: Record<string, string | undefined> }) { return { id: params.id }; }');
  t.after(() => rm(root, { recursive: true, force: true }));

  const { pageLoaders } = await import('@cormijs/plugin-react');
  const loaders = await pageLoaders(root, ['src/pages/index.tsx', 'src/pages/member/[id].tsx']);
  assert.deepEqual(loaders, { 'src/pages/index.tsx': 'clientLoader', 'src/pages/member/[id].tsx': 'clientLoader' });
  const routes = routesFromFiles(['src/pages/index.tsx', 'src/pages/member/[id].tsx'], 'src/pages', loaders);
  assert.equal(routes.find(route => route.id === 'file:src/pages/index.tsx')?.clientLoader, 'clientLoader');
  assert.equal(routes.find(route => route.id === 'file:src/pages/member/[id].tsx')?.clientLoader, 'clientLoader');
  // Pages without the export stay plain lazy routes.
  const plain = routesFromFiles(['src/pages/index.tsx'], 'src/pages', {});
  assert.equal(plain[0]?.clientLoader, undefined);
  assert.throws(() => routesFromFiles(['src/pages/index.tsx'], 'src/pages', { 'src/pages/index.tsx': '2bad' }), (error: any) => error?.code === 'ROUTE_CLIENT_LOADER_INVALID');
});

test('page scan separates serverLoader files and never marks plain pages', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-page-server-loaders 中文-')));
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default function Home(){return null;}\nexport const clientLoader = () => ({});');
  await writeFile(join(root, 'src/pages/secret.tsx'), 'export default function Secret(){return null;}\nexport async function serverLoader(){ return { token: "server" }; }');
  await writeFile(join(root, 'src/pages/plain.tsx'), 'export default function Plain(){return null;}');
  t.after(() => rm(root, { recursive: true, force: true }));

  const files = ['src/pages/index.tsx', 'src/pages/secret.tsx', 'src/pages/plain.tsx'];
  const scanned = await pageLoaderExports(root, files);
  assert.deepEqual(scanned.clientLoaders, { 'src/pages/index.tsx': 'clientLoader' });
  assert.deepEqual(scanned.serverLoaders, { 'src/pages/secret.tsx': 'serverLoader' });
  const routes = routesFromFiles(files, 'src/pages', scanned.clientLoaders, scanned.serverLoaders);
  assert.equal(routes.find(route => route.id === 'file:src/pages/secret.tsx')?.serverLoader, 'serverLoader');
  assert.equal(routes.find(route => route.id === 'file:src/pages/plain.tsx')?.serverLoader, undefined);
  assert.throws(() => routesFromFiles(files, 'src/pages', {}, { 'src/pages/secret.tsx': '2bad' }), (error: any) => error?.code === 'ROUTE_SERVER_LOADER_INVALID');
});
