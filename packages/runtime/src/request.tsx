import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RequestConfig, RuntimeConfig } from './app-config.js';

export type RequestParams = Readonly<Record<string, string | number | boolean | null | undefined | readonly (string | number | boolean)[]>>;
export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  readonly headers?: Readonly<Record<string, string>>;
  readonly params?: RequestParams;
  readonly body?: unknown;
  /** Cache and deduplicate this GET for the given milliseconds; 0 disables caching. */
  readonly cacheTime?: number;
  /** Skip an existing cache entry and do not store this response. */
  readonly cacheBust?: boolean;
  /** Tags used by `invalidateCache`; at most 16 bounded identifiers. */
  readonly cacheTags?: readonly string[];
}
export interface RequestClient {
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  delete<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  /** Drop cached GETs by tag, or every cached GET when no tag is given. Returns the removed count. */
  invalidateCache(tags?: readonly string[]): number;
}
export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly data: unknown) {
    super(message);
    this.name = 'RequestError';
  }
}

function validate(config: RequestConfig) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('REQUEST_INVALID: request config must be an object');
  if (config.baseURL !== undefined && (typeof config.baseURL !== 'string' || !config.baseURL)) throw new TypeError('REQUEST_INVALID: baseURL must be a non-empty string');
  if (config.timeout !== undefined && (!Number.isFinite(config.timeout) || config.timeout <= 0)) throw new TypeError('REQUEST_INVALID: timeout must be a positive number');
  if (config.cacheLimit !== undefined && (!Number.isInteger(config.cacheLimit) || config.cacheLimit < 1 || config.cacheLimit > 10_000)) throw new TypeError('REQUEST_INVALID: cacheLimit must be an integer from 1 to 10000');
  if (config.cachePersist !== undefined && config.cachePersist !== 'session' && config.cachePersist !== 'local') throw new TypeError('REQUEST_INVALID: cachePersist must be session or local');
  if (config.cachePersistKey !== undefined && (typeof config.cachePersistKey !== 'string' || !config.cachePersistKey || config.cachePersistKey.length > 128 || /[\0\r\n]/.test(config.cachePersistKey))) {
    throw new TypeError('REQUEST_INVALID: cachePersistKey must be bounded text');
  }
  if (config.cachePersistKey !== undefined && config.cachePersist === undefined) throw new TypeError('REQUEST_INVALID: cachePersistKey requires cachePersist');
  if (config.headers !== undefined) {
    if (!config.headers || typeof config.headers !== 'object' || Array.isArray(config.headers)
      || Object.entries(config.headers).some(([name, value]) => !name || typeof value !== 'string')) throw new TypeError('REQUEST_INVALID: headers must contain string values');
  }
}
const resolveURL = (path: string, baseURL?: string) => {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || path.startsWith('//')) return path;
  if (!baseURL) return path;
  return baseURL.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
};
const bodyLike = (body: unknown) => typeof body === 'string'
  || typeof FormData !== 'undefined' && body instanceof FormData
  || typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams
  || typeof Blob !== 'undefined' && body instanceof Blob
  || body instanceof ArrayBuffer || ArrayBuffer.isView(body);

