export {
  createBrowserHistory,
  createHashHistory,
  createMemoryHistory,
  type History,
  type Location as HistoryLocation,
} from 'history'
export {
  createSearchParams,
  generatePath,
  matchPath,
  matchRoutes,
  Navigate,
  NavLink,
  Outlet,
  resolvePath,
  useLocation,
  useMatch,
  useNavigate,
  useOutlet,
  useOutletContext,
  useParams,
  useResolvedPath,
  useRoutes,
  useSearchParams,
} from 'react-router'
export {
  AppContext,
  useAppData,
  useClientLoaderData,
  useLoaderData,
  useRouteProps,
  useSelectedRoutes,
  useServerLoaderData,
} from './appContext.ts'
export { __getRoot, applyProviders, CLIENT_RENDER_PROVIDERS, getBrowser, renderClient, Routes, type RenderClientOpts } from './browser.tsx'
export { fetchServerLoader, type ServerLoaderRequest } from './dataFetcher.ts'
export { LinkWithPrefetch as Link, type LinkWithPrefetchProps, type PrefetchMode } from './link.tsx'
export { ApplyPluginsType, PluginManager, type PluginManagerOptions, type RuntimePlugin } from './plugin.ts'
export { RouteContext, useRouteData } from './routeContext.ts'
export { createClientRoutes } from './routes.tsx'
export { ServerInsertedHTMLContext, useServerInsertedHTML } from './serverInsertedHTML.tsx'
export type * from './types.ts'
export { withRouter, type RouteComponentProps } from './withRouter.tsx'
