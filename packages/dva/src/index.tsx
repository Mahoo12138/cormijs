import { create } from 'dva-core';
import { produce } from 'immer';
import { createContext, createElement, memo, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';

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
  /** Allow reducers to mutate the draft state (Umi `dva.immer`). */
  readonly immer?: boolean;
  /** Add the `loading` model and track global/model/effect loading state. */
  readonly loading?: boolean;
  /** Allow auto-discovery to mount an app before any model files exist. */
  readonly allowEmpty?: boolean;
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

const loadingModel = {
  namespace: 'loading',
  state: { global: false, models: {}, effects: {} },
  reducers: {
    show(state: { global: boolean; models: Record<string, boolean>; effects: Record<string, boolean> }, action: { payload: { namespace: string; action: string } }) {
      const { namespace, action: effect } = action.payload;
      return { global: true, models: { ...state.models, [namespace]: true }, effects: { ...state.effects, [effect]: true } };
    },
    hide(state: { global: boolean; models: Record<string, boolean>; effects: Record<string, boolean> }, action: { payload: { namespace: string; action: string } }) {
      const { namespace, action: effect } = action.payload;
      const effects = { ...state.effects };
      delete effects[effect];
      const models = { ...state.models };
      if (Object.keys(effects).some(key => key.startsWith(namespace + '/'))) models[namespace] = true;
      else delete models[namespace];
      return { global: Object.keys(models).length > 0, models, effects };
    },
  },
};
const loadingPlugin = {
  onEffect(effect: (...args: unknown[]) => unknown, { put }: { put(action: unknown): unknown }, model: { namespace: string }, key: string) {
    const action = `${model.namespace}/${key}`;
    return function* (...args: unknown[]): Generator<unknown, unknown, unknown> {
      yield put({ type: 'loading/show', payload: { namespace: model.namespace, action } });
      try { return yield effect(...args); }
      finally { yield put({ type: 'loading/hide', payload: { namespace: model.namespace, action } }); }
    };
  },
};

function immerReducers(model: DvaModel): DvaModel {
  if (!model.reducers) return model;
  const reducers = Object.fromEntries(Object.entries(model.reducers).map(([key, reducer]) => [key,
    (state: unknown, action: unknown) => produce(state, draft => {
      const result = reducer(draft, action);
      if (result !== undefined && result !== draft) return result;
    })]));
  return { ...model, reducers };
}

/** Creates the Provider contribution for an application runtime module. */
export function createDvaRuntime(models: readonly DvaModel[], options: DvaRuntimeOptions = {}) {
  if (!Array.isArray(models)) throw new TypeError('DVA_INVALID: models must be an array');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('DVA_INVALID: options must be an object');
  const { allowEmpty = false, immer = false, loading = false, ...appOptions } = options;
  if (typeof allowEmpty !== 'boolean' || typeof immer !== 'boolean' || typeof loading !== 'boolean') {
    throw new TypeError('DVA_INVALID: allowEmpty, immer and loading must be boolean');
  }
  if (!models.length && !allowEmpty) throw new TypeError('DVA_INVALID: models must be a non-empty array');
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
  if (loading && namespaces.has('loading')) throw new TypeError('DVA_INVALID: the loading namespace is reserved when loading is enabled');
  function DvaProvider({ children }: DvaProviderProps) {
    // useState initializer runs once per mount; the factory is only called once even in Strict Mode.
    const [ctx] = useState<DvaContextValue>(() => {
      const app = create({ ...appOptions }, { initialReducer: {}, setupApp() {} });
      if (loading) app.use(loadingPlugin);
      for (const model of registered) app.model({ ...(immer ? immerReducers(model) : model) });
      if (loading) app.model(loadingModel);
      app.start();
      return { app, store: app._store };
    });
    useEffect(() => () => {
      // Cancel effects and unlisten subscriptions for each registered model on unmount.
      // dva-core exposes app.unmodel for this purpose; loading model is cleaned up last.
      for (const model of registered) {
        try { (ctx.app as unknown as { unmodel?(ns: string): void }).unmodel?.(model.namespace); } catch { /* best-effort cleanup */ }
      }
      if (loading) {
        try { (ctx.app as unknown as { unmodel?(ns: string): void }).unmodel?.('loading'); } catch { /* best-effort cleanup */ }
      }
    }, [ctx]);
    return <DvaContext.Provider value={ctx}>{children}</DvaContext.Provider>;
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
    const Connected = memo(function Connected(props: OwnProps) {
      const stateProps = useSelector(mapState);
      const dispatch = useDispatch();
      const dispatchProps = useMemo(() => mapDispatch ? mapDispatch(dispatch) : {} as DispatchProps, [dispatch]);
      return createElement(Component, { ...props, ...stateProps, ...dispatchProps });
    });
    Connected.displayName = `connect(${Component.displayName ?? Component.name ?? 'Component'})`;
    return Connected;
  };
}