export function createRequestClient(input: RequestConfig = {}): RequestClient {
  validate(input);
  const config = Object.freeze({ ...input, ...(input.headers ? { headers: Object.freeze({ ...input.headers }) } : {}) });
  type CacheEntry = { readonly expires: number; readonly value: unknown; readonly tags: readonly string[] };
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<unknown>>();
  const cacheLimit = config.cacheLimit ?? 100, cachePersistKey = config.cachePersistKey ?? 'cormi:request-cache';
  const storage = (): Storage | undefined => {
    if (!config.cachePersist || typeof window === 'undefined') return undefined;
    try { return config.cachePersist === 'local' ? window.localStorage : window.sessionStorage; } catch { return undefined; }
  };
  const persist = () => {
    const store = storage();
    if (!store) return;
    try {
      store.setItem(cachePersistKey, JSON.stringify({ version: 1, entries: [...cache].map(([key, entry]) => ({ key, expires: entry.expires, value: entry.value, tags: entry.tags })) }));
    } catch { /* storage can be unavailable, full or blocked by policy */ }
  };
  if (config.cachePersist) {
    try {
      const raw = storage()?.getItem(cachePersistKey);
      const payload = raw && raw.length <= 5_000_000 ? JSON.parse(raw) as { version?: unknown; entries?: unknown } : undefined;
      if (payload?.version === 1 && Array.isArray(payload.entries)) {
        for (const item of payload.entries) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
          const entry = item as Record<string, unknown>, key = entry.key;
          if (typeof key !== 'string' || !key || key.length > 8192 || typeof entry.expires !== 'number' || !Number.isFinite(entry.expires)
            || entry.expires <= Date.now() || entry.value === undefined
            || !Array.isArray(entry.tags) || entry.tags.length > 16 || entry.tags.some(tag => typeof tag !== 'string' || !tag)) continue;
          while (cache.size >= cacheLimit) {
            const oldest = cache.keys().next();
            if (oldest.done) break;
            cache.delete(oldest.value);
          }
          cache.set(key, { expires: entry.expires, value: entry.value, tags: Object.freeze([...entry.tags]) });
        }
      }
    } catch { /* corrupt or unavailable storage is ignored */ }
  }
  const request = async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
    if (typeof path !== 'string' || !path) throw new TypeError('REQUEST_INVALID: path must be a non-empty string');
    if (options.cacheTime !== undefined && (!Number.isFinite(options.cacheTime) || options.cacheTime < 0 || options.cacheTime > 3_600_000)) throw new TypeError('REQUEST_INVALID: cacheTime must be 0–3600000ms');
    if (options.cacheBust !== undefined && typeof options.cacheBust !== 'boolean') throw new TypeError('REQUEST_INVALID: cacheBust must be boolean');
    if (options.cacheTags !== undefined && (!Array.isArray(options.cacheTags) || options.cacheTags.length > 16
      || options.cacheTags.some(tag => typeof tag !== 'string' || !/^[A-Za-z0-9:._-]{1,64}$/.test(tag)))) throw new TypeError('REQUEST_INVALID: cacheTags must contain at most 16 bounded tags');
    let url = resolveURL(path, config.baseURL);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value === undefined || value === null) continue;
      for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
    }
    if (search.size) url += (url.includes('?') ? '&' : '?') + search.toString();
    const headers = new Headers(config.headers);
    for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
    let body = options.body;
    if (body !== undefined && !bodyLike(body)) {
      body = JSON.stringify(body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
    const method = (options.method ?? 'GET').toUpperCase();
    const cacheTime = options.cacheTime ?? 0;
    const key = cacheTime > 0 && method === 'GET' && options.cacheBust !== true
      ? `${method} ${url}\n${[...headers.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => `${name}:${value}`).join('\n')}`
      : undefined;
    if (key) {
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) {
        cache.delete(key); cache.set(key, hit);
        return hit.value as T;
      }
      if (hit) cache.delete(key);
      const pending = inflight.get(key);
      if (pending) return pending as Promise<T>;
    }
    const signals = [options.signal, config.timeout === undefined ? undefined : AbortSignal.timeout(config.timeout)]
      .filter((signal): signal is AbortSignal => signal !== undefined);
    const signal = signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    const { params: _params, headers: _headers, body: _body, cacheTime: _cacheTime, cacheBust: _cacheBust, cacheTags: _cacheTags, ...init } = options;
    const cacheTags = options.cacheTags ?? [];
    const task = (async (): Promise<T> => {
      const response = await fetch(url, { ...init, headers, body: body as BodyInit | null | undefined, signal });
      const text = response.status === 204 ? '' : await response.text();
      const data = text && (response.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text;
      if (!response.ok) throw new RequestError(`Request failed with status ${response.status}`, response.status, data);
      if (key) {
        for (const [cachedKey, entry] of cache) if (entry.expires <= Date.now()) cache.delete(cachedKey);
        while (cache.size >= cacheLimit) {
          const oldest = cache.keys().next();
          if (oldest.done) break;
          cache.delete(oldest.value);
        }
        cache.set(key, { expires: Date.now() + cacheTime, value: data, tags: Object.freeze([...cacheTags]) });
        persist();
      }
      return data as T;
    })();
    if (key) {
      inflight.set(key, task);
      void task.finally(() => { inflight.delete(key); }).catch(() => {});
    }
    return task;
  };
  return Object.freeze({
    request,
    get: <T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...options, method: 'GET' }),
    post: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...options, method: 'POST', body }),
    put: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...options, method: 'PUT', body }),
    delete: <T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...options, method: 'DELETE' }),
    invalidateCache(tags?: readonly string[]) {
      if (tags !== undefined && (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !tag))) throw new TypeError('REQUEST_INVALID: invalidateCache tags must be non-empty strings');
      let removed = 0;
      for (const [key, entry] of cache) {
        if (tags === undefined || tags.length === 0 || entry.tags.some(tag => tags.includes(tag))) { cache.delete(key); removed++; }
      }
      if (removed) persist();
      return removed;
    },
  }) satisfies RequestClient;
}

