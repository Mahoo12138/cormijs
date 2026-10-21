import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

export type ModelAction = string | { readonly type: string; readonly payload?: unknown };
export type ModelDispatch = (action: ModelAction) => Promise<unknown>;
export interface ModelEffectHelpers {
  put(action: ModelAction): Promise<unknown>;
  call<T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]): Promise<Awaited<T>>;
  state(): unknown;
}
export interface ModelSubscriptionHelpers {
  dispatch: ModelDispatch;
  state(): unknown;
}
export type ModelSubscription = (helpers: ModelSubscriptionHelpers) => void | (() => void);
export type ModelReducer<S = unknown> = (state: S, action: { readonly type: string; readonly payload?: unknown }) => S;
export type ModelEffect<S = unknown> = (action: { readonly type: string; readonly payload?: unknown }, helpers: ModelEffectHelpers) => unknown;
export interface ObjectModel<S = unknown> {
  readonly state: S;
  readonly reducers?: Readonly<Record<string, ModelReducer<S>>>;
  readonly effects?: Readonly<Record<string, ModelEffect<S>>>;
  readonly subscriptions?: Readonly<Record<string, ModelSubscription>>;
}
export interface ModelDescriptor {
  readonly namespace: string;
  readonly model: (() => unknown) | ObjectModel<any>;
}
/** Identity helper that types reducers/effects from the declared state without a schema library. */
export function defineModel<S>(model: ObjectModel<S>): ObjectModel<S> { return model; }
type Dispatch = ModelDispatch;
interface Store {
  readonly namespace: string;
  readonly dispatch: Dispatch;
  readonly getState: () => unknown;
  readonly subscribe: (listener: () => void) => () => void;
  readonly start: () => () => void;
}
interface ModelScope {
  readonly hooks: Readonly<Record<string, unknown>>;
  readonly stores: ReadonlyMap<string, Store>;
}
const ModelContext = createContext<ModelScope | null>(null);

const isObjectModel = (value: unknown): value is ObjectModel<any> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'state');

function actionOf(action: ModelAction): { type: string; payload?: unknown } {
  if (typeof action === 'string') return { type: action };
  if (!action || typeof action !== 'object' || typeof action.type !== 'string' || !action.type) throw new TypeError('MODEL_ACTION_INVALID: expected an action name or { type }.');
  return action;
}

/** Global dispatch requires `namespace/action`; bound stores accept a bare reducer/effect name. */
function dispatchGlobal(stores: ReadonlyMap<string, Store>, action: ModelAction): Promise<unknown> {
  const value = actionOf(action), index = value.type.indexOf('/');
  if (index <= 0 || index === value.type.length - 1) throw new Error(`MODEL_ACTION_INVALID: ${value.type} needs a namespace/action type`);
  const store = stores.get(value.type.slice(0, index));
  if (!store) throw new Error(`MODEL_DISPATCH_UNSUPPORTED: ${value.type.slice(0, index)} is not an object model`);
  return store.dispatch({ ...value, type: value.type.slice(index + 1) });
}

function createStore(namespace: string, model: ObjectModel<any>, global: (action: ModelAction) => Promise<unknown>): Store {
  const reducers = model.reducers ?? {}, effects = model.effects ?? {}, subscriptions = model.subscriptions ?? {};
  for (const [kind, entries] of [['reducers', reducers], ['effects', effects], ['subscriptions', subscriptions]] as const) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.values(entries).some(entry => typeof entry !== 'function')) {
      throw new TypeError(`MODEL_INVALID: ${namespace} ${kind} must be a function map`);
    }
  }
  let state = model.state;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const helpers: ModelEffectHelpers = {
    put: action => {
      const value = actionOf(action);
      return global(value.type.includes('/') ? value : { ...value, type: `${namespace}/${value.type}` });
    },
    async call<T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]): Promise<Awaited<T>> {
      return await fn(...args) as Awaited<T>;
    },
    state: () => state,
  };
  const dispatch: Dispatch = async action => {
    const value = { ...actionOf(action) };
    if (value.type.includes('/')) {
      const [prefix, name] = [value.type.slice(0, value.type.indexOf('/')), value.type.slice(value.type.indexOf('/') + 1)];
      if (prefix !== namespace) throw new Error(`MODEL_ACTION_INVALID: ${value.type} is outside ${namespace}`);
      value.type = name;
    }
    if (Object.hasOwn(reducers, value.type)) {
      const next = reducers[value.type]!(state, value);
      if (next === undefined) throw new TypeError(`MODEL_REDUCER_INVALID: ${namespace}/${value.type} must return state`);
      state = next; notify(); return state;
    }
    if (Object.hasOwn(effects, value.type)) return effects[value.type]!(value, helpers);
    throw new Error(`MODEL_ACTION_NOT_FOUND: ${namespace}/${value.type}`);
  };
  return Object.freeze({
    namespace,
    dispatch,
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      const cleanups: Array<() => void> = [];
      for (const [name, subscribe] of Object.entries(subscriptions)) {
        try {
          const cleanup = subscribe({ dispatch, state: () => state });
          if (typeof cleanup === 'function') cleanups.push(cleanup);
        } catch (error) { console.error(`[cormi:model-subscription] ${namespace}/${name}`, error); }
      }
      return () => {
        for (const cleanup of cleanups.reverse()) {
          try { cleanup(); }
          catch (error) { console.error(`[cormi:model-subscription] ${namespace} cleanup`, error); }
        }
      };
    },
  });
}

