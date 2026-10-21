import { createElement, StrictMode, type ComponentType, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createBrowserRouter, createHashRouter, createMemoryRouter, generatePath, Navigate, useLocation, useParams, type RouteObject, type Location } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { copyClientRoutes, runAppRender, type HistoryType, type RuntimeConfig, type RouteChangeEvent, type RuntimeCleanup } from './app-config.js';
import { ModelProvider, type ModelDescriptor } from './model.js';
export { useRouteMatches, type CormiRouteMatch } from './route-matches.js';
export { clientLoaderOf, useClientLoaderData, useClientLoaderError, useRouteLoaderDataFor, type ClientLoaderArgs, type ClientLoaderFunction } from './client-loader.js';
export { analyticsRuntime, type AnalyticsOptions, type PageViewEvent } from './analytics.js';
export { PrefetchProvider, prefetchRuntime, usePrefetch, usePrefetchOnIntent, usePrefetchOnVisible, type PrefetchApi, type PrefetchLoader, type PrefetchIntentHandlers, type PrefetchIntentOptions, type PrefetchVisibleOptions } from './prefetch.js';
export { collectHead, normalizeHead, routeHeadRuntime, serializeJsonLd, HEAD_ATTRIBUTE, type JsonLd, type HeadMeta, type HeadLink, type RouteHead, type HeadOptions, type RouteHeadRuntimeOptions } from './head.js';
export { ModelProvider, useModel, type ModelDescriptor } from './model.js';
export { InitialStateProvider, initialStateRuntime, useInitialState, type InitialState } from './initial-state.js';
export { createRequestClient, RequestError, RequestProvider, requestRuntime, useRequest, useRequestClient, type RequestClient, type RequestOptions, type RequestParams, type UseRequestOptions, type UseRequestResult } from './request.js';
export { applyLocaleCatalogs, FormattedMessage, LocaleProvider, localeRuntime, formatDateFor, formatNumberFor, formatRelativeTimeFor, richNodes, selectPluralKey, useIntl, useLocaleOptional, type IntlApi, type RichTag, type RichTags } from './locale.js';
export { formatIcu, formatIcuParts, type RichPart } from './icu.js';
export { Access, AccessProvider, accessRuntime, AccessRoute, applyAccessConvention, useAccess, useAccessOptional, type Access as AccessMap } from './access.js';
export { MenuProvider, menuRuntime, useActiveMenuKeys, useBreadcrumb, useMenu, useMenuCollapse, type BreadcrumbItem, type MenuItem } from './menu.js';
export { defineApp, resolveAppConfig, type HistoryType, type RequestConfig, type LocaleConfig, type AccessConfig, type RuntimeConfig, type AppRuntimeContext, type AppRoutesContext, type RootContainerContext, type RouteChangeEvent } from './app-config.js';
export { Link, NavLink, Navigate, Outlet, createSearchParams, useHref, useLocation, useMatch, useNavigate, useNavigation, useParams, useSearchParams } from 'react-router';

export interface RuntimePlugin {
  Provider?: ComponentType<PropsWithChildren<{ options: unknown; appConfig: Readonly<RuntimeConfig>; routes: readonly RouteObject[]; basename: string; prefetch?: Readonly<Record<string, () => Promise<unknown>>> }>>;
  setup?(context: { signal: AbortSignal; options: unknown; appConfig: Readonly<RuntimeConfig> }): void | RuntimeCleanup | Promise<void | RuntimeCleanup>;
  /** The first argument keeps the original location-only contract. */
  onRouteChange?(location: Readonly<Location>, event: RouteChangeEvent, context?: { readonly options: unknown; readonly signal: AbortSignal }): void;
}
export interface RuntimeEntry { id: string; plugin: RuntimePlugin; options?: unknown }
export interface ApplicationHandle { dispose(): Promise<void> }
const DefaultLoading = () => <p role="status">Loading…</p>;
const NotFound = () => <main><h1>404</h1><p>Page not found.</p></main>;
const RouteFailure = () => <main role="alert">This page could not be loaded.</main>;
const mountedElements = new WeakSet<HTMLElement>();
/** Generated route element for configured redirects; matches Umi's replace navigation after a route match. */
export function RedirectRoute({ to, keepQuery = false }: { readonly to: string; readonly keepQuery?: boolean }) {
  const params = useParams(), location = useLocation();
  const target = generatePath(to, params) + (keepQuery ? location.search + location.hash : '');
  return <Navigate replace to={target} />;
}

/** Finish lazy resolution, then rethrow the original import failure through the route boundary. */
export async function resolveRouteComponent(load: () => Promise<ComponentType>): Promise<ComponentType> {
  try { return await load(); }
  catch (error) { return function RouteImportFailure(): never { throw error; }; }
}

