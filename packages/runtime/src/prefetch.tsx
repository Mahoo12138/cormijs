import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

export type PrefetchLoader = () => Promise<unknown>;
export interface PrefetchApi {
  readonly ids: readonly string[];
  /** Load one route module now; repeated calls reuse the browser module cache and the in-flight promise. */
  prefetch(id: string): Promise<boolean>;
  prefetchAll(): Promise<readonly string[]>;
}
const PrefetchContext = createContext<PrefetchApi | null>(null);
const IDLE_TIMEOUT = 2000;

export interface PrefetchProviderProps {
  readonly routes?: readonly { readonly id?: string }[];
  readonly options?: unknown;
  readonly prefetch?: Readonly<Record<string, PrefetchLoader>>;
  readonly children?: ReactNode;
}

/** Owns the generated route-module registry; idle mode warms every route after the first paint. */
export function PrefetchProvider({ options, prefetch = {}, children }: PrefetchProviderProps) {
  const inflight = useRef(new Map<string, Promise<unknown>>());
  const api = useMemo<PrefetchApi>(() => {
    const ids = Object.freeze(Object.keys(prefetch).sort());
    const prefetchOne = (id: string): Promise<boolean> => {
      const load = prefetch[id];
      if (!load) return Promise.resolve(false);
      let task = inflight.current.get(id);
      if (!task) { task = load().catch(() => undefined); inflight.current.set(id, task); }
      return task.then(() => true, () => false);
    };
    return Object.freeze({
      ids,
      prefetch: prefetchOne,
      prefetchAll: () => Promise.all(ids.map(prefetchOne)).then(() => ids),
    });
  }, [prefetch]);
  const mode = (options as { mode?: unknown } | undefined)?.mode;
  useEffect(() => {
    if (mode !== 'idle' || !api.ids.length) return;
    let cancelled = false;
    const run = () => { if (!cancelled) void api.prefetchAll(); };
    const handle = typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: IDLE_TIMEOUT }) : setTimeout(run, 200);
    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle as number); else clearTimeout(handle as ReturnType<typeof setTimeout>);
    };
  }, [api, mode]);
  return <PrefetchContext.Provider value={api}>{children}</PrefetchContext.Provider>;
}

export function usePrefetch(): PrefetchApi {
  const api = useContext(PrefetchContext);
  if (!api) throw new Error('PREFETCH_MISSING: enable prefetchPlugin to use usePrefetch');
  return api;
}

/** Runtime plugin object consumed by the generated entry when prefetchPlugin is mounted. */
export const prefetchRuntime = { Provider: PrefetchProvider };
