import { CormiError, type Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-react';
import type {} from '@cormijs/plugin-vite';
import { federation, type ModuleFederationOptions } from '@module-federation/vite';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { PluginOption, Plugin as VitePlugin } from 'vite';
import { routePrefix } from './merge.js';
import { DEFAULT_ROUTE_TIMEOUT, DEFAULT_SHARED, modulePattern, namePattern,
  type FederationPluginOptions, type FederationRemote, type FederationRuntimeOptions } from './types.js';

export { mergeFederatedRoutes, routePrefix, FederationRouteError, type RemoteRouteSource } from './merge.js';
export { federationRuntime, type FederationPluginOptions, type FederationRemote, type FederationRemoteOptions, type FederationRuntimeOptions } from './runtime.js';

interface FederationSettings {
  readonly id: string;
  readonly name: string;
  readonly exposes: Readonly<Record<string, string>>;
  readonly exposeRoutes: boolean;
  readonly remotes: readonly FederationRemote[];
  readonly shared: readonly string[];
  readonly timeout: number;
}
interface RuntimeContribution {
  readonly id: string;
  readonly module: { readonly specifier: string; readonly exportName: string };
  readonly options?: unknown;
}

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new CormiError('FEDERATION_INVALID', message, details);
}

function sourcePath(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value || value.length > 256 || value.includes('\\') || isAbsolute(value)) {
    invalid('Exposed source must be a project-relative path.', { expose: key });
  }
  const local = value.replace(/^\.\//, '');
  if (!local || local.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment === 'node_modules')
    || !/\.[cm]?[jt]sx?$/.test(local) || /\.server\.[cm]?[jt]sx?$/.test(local)) {
    invalid('Exposed source must be a browser source file inside the project.', { expose: key, source: value });
  }
  return value;
}

function remoteEntry(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\]/.test(value)) invalid('Remote entry must be a URL or root-relative path.', { remote: name });
  if (/^https?:\/\//.test(value)) {
    try {
      const url = new URL(value);
      if (!url.hostname) invalid('Remote entry URL must have a host.', { remote: name });
    } catch { invalid('Remote entry is not a valid URL.', { remote: name }); }
    return value;
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.split(/[?#]/)[0]!.split('/').some(segment => segment === '..' || segment === '.')) {
    invalid('Remote entry must be an absolute http(s) URL or a root-relative path.', { remote: name });
  }
  return value;
}

function settings(options: FederationPluginOptions): FederationSettings {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !['id', 'name', 'exposes', 'exposeRoutes', 'remotes', 'shared', 'routeTimeout'].includes(key))) {
    invalid('Invalid federation plugin options.');
  }
  const id = options.id ?? 'cormi:federation';
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) invalid('Invalid federation plugin id.');
  if (typeof options.name !== 'string' || !namePattern.test(options.name)) {
    invalid('Federation name must be a container name (letters, digits, dot, underscore or hyphen).');
  }
  const exposeRoutes = options.exposeRoutes ?? false;
  if (typeof exposeRoutes !== 'boolean') invalid('exposeRoutes must be boolean.');
  const exposes: Record<string, string> = {};
  const rawExposes = options.exposes ?? {};
  if (!rawExposes || typeof rawExposes !== 'object' || Array.isArray(rawExposes) || Object.keys(rawExposes).length > 64) invalid('Invalid exposes map.');
  for (const [key, value] of Object.entries(rawExposes)) {
    if (!modulePattern.test(key) || key.includes('..')) invalid('Expose keys must look like "./widget".', { expose: key });
    exposes[key] = sourcePath(value, key);
  }
  if (exposeRoutes) {
    if (exposes['./routes']) invalid('exposeRoutes conflicts with an explicit "./routes" expose.');
    exposes['./routes'] = './.cormi/federation-routes.ts';
  }
  const rawRemotes = options.remotes ?? [];
  if (!Array.isArray(rawRemotes) || rawRemotes.length > 32) invalid('Federation remotes must be an array of at most 32 entries.');
  const names = new Set<string>();
  const remotes: FederationRemote[] = rawRemotes.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).some(key => !['name', 'entry', 'module', 'prefix', 'required'].includes(key))) invalid('Invalid federation remote.');
    const remote = raw as Record<string, unknown>;
    if (typeof remote.name !== 'string' || !namePattern.test(remote.name) || names.has(remote.name)) invalid('Invalid or duplicate federation remote name.');
    names.add(remote.name);
    const module = remote.module ?? './routes';
    if (typeof module !== 'string' || !modulePattern.test(module) || module.includes('..')) invalid('Remote module must look like "./routes".', { remote: remote.name });
    if (remote.required !== undefined && typeof remote.required !== 'boolean') invalid('Remote required must be boolean.', { remote: remote.name });
    let prefix: string | undefined;
    try { prefix = routePrefix(remote.prefix); }
    catch (error) { invalid(error instanceof Error ? error.message : 'Invalid remote prefix.', { remote: remote.name }); }
    return Object.freeze({ name: remote.name, entry: remoteEntry(remote.entry, remote.name), module,
      ...(prefix === undefined ? {} : { prefix }), required: remote.required !== false });
  });
  const shared = options.shared ?? DEFAULT_SHARED;
  if (!Array.isArray(shared) || shared.length > 128) invalid('Federation shared must be an array of package names.');
  for (const name of shared) {
    if (typeof name !== 'string' || !name || name.length > 128 || name.startsWith('.') || name.startsWith('/')
      || name.includes('..') || /[\s\\]/.test(name)) invalid('Invalid shared package name.', { shared: name });
  }
  const timeout = options.routeTimeout ?? DEFAULT_ROUTE_TIMEOUT;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1000 || timeout > 120_000) invalid('routeTimeout must be an integer between 1000 and 120000.');
  return Object.freeze({ id, name: options.name, exposes: Object.freeze(exposes), exposeRoutes, remotes: Object.freeze(remotes),
    shared: Object.freeze([...shared]), timeout });
}

