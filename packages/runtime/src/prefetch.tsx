import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

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

export interface PrefetchIntentOptions {
  /** Milliseconds the pointer or focus must stay before the module loads; 0–5000, default 50. */
  readonly delayMs?: number;
}
export interface PrefetchIntentHandlers {
  onMouseEnter(): void;
  onMouseLeave(): void;
  onFocus(): void;
  onBlur(): void;
}
/** Intent prefetching for links: spread these handlers on any clickable element. */
export function usePrefetchOnIntent(id: string, options: PrefetchIntentOptions = {}): PrefetchIntentHandlers {
  const api = usePrefetch(), delay = options.delayMs ?? 50, timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0 || delay > 5000) throw new TypeError('PREFETCH_INVALID: delayMs must be between 0 and 5000');
  const cancel = () => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(cancel, []);
  const handlers = useMemo<PrefetchIntentHandlers>(() => {
    const schedule = () => {
      cancel();
      timer.current = setTimeout(() => { timer.current = null; void api.prefetch(id); }, delay);
    };
    return Object.freeze({ onMouseEnter: schedule, onMouseLeave: cancel, onFocus: schedule, onBlur: cancel });
  }, [api, id, delay]);
  return handlers;
}

/** Runtime plugin object consumed by the generated entry when prefetchPlugin is mounted. */
export const prefetchRuntime = { Provider: PrefetchProvider };

export interface PrefetchVisibleOptions {
  /** IntersectionObserver root margin; default 200px so a link just below the fold warms early. */
  readonly rootMargin?: string;
  /** 0–1 visibility ratio; default 0.01. */
  readonly threshold?: number;
  /** Milliseconds to wait after entry becomes visible; 0–5000, default 0. */
  readonly delayMs?: number;
}
/**
 * Observe one element and prefetch its route once it becomes visible.
 * Returns a ref callback; the observer is disconnected on unmount or when the ref changes.
 */
export function usePrefetchOnVisible(id: string, options: PrefetchVisibleOptions = {}): (element: Element | null) => void {
  const api = usePrefetch(), delay = options.delayMs ?? 0, rootMargin = options.rootMargin ?? '200px', threshold = options.threshold ?? 0.01;
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0 || delay > 5000) throw new TypeError('PREFETCH_INVALID: delayMs must be between 0 and 5000');
  if (typeof rootMargin !== 'string' || !rootMargin || rootMargin.length > 64 || /[\0\r\n]/.test(rootMargin)) throw new TypeError('PREFETCH_INVALID: rootMargin must be bounded text');
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new TypeError('PREFETCH_INVALID: threshold must be between 0 and 1');
  const observer = useRef<IntersectionObserver | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    observer.current?.disconnect(); observer.current = null;
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
  }, []);
  useEffect(() => clear, [clear]);
  return useCallback((element: Element | null) => {
    clear();
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const current = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      current.disconnect(); observer.current = null;
      timer.current = setTimeout(() => { timer.current = null; void api.prefetch(id); }, delay);
    }, { rootMargin, threshold });
    observer.current = current; current.observe(element);
  }, [api, clear, delay, id, rootMargin, threshold]);
}