/** A mount owns its router, root and runtime effects; no module-global application singleton. */
export async function mountApplication(options: {
  element: HTMLElement; routes: RouteObject[]; base?: string; plugins?: readonly RuntimeEntry[]; strict?: boolean;
  appConfig?: Readonly<RuntimeConfig>; loading?: ComponentType; history?: HistoryType; models?: readonly ModelDescriptor[];
  prefetch?: Readonly<Record<string, () => Promise<unknown>>>; signal?: AbortSignal;
}): Promise<ApplicationHandle> {
  if (options.strict !== undefined && typeof options.strict !== 'boolean') throw new TypeError('strict must be boolean');
  if (options.history !== undefined && !['browser', 'hash', 'memory'].includes(options.history)) throw new TypeError('history must be browser, hash or memory');
  options.signal?.throwIfAborted();
  if (mountedElements.has(options.element)) throw new Error('cormi mount element is already owned');
  mountedElements.add(options.element);
  const entries = options.plugins ?? [], ids = new Set<string>(), lifetime = new AbortController();
  const appConfig: Readonly<RuntimeConfig> = options.appConfig ?? Object.freeze({});
  const history = options.history ?? 'browser';
  // Hash and memory histories keep route paths independent of the deployment base used for assets.
  const basename = history === 'browser' ? options.base ?? '/' : '/';
  const context = Object.freeze({ signal: lifetime.signal, basename });
  const cleanups: RuntimeCleanup[] = [];
  let root: Root | undefined, router: ReturnType<typeof createBrowserRouter> | undefined;
  let unsubscribe: (() => void) | undefined, closing: Promise<void> | undefined, started = false;
  const log = (id: string, error: unknown) => console.error(`[cormi:runtime:${id}]`, error);
  const dispose = (): Promise<void> => closing ??= Promise.resolve().then(async () => {
    lifetime.abort(); options.signal?.removeEventListener('abort', abort);
    const errors: unknown[] = [];
    for (const close of [() => unsubscribe?.(), () => router?.dispose(), () => root?.unmount(), ...cleanups.reverse()]) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    mountedElements.delete(options.element);
    if (errors.length) throw new AggregateError(errors, 'Application cleanup failed');
  });
  const abort = () => {
    lifetime.abort(options.signal?.reason);
    if (started) void dispose().catch(error => log('application', error));
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  const acceptCleanup = (close: void | RuntimeCleanup) => {
    if (close !== undefined && typeof close !== 'function') throw new TypeError('Runtime setup must return a disposer or void');
    if (close) cleanups.push(close);
    lifetime.signal.throwIfAborted();
  };
  try {
    for (const entry of entries) {
      if (!entry.id || ids.has(entry.id) || !entry.plugin || typeof entry.plugin !== 'object') throw new Error('Invalid or duplicate runtime plugin');
      ids.add(entry.id);
      acceptCleanup(await entry.plugin.setup?.({ ...context, options: entry.options ?? {}, appConfig }));
    }
    acceptCleanup(await appConfig.setup?.(context));
    await runAppRender(appConfig.render, context, async () => {
      const sourceRoutes = copyClientRoutes(options.routes);
      const routes = copyClientRoutes(sourceRoutes);
      if (await appConfig.patchClientRoutes?.({ ...context, routes }) !== undefined) throw new TypeError('APP_ROUTES_INVALID: patchClientRoutes mutates routes and must return void');
      lifetime.signal.throwIfAborted();
      // Validate the patched tree before constructing a router, preserving its normal lazy boundaries.
      const clientRoutes = copyClientRoutes(routes);
      // A pathless layout matches every URL; `path: '/'` would not match `*` at the basename itself.
      const LoadingComponent = options.loading ?? DefaultLoading;
      const tree: RouteObject[] = [{ id: 'cormi:root', HydrateFallback: LoadingComponent, ErrorBoundary: RouteFailure,
        children: [...clientRoutes, { id: 'cormi:404', path: '*', Component: NotFound }] }];
      router = history === 'hash' ? createHashRouter(tree, { basename })
        : history === 'memory' ? createMemoryRouter(tree, { basename, initialEntries: ['/'] })
          : createBrowserRouter(tree, { basename });
      let lastLocation: Location | undefined;
      const notify = (state: ReturnType<typeof createBrowserRouter>['state']) => {
        if (!state.initialized || lifetime.signal.aborted || state.location === lastLocation) return;
        const isFirst = lastLocation === undefined; lastLocation = state.location;
        const location = Object.freeze({ ...state.location });
        const event: RouteChangeEvent = Object.freeze({ location, action: state.historyAction, history, basename, isFirst, routes: sourceRoutes, clientRoutes });
        for (const entry of entries) {
          try { void Promise.resolve(entry.plugin.onRouteChange?.(location, event, { options: entry.options ?? {}, signal: lifetime.signal })).catch(error => log(entry.id, error)); }
          catch (error) { log(entry.id, error); }
        }
        try { void Promise.resolve(appConfig.onRouteChange?.(event)).catch(error => log('application', error)); }
        catch (error) { log('application', error); }
      };
      unsubscribe = router.subscribe(notify);
      let node: ReactNode = <ModelProvider models={options.models ?? []}><RouterProvider router={router} /></ModelProvider>;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]!;
        if (entry.plugin.Provider) node = createElement(entry.plugin.Provider, { options: entry.options ?? {}, appConfig, routes: clientRoutes, basename, prefetch: options.prefetch ?? {} }, node);
      }
      if (appConfig.rootContainer) node = appConfig.rootContainer(node, { ...context, routes: clientRoutes });
      lifetime.signal.throwIfAborted();
      if (options.strict) node = <StrictMode>{node}</StrictMode>;
      root = createRoot(options.element); root.render(node); notify(router.state);
    });
    lifetime.signal.throwIfAborted(); started = true;
    return Object.freeze({ dispose });
  } catch (error) {
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Application startup and cleanup failed'); }
    throw error;
  }
}
