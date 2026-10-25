import { create } from 'dva-core';
import { createContext, createElement, useCallback, useContext, useRef, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';

export interface DvaModel {
  readonly namespace: string;
  readonly state?: unknown;
  readonly reducers?: Readonly<Record<string, (state: any, action: any) => unknown>>;
  readonly effects?: Readonly<Record<string, (...args: any[]) => unknown>>;
  readonly subscriptions?: Readonly<Record<string, (...args: any[]) => unknown>>;
  readonly [key: string]: unknown;
}
export interface DvaRuntimeOptions {
  readonly initialState?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}
export interface DvaStore {
  dispatch(action: unknown): unknown;
  getState(): unknown;
  subscribe(listener: () => void): () => void;
}
export interface DvaProviderProps {
  readonly children?: ReactNode;
}
interface DvaContextValue {
  readonly app: unknown;
  readonly store: DvaStore;
}
const DvaContext = createContext<DvaContextValue | null>(null);
function useDva(): DvaContextValue {
  const value = useContext(DvaContext);
  if (!value) throw new Error('DVA_MISSING: render inside a dva runtime Provider');
  return value;
}

/** Creates the Provider contribution for an application runtime module. */
export function createDvaRuntime(models: readonly DvaModel[], options: DvaRuntimeOptions = {}) {
  if (!Array.isArray(models) || !models.length) throw new TypeError('DVA_INVALID: models must be a non-empty array');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('DVA_INVALID: options must be an object');
  const namespaces = new Set<string>();
  const registered = models.map(model => {
    if (!model || typeof model !== 'object' || Array.isArray(model) || typeof model.namespace !== 'string' || !model.namespace) {
      throw new TypeError('DVA_INVALID: every model must have a namespace');
    }
    if (namespaces.has(model.namespace)) throw new TypeError(`DVA_INVALID: duplicate model ${model.namespace}`);
    namespaces.add(model.namespace);
    for (const field of ['reducers', 'effects', 'subscriptions'] as const) {
      const value = model[field];
      if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'function'))) {
        throw new TypeError(`DVA_INVALID: ${model.namespace}.${field} must contain functions`);
      }
    }
    return model;
  });
  function DvaProvider({ children }: DvaProviderProps) {
    const ref = useRef<DvaContextValue | undefined>(undefined);
    if (!ref.current) {
      const app = create({ ...options }, { initialReducer: {}, setupApp() {} });
      for (const model of registered) app.model({ ...model });
      app.start();
      ref.current = { app, store: app._store };
    }
    return <DvaContext.Provider value={ref.current}>{children}</DvaContext.Provider>;
  }
  return Object.freeze({ Provider: DvaProvider });
}

export function useDvaApp(): unknown { return useDva().app; }
export function useStore(): DvaStore { return useDva().store; }
export function useDispatch(): (action: unknown) => unknown {
  const store = useDva().store;
  return useCallback((action: unknown) => store.dispatch(action), [store]);
}
export function useSelector<T>(selector: (state: any) => T): T {
  const store = useDva().store;
  return useSyncExternalStore(
    listener => store.subscribe(listener),
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

type MapState<StateProps> = (state: any) => StateProps;
type MapDispatch<DispatchProps> = (dispatch: (action: unknown) => unknown) => DispatchProps;
/** Minimal connect HOC for class components; hooks are preferred. */
export function connect<StateProps extends object, DispatchProps extends object = {}>(mapState: MapState<StateProps>, mapDispatch?: MapDispatch<DispatchProps>) {
  return function wrap<OwnProps extends object>(Component: ComponentType<OwnProps & StateProps & DispatchProps>): ComponentType<OwnProps> {
    function Connected(props: OwnProps) {
      const stateProps = useSelector(mapState);
      const dispatch = useDispatch();
      const dispatchProps = mapDispatch ? mapDispatch(dispatch) : {} as DispatchProps;
      return createElement(Component, { ...props, ...stateProps, ...dispatchProps });
    }
    Connected.displayName = `connect(${Component.displayName ?? Component.name ?? 'Component'})`;
    return Connected;
  };
}
