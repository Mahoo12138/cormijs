import { createElement, StrictMode, type ComponentType, type ReactNode } from 'react';
import { renderToReadableStream, renderToString } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, matchRoutes, StaticRouterProvider, type RouteObject } from 'react-router';
import { copyClientRoutes, type HistoryType, type RuntimeConfig } from './app-config.js';
import { ModelProvider, type ModelDescriptor } from './model.js';
import { collectHead, mergeHeads, type RouteHead } from './head.js';

export interface ServerLoaderArgs {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
}
export type ServerLoaderFunction = (args: ServerLoaderArgs) => unknown | Promise<unknown>;
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
  /** Server-only loaders keyed by route id; supplied by the generated server entry. */
  readonly serverLoaders?: Readonly<Record<string, ServerLoaderFunction>>;
}
export interface ServerRenderResult {
  readonly html: string;
  readonly status: number;
  readonly headers: Headers;
  readonly head: RouteHead;
}
export interface ServerStreamResult {
  readonly stream: ReadableStream<Uint8Array>;
  readonly status: number;
  readonly headers: Headers;
  readonly head: RouteHead;
  /** Resolves with the hydration script once the stream reaches it, or with '' when absent. */
  readonly hydration: Promise<string>;
}

const DefaultLoading = () => createElement('p', { role: 'status' }, 'Loading…');
const NotFound = () => createElement('main', null, createElement('h1', null, '404'), createElement('p', null, 'Page not found.'));
const RouteFailure = () => createElement('main', { role: 'alert' }, 'This page could not be loaded.');

/** Binds a page module's serverLoader export lazily so a bad export becomes a route error, not a boot failure. */
export function serverLoaderExport(page: object, exportName: string, routeId: string): ServerLoaderFunction {
  return (args) => {
    const value = (page as Record<string, unknown>)[exportName];
    if (typeof value !== 'function') throw new TypeError(`SERVER_LOADER_INVALID: ${routeId} expects ${exportName} to export a function`);
    return value(args);
  };
}

/**
 * Replaces generated client fetch stubs with the real server loader and removes stubs the server bundle
 * does not cover, so static rendering never calls back into its own endpoint.
 */
function applyServerLoaders(routes: readonly RouteObject[], loaders: ServerApplication['serverLoaders']): void {
  for (const route of routes) {
    const stub = (route.loader as { cormiServerLoaderStub?: unknown } | undefined)?.cormiServerLoaderStub;
    const loader = route.id === undefined ? undefined : loaders?.[route.id];
    if (loader !== undefined) {
      route.loader = (args) => loader({ request: args.request, params: args.params });
    } else if (typeof stub === 'string') delete route.loader;
    if (route.children) applyServerLoaders(route.children, loaders);
  }
}

function applicationBasename(application: ServerApplication): string {
  return (application.history ?? 'browser') === 'browser' ? application.base ?? '/' : '/';
}

function stripBasename(url: URL, basename: string): URL {
  if (basename !== '/' && (url.pathname === basename || url.pathname.startsWith(basename))) {
    url.pathname = url.pathname.slice(basename.length - 1) || '/';
  }
  return url;
}

/**
 * Renders the same route tree/providers as the client through React Router's static handler.
 * Loaders run on the server; the returned HTML includes React Router's hydration script.
 * App setup/render/onRouteChange hooks are client lifecycles and are not invoked here.
 */
