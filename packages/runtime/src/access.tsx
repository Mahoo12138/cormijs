import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import type { AccessConfig, RuntimeConfig } from './app-config.js';
import { useInitialState } from './initial-state.js';

export type Access = Readonly<Record<string, boolean>>;
const AccessContext = createContext<Access | null>(null);
const ForbiddenContext = createContext<ComponentType | null>(null);

export function AccessProvider({ appConfig, children }: { readonly appConfig: Readonly<RuntimeConfig>; readonly children?: ReactNode }) {
  const initial = useInitialState();
  const evaluate = appConfig.access;
  const forbidden = appConfig.accessForbidden ?? null;
  if (forbidden !== null && typeof forbidden !== 'function') throw new TypeError('ACCESS_INVALID: accessForbidden must be a component');
  const access = useMemo<Access>(() => {
    if (evaluate === undefined) return Object.freeze({});
    if (typeof evaluate !== 'function') throw new TypeError('ACCESS_INVALID: access must be a function');
    const value = evaluate(initial.data);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.entries(value).some(([key, allowed]) => !key || typeof allowed !== 'boolean')) throw new TypeError('ACCESS_INVALID: access must return a boolean map');
    return Object.freeze({ ...value });
  }, [evaluate, initial.data]);
  return <ForbiddenContext.Provider value={forbidden}><AccessContext.Provider value={access}>{children}</AccessContext.Provider></ForbiddenContext.Provider>;
}

/** `src/access.ts` fills the access factory only when the app configuration module does not provide one. */
export function applyAccessConvention(config: Readonly<RuntimeConfig>, factory: unknown): Readonly<RuntimeConfig> {
  if (config.access !== undefined) return config;
  if (typeof factory !== 'function') throw new TypeError('ACCESS_INVALID: the access convention module must default-export a function');
  return Object.freeze({ ...config, access: factory as AccessConfig });
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

/** Route guard used by generated routes with an access key. */
export function AccessRoute({ name }: { readonly name: string }) {
  const access = useAccess(), Forbidden = useContext(ForbiddenContext);
  if (access[name] !== true) return Forbidden ? <Forbidden /> : <main role="status"><h1>403</h1><p>Access denied.</p></main>;
  return <Outlet />;
}

/** Runtime plugin object consumed by the generated entry when accessPlugin is mounted. */
export const accessRuntime = { Provider: AccessProvider };
