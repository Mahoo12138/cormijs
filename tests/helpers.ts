import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { CormiError, type Plugin } from '@cormijs/core';
import type { Builder, BuildPlan } from '@cormijs/builder';

export function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
export const hasCode = (code: string) => (error: unknown) => error instanceof CormiError && error.code === code;
export function hasCause(error: unknown, expected: unknown): boolean {
  if (error === expected) return true;
  if (error instanceof AggregateError && error.errors.some(value => hasCause(value, expected))) return true;
  return error instanceof Error && error.cause !== undefined && hasCause(error.cause, expected);
}
export async function fixture(base = '/'): Promise<{ root: string; plan: BuildPlan; clean(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'cormi-fixture-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><title>Cormi P0</title></head><body><main id="app">Cormi</main><script type="module" src="/main.ts"></script></body></html>');
  await writeFile(join(root, 'main.ts'), 'const value: string = "Cormi ready"; document.getElementById("app")!.textContent = value;');
  return { root, plan: { root, entry: 'index.html', outDir: 'dist', base, mode: 'test' }, clean: () => rm(root, { recursive: true, force: true }) };
}
export function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No TCP address'));
      resolve(address.port);
    });
  });
}
export function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}
export async function assertPortFree(port: number): Promise<void> {
  const server = createServer();
  await listen(server, port);
  await close(server);
}
export function fakeBuilder(name: string, calls: string[], closed: string[] = []): Plugin.Object<void> {
  const handle = async () => {
    let ended = false;
    return { url: 'http://127.0.0.1:1/', close: async () => { if (!ended) { ended = true; closed.push(name); } } };
  };
  return { name, apply: ctx => {
    ctx.provide('builder', {
      name, build: async plan => { calls.push(name); return { backend: name, outDir: plan.outDir }; },
      dev: handle, preview: handle,
    } satisfies Builder);
  } };
}
