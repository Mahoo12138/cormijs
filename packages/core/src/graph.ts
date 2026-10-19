import { Context, type Fiber } from 'cordis';
type Impl = Fiber['provisions'] extends ReadonlySet<infer T> ? T : never;

export interface RuntimeDependency {
  readonly name: string;
  readonly visibleProvider: string | null;
  readonly committedProvider: string | null;
  readonly resolution: 'bound' | 'retained-binding' | 'missing' | 'provider-not-active' | 'visible-unbound';
}
export interface RuntimeNode {
  readonly id: string;
  readonly uid: number | null;
  readonly pluginId?: string;
  readonly name: string;
  readonly parent: string | null;
  readonly state: string;
  readonly initializingOrDraining: boolean;
  readonly dependencies: readonly RuntimeDependency[];
}
export interface RuntimeService {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly registered: boolean;
  readonly providerState: string;
}
export interface RuntimeGraph {
  readonly format: 'cormi:runtime-graph:1';
  readonly basis: 'cordis-current-snapshot';
  readonly phase: 'open' | 'closing' | 'closed';
  readonly nodes: readonly RuntimeNode[];
  readonly services: readonly RuntimeService[];
}

/** Labels are public metadata, not arbitrary configuration or exception values. */
export function diagnosticLabel(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 160);
}
export function fiberState(fiber: Fiber): string {
  return fiber.uid === null ? 'DISPOSED' : ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'][fiber.state] ?? 'UNKNOWN';
}

/** RC.11 observation adapter. Never calls service getters/checks, reads values/config, or changes Cordis state. */
export function runtimeGraph(ctx: Context, mounted: ReadonlyMap<string, Fiber>, phase: RuntimeGraph['phase']): RuntimeGraph {
  const fibers = new Map<string, Fiber>(), ids = new Map<Fiber, string>(), names = new Map<string, string>();
  const implementations = new Map<number, Impl>();
  let retired = 0, edges = 0;
  const limit = () => { throw new Error('Runtime diagnostic snapshot exceeds its observation budget'); };
  function addFiber(fiber: Fiber): string {
    const existing = ids.get(fiber); if (existing) return existing;
    const id = fiber.uid === null ? `retired:${++retired}` : `fiber:${fiber.uid}`;
    ids.set(fiber, id);
    if (fibers.has(id)) return id;
    if (fibers.size >= 2048) return limit();
    fibers.set(id, fiber);
    return id;
  }
  addFiber(ctx.fiber);
  for (const [name, fiber] of mounted) names.set(addFiber(fiber), diagnosticLabel(name));
  for (const runtime of ctx.registry.values()) for (const fiber of runtime.fibers) addFiber(fiber);
  const store = ctx.reflect.store;
  const addImpl = (impl: Impl) => {
    if (implementations.size >= 4096 && !implementations.has(impl.uid)) limit();
    implementations.set(impl.uid, impl); addFiber(impl.ctx.fiber);
  };
  for (const key of Object.getOwnPropertySymbols(store)) addImpl(store[key]!);
  // A removed provider can still be held by a draining consumer's committed binding.
  for (const fiber of fibers.values()) {
    if (fiber !== ctx.fiber) addFiber(fiber.parent.fiber);
    for (const impl of fiber.provisions) addImpl(impl);
    for (const impl of Object.values(fiber.committed ?? {})) addImpl(impl);
  }
  const nodes = [...fibers].map(([id, fiber]): RuntimeNode => {
    const dependencies = Object.keys(fiber.inject).sort().map((name): RuntimeDependency => {
      if (++edges > 8192) return limit();
      const visible = store[fiber.ctx[Context.isolate][name]!];
      const committed = fiber.committed?.[name];
      const resolution = committed ? (visible === committed && fiberState(committed.ctx.fiber) === 'ACTIVE' ? 'bound' : 'retained-binding')
        : !visible ? 'missing' : fiberState(visible.ctx.fiber) !== 'ACTIVE' ? 'provider-not-active' : 'visible-unbound';
      return Object.freeze({ name: diagnosticLabel(name), resolution,
        visibleProvider: visible ? `service:${visible.uid}` : null,
        committedProvider: committed ? `service:${committed.uid}` : null });
    });
    return Object.freeze({ id, uid: fiber.uid, ...(names.has(id) ? { pluginId: names.get(id)! } : {}),
      name: diagnosticLabel(fiber.name), parent: fiber === ctx.fiber ? null : addFiber(fiber.parent.fiber),
      state: fiberState(fiber), initializingOrDraining: !!fiber.inertia, dependencies: Object.freeze(dependencies) });
  });
  const services = [...implementations.values()].sort((a, b) => a.uid - b.uid).map((impl): RuntimeService => Object.freeze({
    id: `service:${impl.uid}`, name: diagnosticLabel(impl.name), provider: addFiber(impl.ctx.fiber),
    registered: store[impl.isolate] === impl, providerState: fiberState(impl.ctx.fiber),
  }));
  return Object.freeze({ format: 'cormi:runtime-graph:1', basis: 'cordis-current-snapshot', phase,
    nodes: Object.freeze(nodes), services: Object.freeze(services) });
}