const RequestContext = createContext<RequestClient | null>(null);

export function RequestProvider({ appConfig, children }: { readonly appConfig: Readonly<RuntimeConfig>; readonly children?: ReactNode }) {
  const config = appConfig.request ?? {};
  const client = useMemo(() => createRequestClient(config), [config]);
  return <RequestContext.Provider value={client}>{children}</RequestContext.Provider>;
}
export function useRequestClient(): RequestClient {
  const client = useContext(RequestContext);
  if (!client) throw new Error('REQUEST_MISSING: enable requestPlugin to use the request client');
  return client;
}

export interface UseRequestOptions<T> {
  readonly manual?: boolean;
  readonly onSuccess?: (data: T) => void;
  readonly onError?: (error: unknown) => void;
  /** Additional attempts after the first failure, 0–10. */
  readonly retry?: number;
  /** Delay between attempts; a function receives the retry number starting at 1. */
  readonly retryDelay?: number | ((attempt: number, error: unknown) => number);
  /** Re-run after each success, in milliseconds; manual requests do not poll. */
  readonly pollingInterval?: number;
  /** Keep polling while the document is hidden; default false. */
  readonly pollingWhenHidden?: boolean;
  /** Re-run when these JSON-serializable values change; ignored for manual requests. */
  readonly refreshDeps?: readonly unknown[];
  /** Coalesce run/refresh calls within this window (0–60000ms); polling bypasses it. */
  readonly debounceWait?: number;
  /** Maximum time a debounced call may be delayed (1–60000ms); requires debounceWait. */
  readonly debounceMaxWait?: number;
  /** Execute the first call of a debounce burst immediately; default false. */
  readonly debounceLeading?: boolean;
  /** Execute one coalesced trailing call per debounce burst; default true. */
  readonly debounceTrailing?: boolean;
  /** Throttle run/refresh calls within this window (0–60000ms); polling bypasses it. */
  readonly throttleWait?: number;
  /** Execute the first call in a throttle window; default true. */
  readonly throttleLeading?: boolean;
  /** Execute one coalesced trailing call after a window with dropped calls; default false. */
  readonly throttleTrailing?: boolean;
}
export interface UseRequestResult<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  run(): Promise<T | undefined>;
  refresh(): Promise<T | undefined>;
  cancel(): void;
}

