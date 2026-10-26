import { CormiError, type Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-react';
import type {} from '@cormijs/plugin-vite';
import { federation, type ModuleFederationOptions } from '@module-federation/vite';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { PluginOption, Plugin as VitePlugin, ResolvedConfig } from 'vite';
import { MANIFEST_FILE, MANIFEST_FORMAT, normalizePrefixes, normalizePublicUrls } from './manifest.js';
import { routePrefix } from './merge.js';
import { DEFAULT_ROUTE_TIMEOUT, DEFAULT_SHARED, modulePattern, namePattern,
  type FederationPluginOptions, type FederationRemote, type FederationRuntimeOptions } from './types.js';

export { mergeFederatedRoutes, routePrefix, FederationRouteError, type RemoteRouteSource } from './merge.js';
export { MANIFEST_FILE, MANIFEST_FORMAT, manifestRemote, manifestUrlFor, normalizePrefixes, normalizePublicUrls, parseFederationManifest, type FederationManifest } from './manifest.js';
export { federationRuntime, type FederationPluginOptions, type FederationRemote, type FederationRemoteOptions, type FederationRuntimeOptions } from './runtime.js';

interface FederationSettings {
  readonly id: string;
  readonly name: string;
  readonly exposes: Readonly<Record<string, string>>;
  readonly exposeRoutes: boolean;
  readonly prefix?: string;
  readonly version?: string;
  readonly remotes: readonly FederationRemote[];
  readonly publicUrls: readonly string[];
  readonly publicUrlsProvided: boolean;
  readonly prefixes?: Readonly<Record<string, string>>;
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

function boundedText(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value || value.length > limit || /[\0-\x1f\x7f]/.test(value)) invalid(`${field} must be bounded text.`);
  return value;
}

function settings(options: FederationPluginOptions): FederationSettings {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !['id', 'name', 'exposes', 'exposeRoutes', 'prefix', 'version', 'remotes', 'publicUrls', 'prefixes', 'shared', 'routeTimeout'].includes(key))) {
    invalid('Invalid federation plugin options.');
  }
  const id = options.id ?? 'cormi:federation';
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) invalid('Invalid federation plugin id.');
  if (typeof options.name !== 'string' || !namePattern.test(options.name)) {
    invalid('Federation name must be a container name (letters, digits, dot, underscore or hyphen).');
  }
  const exposeRoutes = options.exposeRoutes ?? false;
  if (typeof exposeRoutes !== 'boolean') invalid('exposeRoutes must be boolean.');
  let prefix: string | undefined;
  try { prefix = routePrefix(options.prefix); }
  catch (error) { invalid(error instanceof Error ? error.message : 'Invalid manifest prefix.'); }
  const version = options.version === undefined ? undefined : boundedText(options.version, 'version', 64);
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
    let remotePrefix: string | undefined;
    try { remotePrefix = routePrefix(remote.prefix); }
    catch (error) { invalid(error instanceof Error ? error.message : 'Invalid remote prefix.', { remote: remote.name }); }
    return Object.freeze({ name: remote.name, entry: remoteEntry(remote.entry, remote.name), module,
      ...(remotePrefix === undefined ? {} : { prefix: remotePrefix }), required: remote.required !== false });
  });
  const envPublicUrls = process.env.PACKAGE_PUBLIC_URL;
  const rawPublicUrls = options.publicUrls !== undefined ? options.publicUrls : envPublicUrls;
  const publicUrlsProvided = options.publicUrls !== undefined || (typeof envPublicUrls === 'string' && envPublicUrls.trim() !== '');
  let publicUrls: readonly string[] = Object.freeze([]);
  try { publicUrls = normalizePublicUrls(rawPublicUrls); }
  catch (error) { invalid(error instanceof Error ? error.message : 'Invalid public URLs.'); }
  let prefixes: Readonly<Record<string, string>> | undefined;
  try { prefixes = normalizePrefixes(options.prefixes); }
  catch (error) { invalid(error instanceof Error ? error.message : 'Invalid prefix overrides.'); }
  const shared = options.shared ?? DEFAULT_SHARED;
  if (!Array.isArray(shared) || shared.length > 128) invalid('Federation shared must be an array of package names.');
  for (const name of shared) {
    if (typeof name !== 'string' || !name || name.length > 128 || name.startsWith('.') || name.startsWith('/')
      || name.includes('..') || /[\s\\]/.test(name)) invalid('Invalid shared package name.', { shared: name });
  }
  const timeout = options.routeTimeout ?? DEFAULT_ROUTE_TIMEOUT;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1000 || timeout > 120_000) invalid('routeTimeout must be an integer between 1000 and 120000.');
  return Object.freeze({ id, name: options.name, exposes: Object.freeze(exposes), exposeRoutes,
    ...(prefix === undefined ? {} : { prefix }), ...(version === undefined ? {} : { version }),
    remotes: Object.freeze(remotes), publicUrls, publicUrlsProvided,
    ...(prefixes === undefined ? {} : { prefixes }), shared: Object.freeze([...shared]), timeout });
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

function manifestSource(settings: FederationSettings, buildId: string): string {
  return JSON.stringify({ format: MANIFEST_FORMAT, name: settings.name, entry: './remoteEntry.js',
    hasRoutes: settings.exposeRoutes, ...(settings.exposeRoutes ? { routes: './routes' } : {}),
    ...(settings.prefix === undefined ? {} : { prefix: settings.prefix }),
    ...(settings.version === undefined ? {} : { version: settings.version }), buildId }, null, 2) + '\n';
}

/** Generated exposes are transient; the manifest is served in dev and written beside the production entry. */
function sourcePlugin(settings: FederationSettings): VitePlugin {
  let root: string | undefined, resolved: ResolvedConfig | undefined, written = false;
  const buildId = Date.now().toString(36);
  const file = (name: string) => join(root!, '.cormi', name);
  const manifest = () => manifestSource(settings, buildId);
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
    configResolved(config) { resolved = config; root = config.root; },
    configureServer(server) {
      const base = server.config.base.endsWith('/') ? server.config.base : server.config.base + '/';
      const paths = new Set(['/' + MANIFEST_FILE, base + MANIFEST_FILE]);
      server.middlewares.use((request, response, next) => {
        let pathname: string;
        try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; }
        catch { return next(); }
        if (!paths.has(pathname) || request.method !== 'GET' && request.method !== 'HEAD') return next();
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('cache-control', 'no-store');
        response.setHeader('access-control-allow-origin', '*');
        response.end(request.method === 'HEAD' ? undefined : manifest());
      });
    },
    async closeBundle() {
      await clean();
      if (!resolved || resolved.command !== 'build') return;
      const target = join(resolved.build.outDir, MANIFEST_FILE);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, manifest());
    },
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
    if (config.remotes.length || config.publicUrls.length || config.publicUrlsProvided) {
      const runtime: FederationRuntimeOptions = { name: config.name, remotes: config.remotes, publicUrls: config.publicUrls,
        ...(config.prefixes === undefined ? {} : { prefixes: config.prefixes }), timeout: config.timeout };
      const contribution: RuntimeContribution = { id: config.id + ':runtime', module: { specifier: '@cormijs/plugin-federation/runtime', exportName: 'federationRuntime' }, options: runtime };
      ctx.effect(() => ctx.react.runtime.tap({ id: config.id + ':runtime', owner: config.id, ownerOrder: 0, run: () => [contribution] }));
    }
  },
};
