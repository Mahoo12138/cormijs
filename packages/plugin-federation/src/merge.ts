import type { RouteObject } from 'react-router';

export interface RemoteRouteSource {
  readonly name: string;
  readonly prefix?: string;
}

export class FederationRouteError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'FederationRouteError';
  }
}

const ROUTE_LIMIT = 2048;
const DEPTH_LIMIT = 64;

function fail(code: string, message: string): never {
  throw new FederationRouteError(code, message);
}

/** Accepts '/' or '/team/' and returns undefined or a canonical prefix without a trailing slash. */
export function routePrefix(input: unknown): string | undefined {
  if (input === undefined || input === '' || input === '/') return undefined;
  if (typeof input !== 'string' || !input.startsWith('/') || input.endsWith('/')
    || input.startsWith('//') || /[*?#\\\s]/.test(input)
    || input.split('/').slice(1).some(segment => segment === '.' || segment === '..')) {
    fail('FEDERATION_ROUTE_INVALID', 'Remote route prefix must be an absolute path without a trailing slash.');
  }
  return input;
}

function join(parent: string, path: string): string {
  if (path.startsWith('/')) return path.replace(/\/+$/, '') || '/';
  const base = parent === '/' ? '' : parent;
  return (base + '/' + path).replace(/\/{2,}/g, '/');
}

function collect(routes: readonly RouteObject[], parent: string, ids: Set<string>, paths: Set<string>, depth = 0): void {
  if (depth > DEPTH_LIMIT) fail('FEDERATION_ROUTE_INVALID', 'Route tree exceeds the supported depth.');
  for (const route of routes) {
    if (typeof route.id === 'string') ids.add(route.id);
    const path = route.index ? parent || '/' : route.path === undefined ? parent : join(parent, route.path);
    if (route.path !== undefined || route.index === true) paths.add(path);
    collect(route.children ?? [], path, ids, paths, depth + 1);
  }
}

function pathValue(route: RouteObject): string | undefined {
  const value: unknown = route.path;
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.includes('*')) {
    fail('FEDERATION_ROUTE_INVALID', 'Federated route paths must be literal strings without a wildcard.');
  }
  return value;
}

/**
 * Clones one remote route tree, namespaces ids, applies the optional prefix wrapper,
 * and rejects exact path collisions with routes already mounted by the host.
 */
export function mergeFederatedRoutes(target: RouteObject[], input: unknown, source: RemoteRouteSource): number {
  if (!Array.isArray(input)) fail('FEDERATION_ROUTE_INVALID', `Remote "${source.name}" did not return a route array.`);
  if (input.length === 0) return 0;
  const prefix = routePrefix(source.prefix);
  if (source.prefix !== undefined && prefix === undefined && source.prefix !== '' && source.prefix !== '/') {
    fail('FEDERATION_ROUTE_INVALID', `Remote "${source.name}" has an invalid route prefix.`);
  }
  const ids = new Set<string>(), paths = new Set<string>();
  collect(target, '', ids, paths);
  const state = { count: 0, ids, paths, depth: 0 };
  const cloned = input.map((route, index) => clone(route, prefix ?? '', state, source.name, index, prefix !== undefined, true));
  if (prefix) {
    const id = `${source.name}:federation-root`;
    if (ids.has(id) || paths.has(prefix)) fail('FEDERATION_ROUTE_CONFLICT', `Remote "${source.name}" conflicts with an existing route at "${prefix}".`);
    if (state.count + 1 > ROUTE_LIMIT) fail('FEDERATION_ROUTE_INVALID', `Remote "${source.name}" exceeds the supported route count.`);
    const wrapper: RouteObject = { id, path: prefix, children: cloned };
    target.push(wrapper);
    state.count++;
  } else {
    target.push(...cloned);
  }
  return state.count;
}

function clone(value: unknown, parent: string, state: { count: number; ids: Set<string>; paths: Set<string>; depth: number },
  name: string, index: number, wrapped: boolean, top: boolean): RouteObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('FEDERATION_ROUTE_INVALID', `Remote "${name}" returned an invalid route.`);
  if (++state.count > ROUTE_LIMIT) fail('FEDERATION_ROUTE_INVALID', `Remote "${name}" exceeds the supported route count.`);
  if (++state.depth > DEPTH_LIMIT) fail('FEDERATION_ROUTE_INVALID', `Remote "${name}" exceeds the supported route depth.`);
  try {
    const route = value as RouteObject;
    if (route.index === true && route.path !== undefined) fail('FEDERATION_ROUTE_INVALID', `Remote "${name}" returned an index route with a path.`);
    if (route.index === true && route.children !== undefined) fail('FEDERATION_ROUTE_INVALID', `Remote "${name}" returned an index route with children.`);
    const id = `${name}:${typeof route.id === 'string' && route.id ? route.id : `route-${index}-${state.count}`}`;
    if (state.ids.has(id)) fail('FEDERATION_ROUTE_CONFLICT', `Remote "${name}" returned duplicate route id "${id}".`);
    let path = pathValue(route);
    if (wrapped && path !== undefined && path.startsWith('/')) {
      if (!top) fail('FEDERATION_ROUTE_INVALID', `Remote "${name}" cannot nest absolute route paths under a prefix.`);
      path = path.slice(1) || undefined;
    }
    const full = route.index ? parent || '/' : path === undefined ? parent : join(parent, path);
    if (path !== undefined) {
      if (state.paths.has(full)) fail('FEDERATION_ROUTE_CONFLICT', `Remote "${name}" conflicts with an existing route at "${full}".`);
      state.paths.add(full);
    } else if (route.index === true && !wrapped && state.paths.has('/')) {
      fail('FEDERATION_ROUTE_CONFLICT', `Remote "${name}" has a root index route that conflicts with the host; configure a prefix.`);
    }
    state.ids.add(id);
    const children = route.children === undefined ? undefined
      : Array.isArray(route.children) ? route.children.map((child, childIndex) => clone(child, full, state, name, childIndex, wrapped, false))
        : fail('FEDERATION_ROUTE_INVALID', `Remote "${name}" returned invalid route children.`);
    return {
      ...route,
      id,
      ...(path === undefined ? {} : { path }),
      ...(children === undefined ? {} : { children }),
    } as RouteObject;
  } finally {
    state.depth--;
  }
}
