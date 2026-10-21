import { useLoaderData, useRouteLoaderData, type LoaderFunction } from 'react-router';
import type { ClientLoaderArgs } from './client-loader.js';

export type ServerLoaderPayload = Readonly<Record<string, unknown>>;

const inFlight = new Map<string, Promise<ServerLoaderPayload>>();

export function serverLoaderEndpoint(base = '/'): string {
  return `${base === '/' ? '/' : base}.cormi/server-loader`;
}

/**
 * Fetches every server loader on the matched chain for one location. Concurrent route loaders share
 * one request; the promise is dropped afterwards so later navigations revalidate.
 */
export async function loadServerLoaderData(request: Request, base = '/'): Promise<ServerLoaderPayload> {
  const url = new URL(request.url);
  const endpoint = serverLoaderEndpoint(base);
  const key = `${endpoint}?url=${encodeURIComponent(url.pathname + url.search)}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(key, { headers: { accept: 'application/json' } });
      const payload = await response.json().catch(() => undefined) as { data?: unknown; error?: unknown } | undefined;
      if (!response.ok) {
        const detail = typeof payload?.error === 'string' ? `: ${payload.error}` : '';
        throw new Error(`SERVER_LOADER_FAILED: ${response.status}${detail}`);
      }
      if (!payload || typeof payload.data !== 'object' || payload.data === null || Array.isArray(payload.data)) {
        throw new Error('SERVER_LOADER_INVALID: response has no data object');
      }
      return payload.data as ServerLoaderPayload;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** Client-side loader stub for a serverLoader route; SSR hydration data bypasses it on first render. */
export function serverLoaderOf(routeId: string, base = '/'): LoaderFunction {
  const loader = async (args: ClientLoaderArgs) => {
    const data = await loadServerLoaderData(args.request, base);
    if (!Object.hasOwn(data, routeId)) throw new Error(`SERVER_LOADER_MISSING: ${routeId}`);
    return data[routeId];
  };
  Object.defineProperty(loader, 'cormiServerLoaderStub', { value: routeId });
  return loader;
}

/** Server loader data of the current route, or of a specific matched route id. */
export function useServerLoaderData<T = unknown>(routeId?: string): T {
  const data = routeId === undefined ? useLoaderData() : useRouteLoaderData(routeId);
  return data as T;
}
