import type { RuntimePlugin } from '@cormijs/runtime';
import { init, loadRemote } from '@module-federation/runtime';
import { FederationRouteError, mergeFederatedRoutes, routePrefix } from './merge.js';
import { MANIFEST_LIMIT, manifestRemote, manifestUrlFor, normalizePrefixes, normalizePublicUrls, parseFederationManifest,
  type FederationManifest } from './manifest.js';
import { DEFAULT_ROUTE_TIMEOUT, modulePattern, namePattern, type FederationRemote, type FederationRuntimeOptions } from './types.js';

export { FederationRouteError, mergeFederatedRoutes, routePrefix } from './merge.js';
export { MANIFEST_FORMAT, manifestRemote, manifestUrlFor, normalizePrefixes, normalizePublicUrls, parseFederationManifest, type FederationManifest } from './manifest.js';
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
  let prefixes: Readonly<Record<string, string>> | undefined;
  try { prefixes = normalizePrefixes(input.prefixes); }
  catch (error) { fail(error instanceof Error ? error.message : 'Invalid federation prefix overrides.'); }
  let publicUrls: readonly string[];
  try { publicUrls = normalizePublicUrls(input.publicUrls ?? []); }
  catch (error) { fail(error instanceof Error ? error.message : 'Invalid federation public URLs.'); }
  const timeout = input.timeout ?? DEFAULT_ROUTE_TIMEOUT;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1000 || timeout > 120_000) fail('Invalid federation route timeout.');
  return Object.freeze({ name: typeof input.name === 'string' ? input.name : 'cormiHost', remotes: Object.freeze(remotes),
    publicUrls, ...(prefixes === undefined ? {} : { prefixes }), timeout });
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

async function loadManifest(source: string, signal: AbortSignal): Promise<FederationManifest> {
  const base = typeof location === 'undefined' ? 'http://localhost/' : location.href;
  const url = manifestUrlFor(source, base);
  let response: Response;
  try {
    response = await fetch(url, { signal, cache: 'no-store', headers: { accept: 'application/json' } });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new FederationRouteError('FEDERATION_MANIFEST_FAILED', `Manifest "${url}" could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new FederationRouteError('FEDERATION_MANIFEST_FAILED', `Manifest "${url}" returned HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MANIFEST_LIMIT) throw new FederationRouteError('FEDERATION_MANIFEST_FAILED', `Manifest "${url}" exceeds ${MANIFEST_LIMIT} bytes.`);
  const body = await response.text();
  if (body.length > MANIFEST_LIMIT) throw new FederationRouteError('FEDERATION_MANIFEST_FAILED', `Manifest "${url}" exceeds ${MANIFEST_LIMIT} bytes.`);
  let payload: unknown;
  try { payload = JSON.parse(body); }
  catch { throw new FederationRouteError('FEDERATION_MANIFEST_INVALID', `Manifest "${url}" is not valid JSON.`); }
  try { return parseFederationManifest(payload, url); }
  catch (error) {
    throw new FederationRouteError(error instanceof FederationRouteError ? error.code : 'FEDERATION_MANIFEST_INVALID',
      `Manifest "${url}" is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function discoverRemotes(config: FederationRuntimeOptions, signal: AbortSignal): Promise<FederationRemote[]> {
  const scope = globalThis as { __CORMI_PACKAGE_PUBLIC_URL__?: unknown };
  let publicUrls = config.publicUrls;
  if (scope.__CORMI_PACKAGE_PUBLIC_URL__ !== undefined) {
    try { publicUrls = normalizePublicUrls(scope.__CORMI_PACKAGE_PUBLIC_URL__, 'window.__CORMI_PACKAGE_PUBLIC_URL__'); }
    catch (error) { fail(error instanceof Error ? error.message : 'Invalid window.__CORMI_PACKAGE_PUBLIC_URL__.'); }
  }
  const manifests = await Promise.all(publicUrls.map(async source => {
    try { return await bounded(loadManifest(source, signal), config.timeout, signal, `Manifest "${source}"`); }
    catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof FederationRouteError) throw error;
      throw new FederationRouteError('FEDERATION_MANIFEST_FAILED', `Manifest "${source}" failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  const names = new Set(config.remotes.map(remote => remote.name));
  const discovered: FederationRemote[] = [];
  for (const manifest of manifests) {
    const remote = manifestRemote(manifest, config.prefixes?.[manifest.name]);
    if (!remote) continue;
    if (names.has(remote.name)) {
      throw new FederationRouteError('FEDERATION_MANIFEST_CONFLICT', `Remote "${remote.name}" is declared both statically and by a public manifest.`);
    }
    names.add(remote.name);
    discovered.push(remote);
  }
  return [...config.remotes, ...discovered];
}

/**
 * Browser runtime for remote route merging. Dependencies resolve through Module Federation;
 * route trees are merged before the router is created, so deep links and menus include remotes.
 * Public manifests are fetched at startup, so deployment can compose independently built apps.
 */
export const federationRuntime: RuntimePlugin = {
  async routes({ routes, options, signal }) {
    const config = runtimeOptions(options);
    const remotes = await discoverRemotes(config, signal);
    if (!remotes.length) return;
    init({ name: 'cormiHost', remotes: remotes.map(remote => ({ name: remote.name, entry: remote.entry, type: 'module' as const })), shared: {} });
    for (const remote of remotes) {
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
