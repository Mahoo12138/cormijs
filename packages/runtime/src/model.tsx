import { createContext, useContext, type ReactNode } from 'react';

export interface ModelDescriptor {
  readonly namespace: string;
  readonly model: () => unknown;
}
const ModelContext = createContext<Readonly<Record<string, unknown>> | null>(null);

/** Execute each model hook once per mount and share its returned state with the route tree. */
export function ModelProvider({ models, children }: { readonly models: readonly ModelDescriptor[]; readonly children: ReactNode }) {
  const values: Record<string, unknown> = {};
  for (const item of models) {
    if (!item || typeof item.namespace !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(item.namespace)
      || typeof item.model !== 'function' || Object.hasOwn(values, item.namespace)) {
      throw new TypeError(`MODEL_INVALID: ${String(item?.namespace)}`);
    }
    values[item.namespace] = item.model();
  }
  return <ModelContext.Provider value={Object.freeze(values)}>{children}</ModelContext.Provider>;
}

export function useModel<State = unknown, Selected = State>(namespace: string, selector?: (state: State) => Selected): Selected {
  const values = useContext(ModelContext);
  if (!values) throw new Error('MODEL_OUTSIDE_APPLICATION: useModel must be used inside a cormi mount');
  if (!Object.hasOwn(values, namespace)) throw new Error(`MODEL_NOT_FOUND: ${namespace}`);
  const state = values[namespace] as State;
  return selector ? selector(state) : state as unknown as Selected;
}
