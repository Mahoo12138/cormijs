{{{ beforeImport }}}
interface IDefaultRuntimeConfig {
  onRouteChange?: (props: { routes: any; clientRoutes: any; location: any; action: any; basename: string; isFirst: boolean }) => void;
  patchRoutes?: (props: { routes: any; routeComponents: any }) => void;
  patchClientRoutes?: (props: { routes: any }) => void;
  render?: (oldRender: () => void) => void;
  rootContainer?: (lastRootContainer: JSX.Element, args?: any) => any;
  innerProvider?: (container: JSX.Element, args?: any) => any;
  outerProvider?: (container: JSX.Element, args?: any) => any;
  modifyContextOpts?: (memo: any) => any;
  modifyClientRenderOpts?: (memo: any) => any;
  modifyServerLoaderRequest?: (memo: { url: string; options: RequestInit }, args: { id: string; basename?: string }) => { url: string; options: RequestInit };
  [key: string]: any;
}
{{{ runtimeConfigType }}}

export function defineApp(config: RuntimeConfig): RuntimeConfig {
  return config;
}