export async function renderServerApplication(application: ServerApplication, request: Request): Promise<ServerRenderResult | Response> {
  const basename = applicationBasename(application);
  const lifetime = new AbortController();
  const sourceRoutes = copyClientRoutes(application.routes);
  const routes = copyClientRoutes(sourceRoutes);
  if (await application.appConfig?.patchClientRoutes?.({ signal: lifetime.signal, basename, routes }) !== undefined) {
    throw new TypeError('APP_ROUTES_INVALID: patchClientRoutes mutates routes and must return void');
  }
  applyServerLoaders(routes, application.serverLoaders);
  const clientRoutes = copyClientRoutes(routes);
  const LoadingComponent = application.loading ?? DefaultLoading;
  const tree: RouteObject[] = [{ id: 'cormi:root', HydrateFallback: LoadingComponent, ErrorBoundary: RouteFailure,
    children: [...clientRoutes, { id: 'cormi:404', path: '*', Component: NotFound }] }];
  const handler = createStaticHandler(tree, { basename });
  const query = new Request(request.url, { method: request.method, headers: request.headers });
  const context = await handler.query(query);
  if (context instanceof Response) return context;
  const router = createStaticRouter(handler.dataRoutes, context);
  const pathname = stripBasename(new URL(request.url), basename).pathname;
  const routeHead = collectHead(clientRoutes, pathname, basename);
  const collected: RouteHead[] = [];
  let titleTemplate: string | undefined;
  let node: ReactNode = <ModelProvider models={application.models ?? []}><StaticRouterProvider router={router} context={context} /></ModelProvider>;
  const entries = application.plugins ?? [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.plugin.Provider) {
      const head = (entry.plugin as { readonly cormiHeadRuntime?: unknown }).cormiHeadRuntime === true;
      if (head && typeof (entry.options as { titleTemplate?: unknown } | undefined)?.titleTemplate === 'string') titleTemplate = (entry.options as { titleTemplate: string }).titleTemplate;
      node = createElement(entry.plugin.Provider, { options: entry.options ?? {}, appConfig: application.appConfig ?? {}, routes: clientRoutes,
        basename, prefetch: application.prefetch ?? {}, signal: lifetime.signal, ...(head ? { serverCollector: collected } : {}) }, node);
    }
  }
  if (application.appConfig?.rootContainer) node = application.appConfig.rootContainer(node, { signal: lifetime.signal, basename, routes: clientRoutes });
  if (application.strict) node = createElement(StrictMode, null, node);
  const html = renderToString(node);
  const merged = mergeHeads(routeHead, collected);
  const head: RouteHead = merged.title !== undefined && titleTemplate !== undefined
    ? Object.freeze({ ...merged, title: `${merged.title}${titleTemplate}` }) : merged;
  return Object.freeze({ html, status: context.statusCode, headers: new Headers(), head });
}

const HYDRATION_START = '<script>window.__staticRouterHydrationData = ';

/** Moves React Router's trailing hydration script out of the stream so the shell can place it outside the root. */
/** Moves React Router's trailing hydration script out of the stream so the shell can place it outside the root. */
function hydrationSplitter(report: (script: string) => void): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  let buffer = '', state: 'scan' | 'script' | 'done' = 'scan', reported = false;
  const finish = (script: string): void => {
    if (reported) return;
    reported = true; report(script);
  };
  const emit = (controller: TransformStreamDefaultController<Uint8Array>, text: string): void => {
    if (text) controller.enqueue(encoder.encode(text));
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (state === 'done') { controller.enqueue(chunk); return; }
      buffer += decoder.decode(chunk, { stream: true });
      if (state === 'scan') {
        const index = buffer.indexOf(HYDRATION_START);
        if (index < 0) {
          const keep = Math.min(buffer.length, HYDRATION_START.length - 1);
          if (buffer.length > keep) {
            emit(controller, buffer.slice(0, buffer.length - keep));
            buffer = buffer.slice(buffer.length - keep);
          }
          return;
        }
        if (index > 0) emit(controller, buffer.slice(0, index));
        buffer = buffer.slice(index);
        state = 'script';
      }
      const end = buffer.indexOf('</script>');
      if (end < 0) return;
      finish(buffer.slice(0, end + 9));
      const rest = buffer.slice(end + 9);
      buffer = ''; state = 'done';
      emit(controller, rest);
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) emit(controller, buffer);
      buffer = '';
      finish('');
    },
  });
}

/**
 * Streaming variant of renderServerApplication. The promise resolves after the non-suspended tree and
 * route/Helmet head are known; suspended boundaries continue to stream into the returned ReadableStream.
 */
