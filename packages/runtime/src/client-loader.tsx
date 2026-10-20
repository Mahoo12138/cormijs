import { useLoaderData, useMatches, useRouteError, type LoaderFunction, type LoaderFunctionArgs } from 'react-router';

/** Arguments handed to a page module's exported client loader. */
export type ClientLoaderArgs = LoaderFunctionArgs;
export type ClientLoaderFunction = (args: ClientLoaderArgs) => unknown | Promise<unknown>;

/**
 * Bind a page module's named export as the route loader. The lazy route callback already resolved the module,
 * so a missing or non-function export surfaces as a route loader error instead of a render-time crash.
 */
export function clientLoaderOf(page: Record<string, unknown>, exportName: string, routeId: string): LoaderFunction {
  const value = page[exportName];
  if (typeof value !== 'function') throw new Error(`CLIENT_LOADER_INVALID: ${routeId} expects ${exportName} to export a function`);
  return value as ClientLoaderFunction;
}

/** Data returned by the current route's client loader. */
export function useClientLoaderData<T = unknown>(): T {
  return useLoaderData() as T;
}

/** Client loader data of any matched route, by route id. */
export function useRouteLoaderDataFor<T = unknown>(routeId: string): T | undefined {
  return useMatches().find(match => match.id === routeId)?.data as T | undefined;
}

/** The error thrown by the current route element or its client loader. */
export function useClientLoaderError(): unknown {
  return useRouteError();
}