const delayOf = (value: UseRequestOptions<unknown>['retryDelay'], attempt: number, error: unknown): number => {
  const ms = typeof value === 'function' ? value(attempt, error) : value ?? 1000;
  if (!Number.isFinite(ms) || ms < 0 || ms > 60_000) throw new TypeError('REQUEST_INVALID: retryDelay must resolve to 0–60000ms');
  return ms;
};
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) { resolve(); return; }
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

function validateUseRequest<T>(options: UseRequestOptions<T>): void {
  if (options.retry !== undefined && (!Number.isInteger(options.retry) || options.retry < 0 || options.retry > 10)) throw new TypeError('REQUEST_INVALID: retry must be an integer from 0 to 10');
  if (options.retryDelay !== undefined && typeof options.retryDelay !== 'number' && typeof options.retryDelay !== 'function') throw new TypeError('REQUEST_INVALID: retryDelay must be a number or function');
  if (options.pollingInterval !== undefined && (!Number.isInteger(options.pollingInterval) || options.pollingInterval < 100 || options.pollingInterval > 3_600_000)) throw new TypeError('REQUEST_INVALID: pollingInterval must be an integer from 100 to 3600000');
  if (options.pollingWhenHidden !== undefined && typeof options.pollingWhenHidden !== 'boolean') throw new TypeError('REQUEST_INVALID: pollingWhenHidden must be boolean');
  if (options.refreshDeps !== undefined && (!Array.isArray(options.refreshDeps) || options.refreshDeps.length > 16)) throw new TypeError('REQUEST_INVALID: refreshDeps must be an array of at most 16 values');
  if (options.debounceWait !== undefined && (!Number.isInteger(options.debounceWait) || options.debounceWait < 0 || options.debounceWait > 60_000)) throw new TypeError('REQUEST_INVALID: debounceWait must be an integer from 0 to 60000');
  if (options.debounceMaxWait !== undefined && (!Number.isInteger(options.debounceMaxWait) || options.debounceMaxWait < 1 || options.debounceMaxWait > 60_000)) throw new TypeError('REQUEST_INVALID: debounceMaxWait must be an integer from 1 to 60000');
  if (options.debounceMaxWait !== undefined && !(options.debounceWait ?? 0)) throw new TypeError('REQUEST_INVALID: debounceMaxWait requires debounceWait');
  if (options.debounceLeading !== undefined && typeof options.debounceLeading !== 'boolean') throw new TypeError('REQUEST_INVALID: debounceLeading must be boolean');
  if (options.debounceTrailing !== undefined && typeof options.debounceTrailing !== 'boolean') throw new TypeError('REQUEST_INVALID: debounceTrailing must be boolean');
  if ((options.debounceLeading !== undefined || options.debounceTrailing !== undefined) && !(options.debounceWait ?? 0)) throw new TypeError('REQUEST_INVALID: debounceLeading/debounceTrailing require debounceWait');
  if ((options.debounceWait ?? 0) > 0 && options.debounceLeading !== true && options.debounceTrailing === false) throw new TypeError('REQUEST_INVALID: debounceLeading=false requires debounceTrailing');
  if (options.throttleWait !== undefined && (!Number.isInteger(options.throttleWait) || options.throttleWait < 0 || options.throttleWait > 60_000)) throw new TypeError('REQUEST_INVALID: throttleWait must be an integer from 0 to 60000');
  if (options.throttleLeading !== undefined && typeof options.throttleLeading !== 'boolean') throw new TypeError('REQUEST_INVALID: throttleLeading must be boolean');
  if (options.throttleTrailing !== undefined && typeof options.throttleTrailing !== 'boolean') throw new TypeError('REQUEST_INVALID: throttleTrailing must be boolean');
  if ((options.debounceWait ?? 0) > 0 && (options.throttleWait ?? 0) > 0) throw new TypeError('REQUEST_INVALID: debounceWait and throttleWait are mutually exclusive');
  if ((options.throttleLeading === false || options.throttleTrailing === true) && !(options.throttleWait ?? 0)) throw new TypeError('REQUEST_INVALID: throttleLeading/throttleTrailing require throttleWait');
  if ((options.throttleWait ?? 0) > 0 && options.throttleLeading === false && options.throttleTrailing !== true) throw new TypeError('REQUEST_INVALID: throttleLeading=false requires throttleTrailing');
}

