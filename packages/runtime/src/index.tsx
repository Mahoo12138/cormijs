import { createElement, type ComponentType, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createBrowserRouter, type RouteObject, type Location } from 'react-router';
import { RouterProvider } from 'react-router/dom';

export interface RuntimePlugin {
  Provider?: ComponentType<PropsWithChildren<{ options: unknown }>>;
  setup?(context: { signal: AbortSignal; options: unknown }): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
  onRouteChange?(location: Readonly<Location>): void;
}
export interface RuntimeEntry { id: string; plugin: RuntimePlugin; options?: unknown }
export interface ApplicationHandle { dispose(): Promise<void> }
const Loading = () => <p role="status">Loading…</p>;
const NotFound = () => <main><h1>404</h1><p>Page not found.</p></main>;
const RouteFailure = () => <main role="alert">This page could not be loaded.</main>;

/** A mount owns its router, root and runtime effects; no module-global application singleton. */
export async function mountApplication(options: {
  element: HTMLElement; routes: RouteObject[]; base?: string; plugins?: readonly RuntimeEntry[];
}): Promise<ApplicationHandle> {
  const entries = options.plugins ?? [], ids = new Set<string>(), lifetime = new AbortController();
  const cleanups: Array<() => void | Promise<void>> = [];
  let root: Root | undefined, router: ReturnType<typeof createBrowserRouter> | undefined;
  let unsubscribe: (() => void) | undefined, closing: Promise<void> | undefined;
  const dispose = () => closing ??= (async () => {
    lifetime.abort(); const errors: unknown[] = [];
    for (const close of [() => unsubscribe?.(), () => router?.dispose(), () => root?.unmount(), ...cleanups.reverse()]) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Application cleanup failed');
  })();
  try {
    // Setup order is explicit. On failure, already acquired effects are released in reverse.
    for (const entry of entries) {
      if (!entry.id || ids.has(entry.id) || !entry.plugin || typeof entry.plugin !== 'object') throw new Error('Invalid or duplicate runtime plugin');
      ids.add(entry.id);
      const close = await entry.plugin.setup?.({ signal: lifetime.signal, options: entry.options ?? {} });
      if (close !== undefined && typeof close !== 'function') throw new TypeError('Runtime setup must return a disposer or void');
      if (close) cleanups.push(close);
    }
    router = createBrowserRouter([{ id: 'cormi:root', path: '/', HydrateFallback: Loading, ErrorBoundary: RouteFailure,
      children: [...options.routes, { id: 'cormi:404', path: '*', Component: NotFound }] }], { basename: options.base ?? '/' });
    let lastLocation = router.state.location;
    const notify = (location: Location) => {
      for (const entry of entries) {
        try { entry.plugin.onRouteChange?.(Object.freeze({ ...location })); } catch (error) { console.error(`[cormi:runtime:${entry.id}]`, error); }
      }
    };
    unsubscribe = router.subscribe(state => {
      if (state.location !== lastLocation) { lastLocation = state.location; notify(lastLocation); }
    });
    let node: ReactNode = <RouterProvider router={router} />;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      if (entry.plugin.Provider) node = createElement(entry.plugin.Provider, { options: entry.options ?? {} }, node);
    }
    root = createRoot(options.element); root.render(node); notify(lastLocation);
    return Object.freeze({ dispose });
  } catch (error) {
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Application startup and cleanup failed'); }
    throw error;
  }
}
