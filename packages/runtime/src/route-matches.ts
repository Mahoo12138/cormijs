import { useMatches } from 'react-router';

export interface CormiRouteMatch {
  readonly id: string;
  readonly pathname: string;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly meta: Readonly<Record<string, unknown>>;
}
/** Nearest route is last. Metadata is per route, not implicitly inherited or interpreted as authorization. */
export function useRouteMatches(): readonly CormiRouteMatch[] {
  return useMatches().filter(match => !match.id.startsWith('cormi:')).map(match => {
    const handle = match.handle as { cormi?: { meta?: Record<string, unknown> } } | undefined;
    return Object.freeze({ id: match.id, pathname: match.pathname, params: Object.freeze({ ...match.params }),
      meta: Object.freeze({ ...(handle?.cormi?.meta ?? {}) }) });
  });
}
