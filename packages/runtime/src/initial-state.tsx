import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RuntimeConfig } from './app-config.js';

export interface InitialState<Data = unknown> {
  readonly loading: boolean;
  readonly error: unknown;
  readonly data: Data | undefined;
  setInitialState(value: Data): void;
  refresh(): Promise<void>;
}
const InitialStateContext = createContext<InitialState | null>(null);

/** Runtime provider registered by the initial-state plugin; starts once per mount. */
export function InitialStateProvider({ appConfig, children }: { readonly appConfig: Readonly<RuntimeConfig>; readonly children?: ReactNode }) {
  const getInitialState = appConfig.getInitialState;
  const [state, setState] = useState<{ loading: boolean; error: unknown; data: unknown }>({
    loading: typeof getInitialState === 'function', error: undefined, data: undefined,
  });
  const mounted = useRef(true), started = useRef(false), generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const refresh = useCallback(async () => {
    if (typeof getInitialState !== 'function') return;
    const token = ++generation.current;
    setState(current => ({ ...current, loading: true, error: undefined }));
    try {
      const data = await getInitialState();
      if (mounted.current && token === generation.current) setState({ loading: false, error: undefined, data });
    } catch (error) {
      if (mounted.current && token === generation.current) setState({ loading: false, error, data: undefined });
    }
  }, [getInitialState]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void refresh();
  }, [refresh]);
  const value = useMemo<InitialState>(() => ({
    ...state,
    setInitialState: data => {
      generation.current++;
      setState({ loading: false, error: undefined, data });
    },
    refresh,
  }), [state, refresh]);
  return <InitialStateContext.Provider value={value}>{children}</InitialStateContext.Provider>;
}

export function useInitialState<Data = unknown>(): InitialState<Data> {
  const value = useContext(InitialStateContext);
  if (!value) throw new Error('INITIAL_STATE_MISSING: enable initialStatePlugin to use useInitialState');
  return value as InitialState<Data>;
}

/** Runtime plugin object consumed by the generated entry when initialStatePlugin is mounted. */
export const initialStateRuntime = { Provider: InitialStateProvider };