function routesSource(name: string): string {
  return `const cormiFederation = Object.freeze({ name: ${JSON.stringify(name)}, version: 1 });
async function loadRoutes() {
  const scope = globalThis as { __CORMI_MICRO_APP__?: boolean };
  const previous = scope.__CORMI_MICRO_APP__;
  scope.__CORMI_MICRO_APP__ = true;
  try {
    const application = await import('./app');
    return application.cormiApplication.routes;
  } finally {
    if (previous === undefined) delete scope.__CORMI_MICRO_APP__;
    else scope.__CORMI_MICRO_APP__ = previous;
  }
}
export { cormiFederation };
export function getRoutes() { return loadRoutes(); }
export default getRoutes;
`;
}

/** Generated exposes are transient: Vite reads them during the session and cleanup removes them afterwards. */
function sourcePlugin(settings: FederationSettings): VitePlugin {
  let root: string | undefined, written = false;
  const file = (name: string) => join(root!, '.cormi', name);
  const clean = async () => {
    if (!written || !root) return;
    written = false;
    await rm(file('federation-routes.ts'), { force: true });
  };
  return {
    name: settings.id + ':routes-source',
    enforce: 'pre',
    async config(config) {
      if (!settings.exposeRoutes) return;
      root = resolve(config.root ?? process.cwd());
      await mkdir(join(root, '.cormi'), { recursive: true });
      await writeFile(file('federation-routes.ts'), routesSource(settings.name));
      written = true;
    },
    async closeBundle() { await clean(); },
    async closeWatcher() { await clean(); },
  };
}

/** Module Federation build integration plus a browser runtime that merges remote route trees. */
export const federationPlugin: Plugin.Object<FederationPluginOptions> = {
  name: 'cormi:federation', inject: ['react', 'vite'],
  apply(ctx, options = {} as FederationPluginOptions) {
    const config = settings(options);
    const shared = Object.fromEntries(config.shared.map(name => [name, { singleton: true }])) as NonNullable<ModuleFederationOptions['shared']>;
    ctx.effect(() => ctx.vite.add(config.id, (): PluginOption => [
      sourcePlugin(config),
      federation({
        name: config.name,
        filename: 'remoteEntry.js',
        exposes: config.exposes,
        shared,
        dts: false,
      }),
    ]));
    if (config.remotes.length) {
      const runtime: FederationRuntimeOptions = { name: config.name, remotes: config.remotes, timeout: config.timeout };
      const contribution: RuntimeContribution = { id: config.id + ':runtime', module: { specifier: '@cormijs/plugin-federation/runtime', exportName: 'federationRuntime' }, options: runtime };
      ctx.effect(() => ctx.react.runtime.tap({ id: config.id + ':runtime', owner: config.id, ownerOrder: 0, run: () => [contribution] }));
    }
  },
};
