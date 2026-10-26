import { FederationRouteError, routePrefix } from './merge.js';
import { modulePattern, namePattern, type FederationRemote } from './types.js';

export const MANIFEST_FORMAT = 'cormi:federation:1';
export const MANIFEST_FILE = 'cormi-federation.json';
const MANIFEST_LIMIT = 128 * 1024;

export interface FederationManifest {
  readonly format: typeof MANIFEST_FORMAT;
  readonly name: string;
  readonly entry: string;
  readonly routes?: string;
  readonly prefix?: string;
  readonly version?: string;
  readonly buildId?: string;
}

function fail(message: string): never {
  throw new FederationRouteError('FEDERATION_MANIFEST_INVALID', message);
}

/** Accepts one comma/space separated string or an array and returns bounded, validated public roots. */
export function normalizePublicUrls(input: unknown, source = 'publicUrls'): readonly string[] {
  if (input === undefined || input === null || input === '') return Object.freeze([]);
  const values = typeof input === 'string' ? input.split(/[\s,]+/).filter(Boolean)
    : Array.isArray(input) ? input : fail(`${source} must be a URL string or an array of URLs.`);
  if (values.length > 32) fail(`${source} supports at most 32 URLs.`);
  const urls = values.map(value => {
    if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\]/.test(value)) fail(`${source} contains an invalid URL.`);
    const absolute = /^https?:\/\//.test(value);
    if (!absolute && (!value.startsWith('/') || value.startsWith('//'))) fail(`${source} URLs must be http(s) or root-relative.`);
    if (value.split(/[?#]/)[0]!.split('/').some(segment => segment === '.' || segment === '..')) fail(`${source} contains an unsafe path.`);
    let url: URL;
    try { url = new URL(value, 'http://cormi.local'); }
    catch { fail(`${source} contains an invalid URL.`); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash
      || url.pathname.split('/').some(segment => segment === '.' || segment === '..')) {
      fail(`${source} contains an unsafe URL.`);
    }
    return absolute ? url.href : url.pathname + url.search;
  });
  return Object.freeze([...new Set(urls)]);
}

/** Optional per-remote overrides; an empty or '/' value removes a manifest-declared prefix. */
export function normalizePrefixes(input: unknown): Readonly<Record<string, string>> | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Prefix overrides must be an object.');
  const entries = Object.entries(input);
  if (entries.length > 64) fail('Prefix overrides support at most 64 remotes.');
  const prefixes: Record<string, string> = {};
  for (const [name, target] of entries) {
    if (!namePattern.test(name) || typeof target !== 'string') fail('Invalid prefix override.');
    try { routePrefix(target); }
    catch (error) { fail(`Invalid prefix override for "${name}": ${error instanceof Error ? error.message : String(error)}`); }
    prefixes[name] = target;
  }
  return Object.freeze(prefixes);
}

/** A base URL gains /cormi-federation.json; an explicit .json URL is used as-is. */
export function manifestUrlFor(input: string, base: string): string {
  let url: URL;
  try { url = new URL(input, base); }
  catch { return fail('Manifest source is not a valid URL.'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) fail('Manifest source must be an http(s) URL.');
  if (!url.pathname.endsWith('.json')) {
    url.pathname = url.pathname.replace(/\/+$/, '') + '/' + MANIFEST_FILE;
  }
  return url.href;
}

function text(value: unknown, field: string, limit = 128): string {
  if (typeof value !== 'string' || !value || value.length > limit || /[\0-\x1f\x7f]/.test(value)) fail(`Manifest ${field} must be bounded text.`);
  return value;
}

/** Parses a manifest or an npm package.json carrying `cormi.federation`; entry stays absolute for the runtime. */
export function parseFederationManifest(payload: unknown, sourceUrl: string): FederationManifest {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Manifest must be a JSON object.');
  let source: URL;
  try { source = new URL(sourceUrl); }
  catch { fail('Manifest source is not a valid URL.'); }
  let value = payload as Record<string, unknown>;
  if (source.pathname.endsWith('/package.json')) {
    const cormi = value.cormi;
    const federation = cormi && typeof cormi === 'object' && !Array.isArray(cormi) ? (cormi as Record<string, unknown>).federation : undefined;
    if (!federation || typeof federation !== 'object' || Array.isArray(federation)) fail('package.json has no cormi.federation manifest.');
    value = federation as Record<string, unknown>;
  }
  if (value.format !== MANIFEST_FORMAT) fail(`Unsupported federation manifest format; expected ${MANIFEST_FORMAT}.`);
  if (typeof value.name !== 'string' || !namePattern.test(value.name)) fail('Manifest name is invalid.');
  const entryValue = text(value.entry, 'entry', 2048);
  let entry: URL;
  try { entry = new URL(entryValue, sourceUrl); }
  catch { fail('Manifest entry is not a valid URL.'); }
  if (!/^https?:$/.test(entry.protocol) || entry.username || entry.password) fail('Manifest entry must resolve to an http(s) URL.');
  const routes = value.routes === undefined ? undefined : (() => {
    if (typeof value.routes !== 'string' || !modulePattern.test(value.routes) || value.routes.includes('..')) fail('Manifest routes must look like "./routes".');
    return value.routes;
  })();
  if (value.hasRoutes === true && routes === undefined) fail('Manifest hasRoutes requires a routes expose.');
  if (value.hasRoutes !== undefined && typeof value.hasRoutes !== 'boolean') fail('Manifest hasRoutes must be boolean.');
  const prefix = routePrefix(value.prefix);
  const version = value.version === undefined ? undefined : text(value.version, 'version', 64);
  const buildId = value.buildId === undefined ? undefined : text(value.buildId, 'buildId', 128);
  if (buildId) entry.searchParams.set('v', buildId);
  return Object.freeze({ format: MANIFEST_FORMAT, name: value.name, entry: entry.href,
    ...(routes === undefined ? {} : { routes }), ...(prefix === undefined ? {} : { prefix }),
    ...(version === undefined ? {} : { version }), ...(buildId === undefined ? {} : { buildId }) });
}

/** A manifest without a routes expose registers no route tree; static component exposes remain independent. */
export function manifestRemote(manifest: FederationManifest, prefix?: string): FederationRemote | undefined {
  if (!manifest.routes) return undefined;
  const effective = prefix ?? manifest.prefix;
  return Object.freeze({ name: manifest.name, entry: manifest.entry, module: manifest.routes,
    ...(effective === undefined ? {} : { prefix: effective }), required: true });
}

export { MANIFEST_LIMIT };
