import { createElement, StrictMode, type ComponentType, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createBrowserRouter, generatePath, Navigate, useLocation, useParams, type RouteObject, type Location } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { copyClientRoutes, runAppRender, type RuntimeConfig, type RouteChangeEvent, type RuntimeCleanup } from './app-config.js';
export { useRouteMatches, type CormiRouteMatch } from './route-matches.js';
export { defineApp, resolveAppConfig, type RuntimeConfig, type AppRuntimeContext, type AppRoutesContext, type RootContainerContext, type RouteChangeEvent } from './app-config.js';

export interface RuntimePlugin {
  Provider?: ComponentType<PropsWithChildren<{ options: unknown; appConfig: Readonly<RuntimeConfig> }>>;
  setup?(context: { signal: AbortSignal; options: unknown; appConfig: Readonly<RuntimeConfig> }): void | RuntimeCleanup | Promise<void | RuntimeCleanup>;
  /** The first argument keeps the original location-only contract. */
  onRouteChange?(location: Readonly<Location>, event: RouteChangeEvent): void;
}
export interface RuntimeEntry { id: string; plugin: RuntimePlugin; options?: unknown }
export interface ApplicationHandle { dispose(): Promise<void> }
const Loading = () => <p role="status">Loading…</p>;
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
  appConfig?: Readonly<RuntimeConfig>; signal?: AbortSignal;
}): Promise<ApplicationHandle> {
  if (options.strict !== undefined && typeof options.strict !== 'boolean') throw new TypeError('strict must be boolean');
  options.signal?.throwIfAborted();
  if (mountedElements.has(options.element)) throw new Error('cormi mount element is already owned');
  mountedElements.add(options.element);
  const entries = options.plugins ?? [], ids = new Set<string>(), lifetime = new AbortController();
  const appConfig: Readonly<RuntimeConfig> = options.appConfig ?? Object.freeze({});
  const basename = options.base ?? '/';
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
      router = createBrowserRouter([{ id: 'cormi:root', HydrateFallback: Loading, ErrorBoundary: RouteFailure,
        children: [...clientRoutes, { id: 'cormi:404', path: '*', Component: NotFound }] }], { basename });
      let lastLocation: Location | undefined;
      const notify = (state: ReturnType<typeof createBrowserRouter>['state']) => {
        if (!state.initialized || lifetime.signal.aborted || state.location === lastLocation) return;
        const isFirst = lastLocation === undefined; lastLocation = state.location;
        const location = Object.freeze({ ...state.location });
        const event: RouteChangeEvent = Object.freeze({ location, action: state.historyAction, basename, isFirst, routes: sourceRoutes, clientRoutes });
        for (const entry of entries) {
          try { void Promise.resolve(entry.plugin.onRouteChange?.(location, event)).catch(error => log(entry.id, error)); }
          catch (error) { log(entry.id, error); }
        }
        try { void Promise.resolve(appConfig.onRouteChange?.(event)).catch(error => log('application', error)); }
        catch (error) { log('application', error); }
      };
      unsubscribe = router.subscribe(notify);
      let node: ReactNode = <RouterProvider router={router} />;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]!;
        if (entry.plugin.Provider) node = createElement(entry.plugin.Provider, { options: entry.options ?? {}, appConfig }, node);
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
