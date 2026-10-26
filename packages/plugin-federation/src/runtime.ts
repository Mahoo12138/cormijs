import type { RuntimePlugin } from '@cormijs/runtime';
import { init, loadRemote } from '@module-federation/runtime';
import { FederationRouteError, mergeFederatedRoutes, routePrefix } from './merge.js';
import { DEFAULT_ROUTE_TIMEOUT, modulePattern, namePattern, type FederationRemote, type FederationRuntimeOptions } from './types.js';

export { FederationRouteError, mergeFederatedRoutes, routePrefix } from './merge.js';
export type { FederationPluginOptions, FederationRemote, FederationRemoteOptions, FederationRuntimeOptions } from './types.js';

function fail(message: string): never {
  throw new FederationRouteError('FEDERATION_INVALID', message);
}

function runtimeOptions(value: unknown): FederationRuntimeOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Missing federation runtime options.');
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.remotes)) fail('Federation remotes must be an array.');
  const names = new Set<string>();
  const remotes: FederationRemote[] = input.remotes.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Invalid federation remote.');
    const remote = raw as Record<string, unknown>;
    if (typeof remote.name !== 'string' || !namePattern.test(remote.name) || names.has(remote.name)) fail('Invalid or duplicate federation remote name.');
    names.add(remote.name);
    if (typeof remote.entry !== 'string' || !(remote.entry.startsWith('/') && !remote.entry.startsWith('//') || /^https?:\/\//.test(remote.entry))) {
      fail(`Remote "${remote.name}" has an invalid entry.`);
    }
    const module = remote.module ?? './routes';
    if (typeof module !== 'string' || !modulePattern.test(module) || module.includes('..')) fail(`Remote "${remote.name}" has an invalid module.`);
    let prefix: string | undefined;
    try { prefix = routePrefix(remote.prefix); }
    catch (error) { fail(`Remote "${remote.name}" has an invalid prefix: ${error instanceof Error ? error.message : String(error)}`); }
    return Object.freeze({ name: remote.name, entry: remote.entry, module, ...(prefix === undefined ? {} : { prefix }),
      required: remote.required !== false });
  });
  const timeout = input.timeout ?? DEFAULT_ROUTE_TIMEOUT;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1000 || timeout > 120_000) fail('Invalid federation route timeout.');
  return Object.freeze({ name: typeof input.name === 'string' ? input.name : 'cormiHost', remotes: Object.freeze(remotes), timeout });
}

function bounded<T>(task: Promise<T>, timeout: number, signal: AbortSignal, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error(`${label} was cancelled`));
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    signal.addEventListener('abort', abort, { once: true });
    task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

async function routeValue(value: unknown, remote: string): Promise<unknown> {
  if (!value || typeof value !== 'object') fail(`Remote "${remote}" returned no route module.`);
  const module = value as Record<string, unknown>;
  const loader = typeof module.getRoutes === 'function' ? module.getRoutes : typeof module.default === 'function' ? module.default : undefined;
  if (loader) return await (loader as () => unknown)();
  if (Array.isArray(module.default)) return module.default;
  if (Array.isArray(module.routes)) return module.routes;
  fail(`Remote "${remote}" does not export getRoutes or a route array.`);
}

/**
 * Browser runtime for remote route merging. Dependencies resolve through Module Federation;
 * route trees are merged before the router is created, so deep links and menus include remotes.
 */
export const federationRuntime: RuntimePlugin = {
  async routes({ routes, options, signal }) {
    const config = runtimeOptions(options);
    if (!config.remotes.length) return;
    init({ name: 'cormiHost', remotes: config.remotes.map(remote => ({ name: remote.name, entry: remote.entry, type: 'module' as const })), shared: {} });
    for (const remote of config.remotes) {
      try {
        const key = remote.module.startsWith('./') ? remote.module.slice(2) : remote.module;
        const module = await bounded(loadRemote<unknown>(`${remote.name}/${key}`), config.timeout, signal, `Remote "${remote.name}"`);
        mergeFederatedRoutes(routes, await routeValue(module, remote.name), remote);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (remote.required) {
          throw new FederationRouteError('FEDERATION_REMOTE_FAILED', `Remote "${remote.name}" could not be merged: ${error instanceof Error ? error.message : String(error)}`);
        }
        console.error(`[cormijs:federation] optional remote "${remote.name}" was skipped`, error);
      }
    }
  },
};
