import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { RuntimeConfig } from './app-config.js';
import { useInitialState } from './initial-state.js';

export type Access = Readonly<Record<string, boolean>>;
const AccessContext = createContext<Access | null>(null);

export function AccessProvider({ appConfig, children }: { readonly appConfig: Readonly<RuntimeConfig>; readonly children?: ReactNode }) {
  const initial = useInitialState();
  const evaluate = appConfig.access;
  const access = useMemo<Access>(() => {
    if (evaluate === undefined) return Object.freeze({});
    if (typeof evaluate !== 'function') throw new TypeError('ACCESS_INVALID: access must be a function');
    const value = evaluate(initial.data);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.entries(value).some(([key, allowed]) => !key || typeof allowed !== 'boolean')) throw new TypeError('ACCESS_INVALID: access must return a boolean map');
    return Object.freeze({ ...value });
  }, [evaluate, initial.data]);
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

export function useAccess(): Access {
  const value = useContext(AccessContext);
  if (!value) throw new Error('ACCESS_MISSING: enable accessPlugin (and initialStatePlugin) to use useAccess');
  return value;
}

/** Optional reader for features such as menus that can work without accessPlugin. */
export function useAccessOptional(): Access | null {
  return useContext(AccessContext);
}

export function Access({ accessible, fallback = null, children }: {
  readonly accessible: boolean; readonly fallback?: ReactNode; readonly children?: ReactNode;
}) {
  return <>{accessible ? children : fallback}</>;
}

/** Runtime plugin object consumed by the generated entry when accessPlugin is mounted. */
export const accessRuntime = { Provider: AccessProvider };
