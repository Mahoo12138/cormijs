import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RequestConfig, RuntimeConfig } from './app-config.js';

export type RequestParams = Readonly<Record<string, string | number | boolean | null | undefined | readonly (string | number | boolean)[]>>;
export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  readonly headers?: Readonly<Record<string, string>>;
  readonly params?: RequestParams;
  readonly body?: unknown;
}
export interface RequestClient {
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  delete<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
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
  const request = async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
    if (typeof path !== 'string' || !path) throw new TypeError('REQUEST_INVALID: path must be a non-empty string');
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
    const signals = [options.signal, config.timeout === undefined ? undefined : AbortSignal.timeout(config.timeout)]
      .filter((signal): signal is AbortSignal => signal !== undefined);
    const signal = signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    const { params: _params, headers: _headers, body: _body, ...init } = options;
    const response = await fetch(url, { ...init, headers, body: body as BodyInit | null | undefined, signal });
    const text = response.status === 204 ? '' : await response.text();
    const data = text && (response.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text;
    if (!response.ok) throw new RequestError(`Request failed with status ${response.status}`, response.status, data);
    return data as T;
  };
  return Object.freeze({
    request,
    get: <T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...options, method: 'GET' }),
    post: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...options, method: 'POST', body }),
    put: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...options, method: 'PUT', body }),
    delete: <T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...options, method: 'DELETE' }),
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
}
export interface UseRequestResult<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  run(): Promise<T | undefined>;
  refresh(): Promise<T | undefined>;
  cancel(): void;
}

export function useRequest<T>(service: (client: RequestClient, signal: AbortSignal) => Promise<T>, options: UseRequestOptions<T> = {}): UseRequestResult<T> {
  const client = useRequestClient();
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({
    data: undefined, error: undefined, loading: !options.manual,
  });
  const serviceRef = useRef(service), optionsRef = useRef(options);
  serviceRef.current = service; optionsRef.current = options;
  const mounted = useRef(true), generation = useRef(0), controller = useRef<AbortController | undefined>(undefined);
  const run = useCallback(async (): Promise<T | undefined> => {
    const token = ++generation.current;
    controller.current?.abort();
    const current = controller.current = new AbortController();
    setState(value => ({ ...value, loading: true, error: undefined }));
    try {
      const data = await serviceRef.current(client, current.signal);
      if (mounted.current && token === generation.current) {
        setState({ data, error: undefined, loading: false });
        optionsRef.current.onSuccess?.(data);
      }
      return data;
    } catch (error) {
      const aborted = current.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      if (mounted.current && token === generation.current) {
        setState(value => ({ ...value, loading: false, ...(aborted ? {} : { error }) }));
        if (!aborted) optionsRef.current.onError?.(error);
      }
      return undefined;
    }
  }, [client]);
  const cancel = useCallback(() => {
    controller.current?.abort();
    generation.current++;
    setState(value => ({ ...value, loading: false }));
  }, []);
  const manual = options.manual === true;
  useEffect(() => {
    mounted.current = true;
    if (!manual) void run();
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [manual, run]);
  return { ...state, run, refresh: run, cancel };
}

/** Runtime plugin object consumed by the generated entry when requestPlugin is mounted. */
export const requestRuntime = { Provider: RequestProvider };