export function useRequest<T>(service: (client: RequestClient, signal: AbortSignal) => Promise<T>, options: UseRequestOptions<T> = {}): UseRequestResult<T> {
  validateUseRequest(options);
  const client = useRequestClient();
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({
    data: undefined, error: undefined, loading: !options.manual,
  });
  const serviceRef = useRef(service), optionsRef = useRef(options);
  serviceRef.current = service; optionsRef.current = options;
  const mounted = useRef(true), generation = useRef(0), controller = useRef<AbortController | undefined>(undefined);
  const polling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), poll = useRef<() => void>(() => {});
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), debounceResolve = useRef<((value: T | undefined) => void) | undefined>(undefined);
  const debounceStart = useRef(0), debounceLast = useRef(0);
  const lastThrottle = useRef(0);
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), throttlePending = useRef<Array<(value: T | undefined) => void>>([]);
  const stopPolling = () => { if (polling.current) { clearTimeout(polling.current); polling.current = undefined; } };
  const stopDebounce = () => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = undefined;
    debounceResolve.current?.(undefined);
    debounceResolve.current = undefined;
    debounceStart.current = 0;
    debounceLast.current = 0;
  };
  const execute = useCallback(async (): Promise<T | undefined> => {
    const token = ++generation.current;
    controller.current?.abort();
    stopPolling();
    const current = controller.current = new AbortController();
    setState(value => ({ ...value, loading: true, error: undefined }));
    const retry = optionsRef.current.retry ?? 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const data = await serviceRef.current(client, current.signal);
        if (mounted.current && token === generation.current) {
          setState({ data, error: undefined, loading: false });
          optionsRef.current.onSuccess?.(data);
          poll.current();
        }
        return data;
      } catch (error) {
        const aborted = current.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
        if (!mounted.current || token !== generation.current || aborted) {
          if (mounted.current && token === generation.current) setState(value => ({ ...value, loading: false }));
          return undefined;
        }
        if (attempt < retry) {
          let delay: number;
          try { delay = delayOf(optionsRef.current.retryDelay, attempt + 1, error); }
          catch (invalid) {
            setState({ data: undefined, error: invalid, loading: false });
            optionsRef.current.onError?.(invalid);
            return undefined;
          }
          await sleep(delay, current.signal);
          if (current.signal.aborted || !mounted.current || token !== generation.current) return undefined;
          continue;
        }
        setState({ data: undefined, error, loading: false });
        optionsRef.current.onError?.(error);
        return undefined;
      }
    }
  }, [client]);
  const executeRef = useRef(execute); executeRef.current = execute;
  const stopThrottle = () => {
    if (throttleTimer.current) clearTimeout(throttleTimer.current);
    throttleTimer.current = undefined;
    for (const resolve of throttlePending.current) resolve(undefined);
    throttlePending.current = [];
  };
  const scheduleThrottle = (wait: number) => {
    throttleTimer.current = setTimeout(() => {
      throttleTimer.current = undefined;
      lastThrottle.current = Date.now();
      const pending = throttlePending.current;
      throttlePending.current = [];
      void executeRef.current().then(
        value => { for (const resolve of pending) resolve(value); },
        () => { for (const resolve of pending) resolve(undefined); },
      );
    }, wait);
  };
  const run = useCallback((): Promise<T | undefined> => {
    const wait = optionsRef.current.debounceWait ?? 0;
    if (wait) {
      const maxWait = optionsRef.current.debounceMaxWait ?? 0, now = Date.now();
      const leading = optionsRef.current.debounceLeading === true, trailing = optionsRef.current.debounceTrailing !== false;
      const active = debounceStart.current > 0 && now - debounceLast.current < wait;
      if (!active) {
        stopDebounce();
        debounceStart.current = now;
        debounceLast.current = now;
        if (leading) return executeRef.current();
      } else debounceLast.current = now;
      if (!trailing) return Promise.resolve(undefined);
      if (debounce.current) {
        clearTimeout(debounce.current);
        debounceResolve.current?.(undefined);
      }
      const deadline = maxWait ? Math.min(now + wait, debounceStart.current + maxWait) : now + wait;
      return new Promise<T | undefined>(resolve => {
        debounceResolve.current = resolve;
        debounce.current = setTimeout(() => {
          debounce.current = undefined;
          debounceResolve.current = undefined;
          debounceStart.current = 0;
          debounceLast.current = 0;
          void executeRef.current().then(resolve, () => resolve(undefined));
        }, Math.max(0, deadline - now));
      });
    }
    const throttle = optionsRef.current.throttleWait ?? 0;
    if (throttle) {
      const now = Date.now(), leading = optionsRef.current.throttleLeading !== false, trailing = optionsRef.current.throttleTrailing === true;
      if (now - lastThrottle.current >= throttle) {
        lastThrottle.current = now;
        stopThrottle();
        if (leading) return executeRef.current();
        if (trailing) {
          return new Promise<T | undefined>(resolve => {
            throttlePending.current.push(resolve);
            scheduleThrottle(throttle);
          });
        }
        return Promise.resolve(undefined);
      }
      if (!trailing) return Promise.resolve(undefined);
      return new Promise<T | undefined>(resolve => {
        throttlePending.current.push(resolve);
        if (!throttleTimer.current) scheduleThrottle(throttle - (now - lastThrottle.current));
      });
    }
    return executeRef.current();
  }, []);
  const runRef = useRef(run); runRef.current = run;
  poll.current = () => {
    stopPolling();
    const interval = optionsRef.current.pollingInterval;
    if (!interval || optionsRef.current.manual === true || !mounted.current) return;
    polling.current = setTimeout(async () => {
      if (!mounted.current) return;
      if (optionsRef.current.pollingWhenHidden !== true && typeof document !== 'undefined' && document.hidden) { poll.current(); return; }
      await executeRef.current();
    }, interval);
  };
  const cancel = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    stopPolling();
    stopDebounce();
    stopThrottle();
    lastThrottle.current = 0;
    setState(value => ({ ...value, loading: false }));
  }, []);
  const manual = options.manual === true;
  const deps = options.refreshDeps === undefined ? '' : JSON.stringify(options.refreshDeps);
  useEffect(() => {
    mounted.current = true;
    if (!manual) void runRef.current();
    return () => {
      mounted.current = false;
      controller.current?.abort();
      stopPolling();
      stopDebounce();
      stopThrottle();
    };
  }, [manual, run, deps]);
  return { ...state, run, refresh: run, cancel };
}