/** Execute hook models per render and instantiate object model stores once per mount. */
export function ModelProvider({ models, children }: { readonly models: readonly ModelDescriptor[]; readonly children: ReactNode }) {
  const [stores] = useState(() => {
    const created = new Map<string, Store>(), namespaces = new Set<string>();
    const global = (action: ModelAction) => dispatchGlobal(created, action);
    for (const item of models) {
      if (!item || typeof item.namespace !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(item.namespace) || namespaces.has(item.namespace)) {
        throw new TypeError(`MODEL_INVALID: ${String(item?.namespace)}`);
      }
      namespaces.add(item.namespace);
      if (!isObjectModel(item.model) && typeof item.model !== 'function') throw new TypeError(`MODEL_INVALID: ${item.namespace}`);
      if (isObjectModel(item.model)) created.set(item.namespace, createStore(item.namespace, item.model, global));
    }
    return created;
  });
  const hooks: Record<string, unknown> = {};
  for (const item of models) {
    const model = item.model;
    if (typeof model === 'function') hooks[item.namespace] = model();
  }
  useEffect(() => {
    const cleanups = [...stores.values()].map(store => store.start());
    return () => { for (const cleanup of cleanups.reverse()) cleanup(); };
  }, [stores]);
  const scope: ModelScope = Object.freeze({ hooks: Object.freeze(hooks), stores });
  return <ModelContext.Provider value={scope}>{children}</ModelContext.Provider>;
}

const noopSubscribe = () => () => {};

export function useModel<State = unknown, Selected = State>(namespace: string, selector?: (state: State) => Selected): Selected {
  const scope = useContext(ModelContext);
  if (!scope) throw new Error('MODEL_OUTSIDE_APPLICATION: useModel must be used inside a cormi mount');
  const store = scope.stores.get(namespace);
  const state = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getState ?? (() => undefined), store?.getState ?? (() => undefined));
  if (store) return selector ? selector(state as State) : state as unknown as Selected;
  if (!Object.hasOwn(scope.hooks, namespace)) throw new Error(`MODEL_NOT_FOUND: ${namespace}`);
  const hook = scope.hooks[namespace] as State;
  return selector ? selector(hook) : hook as unknown as Selected;
}

/** Bound dispatch for an object model; hook models have no store to dispatch into. */
export function useModelDispatch(namespace: string): Dispatch {
  const scope = useContext(ModelContext);
  if (!scope) throw new Error('MODEL_OUTSIDE_APPLICATION: useModelDispatch must be used inside a cormi mount');
  const store = scope.stores.get(namespace);
  if (!store) throw new Error(`MODEL_DISPATCH_UNSUPPORTED: ${namespace} is not an object model`);
  return store.dispatch;
}

/** Global dispatch using `namespace/action` types. */
export function useGlobalModelDispatch(): Dispatch {
  const scope = useContext(ModelContext);
  if (!scope) throw new Error('MODEL_OUTSIDE_APPLICATION: useGlobalModelDispatch must be used inside a cormi mount');
  return action => dispatchGlobal(scope.stores, action);
}
