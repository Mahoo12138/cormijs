import type { RouteRecord } from '@cormijs/routes';

/** Project-specific declarations only: importing these types adds no browser JavaScript. */
export function generateRouteTypes(routes: readonly RouteRecord[]): string {
  const nodes = new Map(routes.map(route => [route.id, route]));
  const paths = new Map<string, string>();
  const pathOf = (route: RouteRecord): string => {
    const cached = paths.get(route.id); if (cached !== undefined) return cached;
    const parent = route.parentId ? pathOf(nodes.get(route.parentId)!) : '';
    const path = (parent + '/' + (route.path ?? '')).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    paths.set(route.id, path); return path;
  };
  const union = (items: readonly string[]) => [...new Set(items)].map(value => JSON.stringify(value)).join(' | ') || 'never';
  return [
    `export type RouteId = ${union(routes.map(route => route.id))};`,
    `export type RoutePath = ${union(routes.map(pathOf))};`,
    'export interface RouteParamsById {',
    ...routes.map(route => {
      const parameters = [...new Set(pathOf(route).split('/').filter(part => part.startsWith(':') || part === '*').map(part => part === '*' ? '*' : part.slice(1)))];
      return `  ${JSON.stringify(route.id)}: ${parameters.length ? '{ ' + parameters.map(name => `readonly ${JSON.stringify(name)}: string`).join('; ') + ' }' : 'Readonly<Record<string, never>>'};`;
    }),
    '}',
    'export type RouteParams<Id extends RouteId> = RouteParamsById[Id];',
    'declare global {',
    '  interface ImportMetaEnv {',
    '    readonly [key: `CORMI_PUBLIC_${string}`]: string | undefined;',
    '    readonly BASE_URL: string; readonly MODE: string;',
    '    readonly DEV: boolean; readonly PROD: boolean; readonly SSR: boolean;',
    '  }',
    '  interface ImportMeta { readonly env: ImportMetaEnv }',
    '}',
    '',
  ].join('\n');
}