export function useCursorPagination<T>(service: (client: RequestClient, request: CursorPaginationRequest) => Promise<CursorPaginationResponse<T>>,
  options: UseCursorPaginationOptions<T> = {}): UseCursorPaginationResult<T> {
  const client = useRequestClient();
  if (options.manual !== undefined && typeof options.manual !== 'boolean') throw new TypeError('REQUEST_INVALID: manual must be boolean');
  if (options.merge !== undefined && typeof options.merge !== 'function') throw new TypeError('REQUEST_INVALID: merge must be a function');
  const [state, setState] = useState<{ data: readonly T[]; nextCursor?: string | null; loading: boolean; error: unknown; hasMore: boolean }>({
    data: Object.freeze([]), nextCursor: undefined, loading: options.manual !== true, error: undefined, hasMore: true,
  });
  const serviceRef = useRef(service), optionsRef = useRef(options), dataRef = useRef(state.data);
  serviceRef.current = service; optionsRef.current = options; dataRef.current = state.data;
  const mounted = useRef(true), generation = useRef(0), controller = useRef<AbortController | undefined>(undefined), busy = useRef(false);
  const run = useCallback(async (cursor: string | undefined, append: boolean): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    const token = ++generation.current;
    controller.current?.abort();
    const current = controller.current = new AbortController();
    setState(value => ({ ...value, loading: true, error: undefined }));
    try {
      const response = await serviceRef.current(client, { ...(cursor === undefined ? {} : { cursor }), signal: current.signal });
      if (!response || !Array.isArray(response.list)) throw new TypeError('REQUEST_INVALID: cursor service must return { list }');
      if (response.nextCursor !== undefined && response.nextCursor !== null && typeof response.nextCursor !== 'string') throw new TypeError('REQUEST_INVALID: nextCursor must be a string or null');
      if (response.hasMore !== undefined && typeof response.hasMore !== 'boolean') throw new TypeError('REQUEST_INVALID: cursor hasMore must be boolean');
      if (!mounted.current || token !== generation.current) return;
      const next = [...response.list];
      const data = append
        ? Object.freeze(optionsRef.current.merge ? [...optionsRef.current.merge(dataRef.current, next)] : [...dataRef.current, ...next])
        : Object.freeze(next);
      const nextCursor = response.nextCursor;
      const hasMore = response.hasMore ?? (nextCursor !== undefined && nextCursor !== null);
      setState({ data, nextCursor, hasMore, loading: false, error: undefined });
      optionsRef.current.onSuccess?.(data, nextCursor);
    } catch (error) {
      const aborted = current.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      if (!mounted.current || token !== generation.current || aborted) {
        if (mounted.current && token === generation.current) setState(value => ({ ...value, loading: false }));
        return;
      }
      setState(value => ({ ...value, loading: false, error }));
      optionsRef.current.onError?.(error);
    } finally {
      if (token === generation.current) busy.current = false;
    }
  }, [client]);
  const loadMore = useCallback(async () => {
    if (busy.current || !state.hasMore) return;
    await run(state.nextCursor ?? undefined, true);
  }, [run, state.hasMore, state.nextCursor]);
  const reload = useCallback(async () => { await run(undefined, false); }, [run]);
  const cancel = useCallback(() => {
    generation.current++; busy.current = false; controller.current?.abort();
    setState(value => ({ ...value, loading: false }));
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (optionsRef.current.manual !== true) void run(undefined, false);
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [run]);
  return { ...state, loadMore, reload, cancel };
}

