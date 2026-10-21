import { createElement, StrictMode, type ComponentType, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider, type RouteObject } from 'react-router';
import { copyClientRoutes, type HistoryType, type RuntimeConfig } from './app-config.js';
import { ModelProvider, type ModelDescriptor } from './model.js';

export interface ServerRuntimeEntry {
  readonly id: string;
  readonly plugin: { readonly Provider?: ComponentType<{ options: unknown; appConfig: Readonly<RuntimeConfig>; routes: readonly RouteObject[]; basename: string; prefetch?: Readonly<Record<string, () => Promise<unknown>>>; signal?: AbortSignal }> };
  readonly options?: unknown;
}
export interface ServerApplication {
  readonly routes: readonly RouteObject[];
  readonly plugins?: readonly ServerRuntimeEntry[];
  readonly base?: string;
  readonly strict?: boolean;
  readonly appConfig?: Readonly<RuntimeConfig>;
  readonly loading?: ComponentType;
  readonly history?: HistoryType;
  readonly models?: readonly ModelDescriptor[];
  readonly prefetch?: Readonly<Record<string, () => Promise<unknown>>>;
}
export interface ServerRenderResult {
  readonly html: string;
  readonly status: number;
  readonly headers: Headers;
}

const DefaultLoading = () => createElement('p', { role: 'status' }, 'Loading…');
const NotFound = () => createElement('main', null, createElement('h1', null, '404'), createElement('p', null, 'Page not found.'));
const RouteFailure = () => createElement('main', { role: 'alert' }, 'This page could not be loaded.');

/**
 * Renders the same route tree/providers as the client through React Router's static handler.
 * Loaders run on the server; the returned HTML includes React Router's hydration script.
 * App setup/render/onRouteChange hooks are client lifecycles and are not invoked here.
 */
export async function renderServerApplication(application: ServerApplication, request: Request): Promise<ServerRenderResult | Response> {
  const history = application.history ?? 'browser';
  const basename = history === 'browser' ? application.base ?? '/' : '/';
  const lifetime = new AbortController();
  const sourceRoutes = copyClientRoutes(application.routes);
  const routes = copyClientRoutes(sourceRoutes);
  if (await application.appConfig?.patchClientRoutes?.({ signal: lifetime.signal, basename, routes }) !== undefined) {
    throw new TypeError('APP_ROUTES_INVALID: patchClientRoutes mutates routes and must return void');
  }
  const clientRoutes = copyClientRoutes(routes);
  const LoadingComponent = application.loading ?? DefaultLoading;
  const tree: RouteObject[] = [{ id: 'cormi:root', HydrateFallback: LoadingComponent, ErrorBoundary: RouteFailure,
    children: [...clientRoutes, { id: 'cormi:404', path: '*', Component: NotFound }] }];
  const handler = createStaticHandler(tree);
  const url = new URL(request.url);
  if (basename !== '/' && (url.pathname === basename || url.pathname.startsWith(basename))) {
    url.pathname = url.pathname.slice(basename.length - 1) || '/';
  }
  const query = new Request(url, { method: request.method, headers: request.headers });
  const context = await handler.query(query);
  if (context instanceof Response) return context;
  const staticContext = basename === '/' ? context : Object.freeze({ ...context, basename });
  const router = createStaticRouter(handler.dataRoutes, staticContext);
  let node: ReactNode = <ModelProvider models={application.models ?? []}><StaticRouterProvider router={router} context={context} /></ModelProvider>;
  const entries = application.plugins ?? [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.plugin.Provider) {
      node = createElement(entry.plugin.Provider, { options: entry.options ?? {}, appConfig: application.appConfig ?? {}, routes: clientRoutes,
        basename, prefetch: application.prefetch ?? {}, signal: lifetime.signal }, node);
    }
  }
  if (application.appConfig?.rootContainer) node = application.appConfig.rootContainer(node, { signal: lifetime.signal, basename, routes: clientRoutes });
  if (application.strict) node = createElement(StrictMode, null, node);
  return Object.freeze({ html: renderToString(node), status: context.statusCode, headers: new Headers() });
}
