import { CormiError, type Plugin, type RuntimePluginDescriptor } from '@cormijs/core';
import type {} from '@cormijs/plugin-react';

export interface ReactQueryDefaults {
  /** Default stale time in milliseconds (0–86400000). */
  readonly staleTime?: number;
  /** Default garbage-collection time in milliseconds (0–86400000). */
  readonly gcTime?: number;
  /** Default retry count (0–10) or false to disable retries. */
  readonly retry?: number | false;
  readonly refetchOnWindowFocus?: boolean;
}
export interface ReactQueryPluginOptions {
  readonly id?: string;
  readonly defaults?: ReactQueryDefaults;
}

function defaultsOf(value: unknown): ReactQueryDefaults {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['staleTime', 'gcTime', 'retry', 'refetchOnWindowFocus'].includes(key))) {
    throw new CormiError('REACT_QUERY_INVALID', 'defaults may contain staleTime, gcTime, retry and refetchOnWindowFocus.');
  }
  const input = value as Record<string, unknown>, result: Record<string, unknown> = {};
  for (const key of ['staleTime', 'gcTime'] as const) {
    const item = input[key];
    if (item === undefined) continue;
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 86_400_000) throw new CormiError('REACT_QUERY_INVALID', `${key} must be 0–86400000ms.`);
    result[key] = item;
  }
  if (input.retry !== undefined) {
    if (input.retry !== false && (!Number.isInteger(input.retry) || (input.retry as number) < 0 || (input.retry as number) > 10)) throw new CormiError('REACT_QUERY_INVALID', 'retry must be false or an integer from 0 to 10.');
    result.retry = input.retry;
  }
  if (input.refetchOnWindowFocus !== undefined) {
    if (typeof input.refetchOnWindowFocus !== 'boolean') throw new CormiError('REACT_QUERY_INVALID', 'refetchOnWindowFocus must be boolean.');
    result.refetchOnWindowFocus = input.refetchOnWindowFocus;
  }
  return Object.freeze(result as ReactQueryDefaults);
}

/** Optional React Query bridge; the application keeps using @tanstack/react-query directly. */
export const reactQueryPlugin: Plugin.Object<ReactQueryPluginOptions> = {
  name: 'cormi:react-query', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'defaults'].includes(key))) {
      throw new CormiError('REACT_QUERY_INVALID', 'Invalid React Query plugin options.');
    }
    const id = options.id ?? 'cormi:react-query';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('REACT_QUERY_INVALID', 'Invalid React Query plugin id.');
    const defaults = defaultsOf(options.defaults);
    const contribution: RuntimePluginDescriptor = Object.freeze({
      id: id + ':runtime',
      module: { package: '@cormijs/plugin-react-query/runtime', export: 'reactQueryRuntime' },
      options: Object.freeze({ defaults }),
    });
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage: 20, run: () => [contribution] }));
  },
};