/** Runtime plugin object consumed by the generated entry when requestPlugin is mounted. */
export const requestRuntime = { Provider: RequestProvider };

export interface PaginationRequest {
  readonly page: number;
  readonly pageSize: number;
  readonly signal: AbortSignal;
}
export interface PaginationResponse<T> {
  readonly list: readonly T[];
  readonly total?: number;
  readonly hasMore?: boolean;
}
export interface UsePaginationOptions<T> {
  readonly pageSize?: number;
  readonly manual?: boolean;
  /** Replace the default append; receives the accumulated and incoming pages. */
  readonly merge?: (previous: readonly T[], next: readonly T[]) => readonly T[];
  readonly onSuccess?: (data: readonly T[], page: number) => void;
  readonly onError?: (error: unknown) => void;
}
export interface UsePaginationResult<T> {
  readonly data: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly loading: boolean;
  readonly error: unknown;
  readonly hasMore: boolean;
  loadMore(): Promise<void>;
  reload(): Promise<void>;
  cancel(): void;
}

export interface CursorPaginationRequest {
  readonly cursor?: string;
  readonly signal: AbortSignal;
}
export interface CursorPaginationResponse<T> {
  readonly list: readonly T[];
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
}
export interface UseCursorPaginationOptions<T> {
  readonly manual?: boolean;
  readonly merge?: (previous: readonly T[], next: readonly T[]) => readonly T[];
  readonly onSuccess?: (data: readonly T[], nextCursor?: string | null) => void;
  readonly onError?: (error: unknown) => void;
}
export interface UseCursorPaginationResult<T> {
  readonly data: readonly T[];
  readonly nextCursor?: string | null;
  readonly loading: boolean;
  readonly error: unknown;
  readonly hasMore: boolean;
  loadMore(): Promise<void>;
  reload(): Promise<void>;
  cancel(): void;
}

