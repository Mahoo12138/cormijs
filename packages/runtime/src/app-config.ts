import type { ReactNode } from 'react';
import type { Location, NavigationType, RouteObject } from 'react-router';

export type HistoryType = 'browser' | 'hash' | 'memory';
export interface RequestConfig {
  readonly baseURL?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeout?: number;
}
export interface AppRuntimeContext { readonly signal: AbortSignal; readonly basename: string }
export interface AppRoutesContext extends AppRuntimeContext { readonly routes: RouteObject[] }
export interface RootContainerContext extends AppRuntimeContext { readonly routes: readonly RouteObject[] }
export interface RouteChangeEvent {
  /** Raw history location: pathname includes basename, as with Umi's history. */
  readonly location: Readonly<Location>;
  readonly action: NavigationType;
  readonly history: HistoryType;
  readonly basename: string;
  readonly isFirst: boolean;
  /** Routes supplied to mountApplication, before patchClientRoutes. */
  readonly routes: readonly RouteObject[];
  /** Route tree actually mounted after patchClientRoutes. */
  readonly clientRoutes: readonly RouteObject[];
}
export type RuntimeCleanup = () => void | Promise<void>;
/** Browser-only configuration. Feature packages may augment this interface with their own keys. */
export interface RuntimeConfig {
  setup?(context: AppRuntimeContext): void | RuntimeCleanup | Promise<void | RuntimeCleanup>;
  render?(next: () => Promise<void>, context: AppRuntimeContext): void | Promise<void>;
  patchClientRoutes?(context: AppRoutesContext): void | Promise<void>;
  rootContainer?(container: ReactNode, context: RootContainerContext): ReactNode;
  onRouteChange?(event: RouteChangeEvent): void;
  /** Registered by initialStatePlugin; enable that plugin before using the key. */
  getInitialState?(): unknown | Promise<unknown>;
  /** Registered by requestPlugin; consumed by the per-mount request client. */
  request?: RequestConfig;
}
export const APP_RUNTIME_KEYS = Object.freeze(['setup', 'render', 'patchClientRoutes', 'rootContainer', 'onRouteChange'] as const);
type ExactConfig<T> = Record<Exclude<keyof T, keyof RuntimeConfig>, never>;
export function defineApp<T extends RuntimeConfig>(config: T & ExactConfig<T>): T;
export function defineApp<T extends RuntimeConfig>(factory: () => T & ExactConfig<T>): () => T;
export function defineApp(value: RuntimeConfig | (() => RuntimeConfig)) { return value; }

type UnwrapDefault<T> = T extends () => infer R ? R : T;
type CheckedConfig<T> = T extends RuntimeConfig ? Exclude<keyof T, keyof RuntimeConfig> extends never ? unknown : never : never;
type CheckedModule<T> = T extends { default: infer D }
  ? Exclude<keyof T, 'default'> extends never ? CheckedConfig<UnwrapDefault<D>> : never
  : CheckedConfig<T>;

/** Namespace validation runs in the browser, never while evaluating the Node config. */
export function resolveAppConfig<T extends object>(module: T & CheckedModule<NoInfer<T>>, extensionKeys: readonly string[] = []): Readonly<RuntimeConfig> {
  if (!module || typeof module !== 'object' || Array.isArray(module)) throw new TypeError('APP_RUNTIME_INVALID: expected an ESM configuration module');
  const exports = Object.keys(module);
  if (Object.hasOwn(module, 'default') && exports.some(key => key !== 'default')) throw new TypeError('APP_RUNTIME_MIXED_EXPORTS: use named configuration exports or one default export');
  let value: unknown = Object.hasOwn(module, 'default') ? (module as Record<string, unknown>).default : module;
  if (typeof value === 'function') value = value();
  if (value && typeof (value as { then?: unknown }).then === 'function') {
    void Promise.resolve(value).catch(() => {});
    throw new TypeError('APP_RUNTIME_INVALID: default factories must be synchronous; use setup or render for asynchronous initialization');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('APP_RUNTIME_INVALID: expected a configuration object');
  const allowed = new Set<string>(APP_RUNTIME_KEYS);
  for (const key of extensionKeys) {
    if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || ['default','constructor','prototype','__proto__'].includes(key) || allowed.has(key)) {
      throw new TypeError('APP_RUNTIME_KEY_CONFLICT: invalid or duplicate extension key');
    }
    allowed.add(key);
  }
  const config: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError('APP_RUNTIME_UNKNOWN_KEY: ' + key);
    const item = (value as Record<string, unknown>)[key];
    if ((APP_RUNTIME_KEYS as readonly string[]).includes(key) && item !== undefined && typeof item !== 'function') throw new TypeError('APP_RUNTIME_INVALID: ' + key + ' must be a function');
    config[key] = item;
  }
  return Object.freeze(config) as Readonly<RuntimeConfig>;
}

/** Supports callback-style delayed render and Promise-returning render. next is once-only. */
export async function runAppRender(hook: RuntimeConfig['render'], context: AppRuntimeContext, start: () => Promise<void>): Promise<void> {
  let open = true, work: Promise<void> | undefined;
  let resolve!: () => void, reject!: (error: unknown) => void;
  const complete = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // The hook may await before we begin waiting for its continuation.
  void complete.catch(() => {});
  const abort = () => reject(context.signal.reason ?? new Error('Application cancelled'));
  if (context.signal.aborted) abort(); else context.signal.addEventListener('abort', abort, { once: true });
  const next = (): Promise<void> => {
    if (!open || context.signal.aborted || work) throw new Error('APP_RENDER_NEXT_INVALID: rendering was already requested or has ended');
    work = Promise.resolve().then(() => { context.signal.throwIfAborted(); return start(); });
    void work.then(resolve, reject);
    return work;
  };
  try {
    context.signal.throwIfAborted();
    if (hook) {
      const result = await hook(next, context);
      if (result !== undefined) throw new TypeError('APP_RENDER_INVALID: render must return void or Promise<void>');
    } else next();
    await complete;
    context.signal.throwIfAborted();
  } finally {
    open = false; context.signal.removeEventListener('abort', abort);
    // Already entered rendering must settle before the mount releases its acquired resources.
    if (work) await work;
  }
}

/** Clone the route tree before runtime patches; components/functions are intentionally retained. */
export function copyClientRoutes(routes: readonly RouteObject[], ancestors = new Set<unknown>(), depth = 0): RouteObject[] {
  if (!Array.isArray(routes) || depth > 128 || ancestors.has(routes)) throw new TypeError('APP_ROUTES_INVALID: cyclic or excessive route tree');
  const next = new Set(ancestors); next.add(routes);
  return routes.map(route => {
    if (!route || typeof route !== 'object') throw new TypeError('APP_ROUTES_INVALID: expected a route object');
    return { ...route, ...(route.children ? { children: copyClientRoutes(route.children, next, depth + 1) } : {}) } as RouteObject;
  });
}
