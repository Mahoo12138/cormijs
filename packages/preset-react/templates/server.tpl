{{{ importsAhead }}}
import { createApiHandler, createAppHandler } from '{{{ serverPath }}}';
import { getRoutes } from './core/route';
import { createPluginManager } from './core/plugin';
import { createHistory } from './core/history';
{{{ imports }}}

/** route modules with a `serverLoader`, by id */
export const routeModules = {
{{#routeModules}}
  '{{{ id }}}': () => import('{{{ path }}}'),
{{/routeModules}}
};

export const apiRoutes = [
{{#apiRoutes}}
  { id: '{{{ id }}}', path: '{{{ path }}}', load: () => import('{{{ file }}}') },
{{/apiRoutes}}
];

/**
 * Handle a Web `Request`: API routes, `/__serverLoader` and (with `ssr`)
 * server-side rendering. Resolves to `undefined` when it is not for the app.
 */
export function createRequestHandler(opts) {
  const onError = opts.onError || ((error) => console.error(error));
  const api = createApiHandler({ routes: apiRoutes, basename: {{{ basename }}}, onError });
  const app = createAppHandler({
    getRoutes,
    createPluginManager,
    createHistory,
    loadRouteModule: (id) => routeModules[id](),
    getTemplate: opts.getTemplate,
    basename: {{{ basename }}},
    mountElementId: {{{ mountElementId }}},
    ssr: {{{ ssr }}},
    useStream: {{{ useStream }}},
    reactRouter5Compat: {{{ reactRouter5Compat }}},
    onError,
  });
  return async (request) => (await api(request)) || (await app(request));
}

export const cormi = {{{ version }}};