export function usePagination<T>(service: (client: RequestClient, request: PaginationRequest) => Promise<PaginationResponse<T>>,
  options: UsePaginationOptions<T> = {}): UsePaginationResult<T> {
  const client = useRequestClient();
  const pageSize = options.pageSize ?? 20;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new TypeError('REQUEST_INVALID: pageSize must be an integer from 1 to 1000');
  if (options.manual !== undefined && typeof options.manual !== 'boolean') throw new TypeError('REQUEST_INVALID: manual must be boolean');
  if (options.merge !== undefined && typeof options.merge !== 'function') throw new TypeError('REQUEST_INVALID: merge must be a function');
  const [state, setState] = useState<{ data: readonly T[]; page: number; hasMore: boolean; loading: boolean; error: unknown }>({
    data: Object.freeze([]), page: 0, hasMore: true, loading: options.manual !== true, error: undefined,
  });
  const serviceRef = useRef(service), optionsRef = useRef(options);
  serviceRef.current = service; optionsRef.current = options;
  const dataRef = useRef(state.data); dataRef.current = state.data;
  const mounted = useRef(true), generation = useRef(0), controller = useRef<AbortController | undefined>(undefined), busy = useRef(false);
  const run = useCallback(async (page: number, append: boolean): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    const token = ++generation.current;
    controller.current?.abort();
    const current = controller.current = new AbortController();
    setState(value => ({ ...value, loading: true, error: undefined }));
    try {
      const response = await serviceRef.current(client, { page, pageSize, signal: current.signal });
      if (!response || !Array.isArray(response.list)) throw new TypeError('REQUEST_INVALID: pagination service must return { list }');
      if (response.total !== undefined && (!Number.isInteger(response.total) || response.total < 0)) throw new TypeError('REQUEST_INVALID: pagination total must be a non-negative integer');
      if (response.hasMore !== undefined && typeof response.hasMore !== 'boolean') throw new TypeError('REQUEST_INVALID: pagination hasMore must be boolean');
      if (!mounted.current || token !== generation.current) return;
      const next = [...response.list];
      const data = append
        ? Object.freeze(optionsRef.current.merge ? [...optionsRef.current.merge(dataRef.current, next)] : [...dataRef.current, ...next])
        : Object.freeze(next);
      const hasMore = response.hasMore ?? (response.total !== undefined ? page * pageSize < response.total : next.length >= pageSize);
      setState({ data, page, hasMore, loading: false, error: undefined });
      optionsRef.current.onSuccess?.(data, page);
    } catch (error) {
      const aborted = current.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      if (!mounted.current || token !== generation.current || aborted) {
        if (mounted.current && token === generation.current) setState(value => ({ ...value, loading: false }));
        return;
      }
      setState(value => ({ ...value, loading: false, error }));
      optionsRef.current.onError?.(error);
    } finally {
      if (token === generation.current) busy.current = false;
    }
  }, [client, pageSize]);
  const loadMore = useCallback(async () => {
    if (busy.current || !state.hasMore) return;
    await run(state.page + 1, true);
  }, [run, state.hasMore, state.page]);
  const reload = useCallback(async () => { await run(1, false); }, [run]);
  const cancel = useCallback(() => {
    generation.current++;
    busy.current = false;
    controller.current?.abort();
    setState(value => ({ ...value, loading: false }));
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (optionsRef.current.manual !== true) void run(1, false);
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [run]);
  return { ...state, pageSize, loadMore, reload, cancel };
}
