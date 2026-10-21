import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { normalizeHead, registerHead, routeHeadRuntime, seedHead, type RouteHead, type HeadOptions } from './head.js';

type HeadContextValue = { readonly signal: AbortSignal } | { readonly collector: RouteHead[] };
const HeadContext = createContext<HeadContextValue | null>(null);

/** Wraps the router so page components can contribute head entries for the current match. */
export function HeadProvider({ options, routes, basename, signal, serverCollector, children }: {
  readonly options?: unknown;
  readonly routes?: readonly RouteObject[];
  readonly basename?: string;
  readonly signal?: AbortSignal;
  /** Server rendering collects Helmet entries during render because effects do not run. */
  readonly serverCollector?: RouteHead[];
  readonly children?: ReactNode;
}) {
  useEffect(() => {
    if (signal) seedHead(signal, routes ?? [], basename ?? '/');
  }, [signal, routes, basename]);
  return <HeadContext.Provider value={serverCollector ? { collector: serverCollector } : signal ? { signal } : null}>{children}</HeadContext.Provider>;
}

/**
 * Component-level head contribution. Entries are merged after route `meta.head` in mount order:
 * later titles/jsonLd win and metas/links replace ancestors by selector.
 */
export function Helmet({ title, metas, links, jsonLd }: RouteHead) {
  const context = useContext(HeadContext);
  const key = useMemo(() => {
    try { return JSON.stringify({ title, metas, links, jsonLd }); }
    catch { return undefined; }
  }, [title, metas, links, jsonLd]);
  const head = useMemo(() => normalizeHead({ title, metas, links, jsonLd }), [key]);
  if (context && 'collector' in context) context.collector.push(head);
  useEffect(() => {
    if (!context || 'collector' in context) return;
    return registerHead(context.signal, head);
  }, [context, head]);
  return null;
}

/** Runtime contribution registered by headPlugin; the route listener is kept for explicit APIs. */
export const headRuntime = {
  ...routeHeadRuntime,
  Provider: HeadProvider,
  /** Survives duplicate module instances in SSR bundles. */
  cormiHeadRuntime: true as const,
};
export type { HeadOptions };