export async function renderServerApplicationStream(application: ServerApplication, request: Request): Promise<ServerStreamResult | Response> {
  const basename = applicationBasename(application);
  const lifetime = new AbortController();
  const routes = copyClientRoutes(application.routes);
  if (await application.appConfig?.patchClientRoutes?.({ signal: lifetime.signal, basename, routes }) !== undefined) {
    throw new TypeError('APP_ROUTES_INVALID: patchClientRoutes mutates routes and must return void');
  }
  applyServerLoaders(routes, application.serverLoaders);
  const clientRoutes = copyClientRoutes(routes);
  const LoadingComponent = application.loading ?? DefaultLoading;
  const tree: RouteObject[] = [{ id: 'cormi:root', HydrateFallback: LoadingComponent, ErrorBoundary: RouteFailure,
    children: [...clientRoutes, { id: 'cormi:404', path: '*', Component: NotFound }] }];
  const handler = createStaticHandler(tree, { basename });
  const context = await handler.query(new Request(request.url, { method: request.method, headers: request.headers }));
  if (context instanceof Response) return context;
  const router = createStaticRouter(handler.dataRoutes, context);
  const pathname = stripBasename(new URL(request.url), basename).pathname;
  const routeHead = collectHead(clientRoutes, pathname, basename);
  const collected: RouteHead[] = [];
  let titleTemplate: string | undefined;
  let node: ReactNode = <ModelProvider models={application.models ?? []}><StaticRouterProvider router={router} context={context} /></ModelProvider>;
  const entries = application.plugins ?? [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.plugin.Provider) {
      const head = (entry.plugin as { readonly cormiHeadRuntime?: unknown }).cormiHeadRuntime === true;
      if (head && typeof (entry.options as { titleTemplate?: unknown } | undefined)?.titleTemplate === 'string') titleTemplate = (entry.options as { titleTemplate: string }).titleTemplate;
      node = createElement(entry.plugin.Provider, { options: entry.options ?? {}, appConfig: application.appConfig ?? {}, routes: clientRoutes,
        basename, prefetch: application.prefetch ?? {}, signal: lifetime.signal, ...(head ? { serverCollector: collected } : {}) }, node);
    }
  }
  if (application.appConfig?.rootContainer) node = application.appConfig.rootContainer(node, { signal: lifetime.signal, basename, routes: clientRoutes });
  if (application.strict) node = createElement(StrictMode, null, node);
  let resolveHydration!: (script: string) => void;
  const hydration = new Promise<string>(resolve => { resolveHydration = resolve; });
  const splitter = hydrationSplitter(script => resolveHydration(script));
  const source = await renderToReadableStream(node, { onError(error) { console.error('[cormi:ssr:stream]', error); } });
  const merged = mergeHeads(routeHead, collected);
  const head: RouteHead = merged.title !== undefined && titleTemplate !== undefined
    ? Object.freeze({ ...merged, title: `${merged.title}${titleTemplate}` }) : merged;
  return Object.freeze({ stream: source.pipeThrough(splitter), status: context.statusCode, headers: new Headers(), head, hydration });
}

const loaderJson = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

/**
 * Executes the server loaders of every matched route, in match order, for a client navigation.
 * Data is JSON-only; a loader throwing a Response (for example a redirect) is returned as-is.
 */
export async function renderServerLoaderData(application: ServerApplication, request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return loaderJson({ error: 'SERVER_LOADER_METHOD' }, 405, { allow: 'GET, HEAD' });
  const basename = applicationBasename(application);
  const lifetime = new AbortController();
  const routes = copyClientRoutes(application.routes);
  if (await application.appConfig?.patchClientRoutes?.({ signal: lifetime.signal, basename, routes }) !== undefined) {
    throw new TypeError('APP_ROUTES_INVALID: patchClientRoutes mutates routes and must return void');
  }
  const url = new URL(request.url);
  const matches = matchRoutes(routes, url.pathname, basename);
  if (!matches) return loaderJson({ error: 'SERVER_LOADER_NOT_FOUND' }, 404);
  const data: Record<string, unknown> = Object.create(null);
  for (const match of matches) {
    const routeId = match.route.id;
    const loader = routeId === undefined ? undefined : application.serverLoaders?.[routeId];
    if (loader === undefined || routeId === undefined) continue;
    try {
      data[routeId] = await loader({ request: new Request(url, { method: 'GET', headers: request.headers }), params: match.params });
    } catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }
  }
  let body: string;
  try { body = JSON.stringify({ data }); }
  catch { throw new TypeError(`SERVER_LOADER_SERIALIZE: serverLoader data is not JSON-serializable (${url.pathname})`); }
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
