import { CormiError } from '@cormijs/core';

type MaybePromise<T> = T | Promise<T>;
export interface Hook<I, O> {
  readonly id: string;
  readonly owner: string;
  readonly ownerOrder: number;
  readonly stage?: number;
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  readonly run: (input: I) => MaybePromise<O>;
}

/** Explicit snapshot semantics; this is not a plugin lifecycle or a task scheduler. */
export class OrderedHooks<I, O> {
  private readonly hooks = new Map<string, Hook<I, O>>();
  constructor(readonly phase: string) {}

  tap(hook: Hook<I, O>): () => void {
    if (!hook.id || this.hooks.has(hook.id)) {
      throw new CormiError('HOOK_ID_CONFLICT', `Duplicate hook: ${hook.id}`, { phase: this.phase, owner: hook.owner });
    }
    if (!Number.isFinite(hook.ownerOrder) || !Number.isFinite(hook.stage ?? 0)) throw new TypeError('Invalid hook order');
    const copy = Object.freeze({ ...hook, before: Object.freeze([...(hook.before ?? [])]), after: Object.freeze([...(hook.after ?? [])]) });
    this.hooks.set(hook.id, copy);
    return () => { if (this.hooks.get(hook.id) === copy) this.hooks.delete(hook.id); };
  }

  snapshot(): readonly Hook<I, O>[] {
    const nodes = new Map(this.hooks);
    const outgoing = new Map([...nodes.keys()].map(id => [id, new Set<string>()]));
    const indegree = new Map([...nodes.keys()].map(id => [id, 0]));
    const edge = (from: string, to: string) => {
      if (!nodes.has(from) || !nodes.has(to)) throw new CormiError('HOOK_TARGET_MISSING', `${from} -> ${to}`, { phase: this.phase });
      if (!outgoing.get(from)!.has(to)) {
        outgoing.get(from)!.add(to);
        indegree.set(to, indegree.get(to)! + 1);
      }
    };
    for (const hook of nodes.values()) {
      for (const id of hook.before ?? []) edge(hook.id, id);
      for (const id of hook.after ?? []) edge(id, hook.id);
    }
    const compare = (a: Hook<I, O>, b: Hook<I, O>) => (a.stage ?? 0) - (b.stage ?? 0)
      || a.ownerOrder - b.ownerOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const ready = [...nodes.values()].filter(hook => indegree.get(hook.id) === 0).sort(compare);
    const result: Hook<I, O>[] = [];
    while (ready.length) {
      const hook = ready.shift()!;
      result.push(hook);
      for (const id of outgoing.get(hook.id)!) {
        indegree.set(id, indegree.get(id)! - 1);
        if (indegree.get(id) === 0) ready.push(nodes.get(id)!);
      }
      ready.sort(compare);
    }
    if (result.length !== nodes.size) {
      throw new CormiError('HOOK_ORDER_CYCLE', 'Hook ordering contains a cycle.',
        { phase: this.phase, blocked: [...indegree].filter(([, count]) => count > 0).map(([id]) => id) });
    }
    return Object.freeze(result);
  }

  private async invoke(hook: Hook<I, O>, input: I): Promise<O> {
    try { return await hook.run(input); }
    catch (cause) { throw new CormiError('HOOK_FAILED', `Hook failed: ${hook.id}`,
      { phase: this.phase, hookId: hook.id, pluginId: hook.owner }, { cause }); }
  }

  async series(this: OrderedHooks<I, void>, input: I): Promise<void> {
    for (const hook of this.snapshot()) {
      if (await this.invoke(hook, input) !== undefined) throw new CormiError('HOOK_RETURN_INVALID',
        `Series hook must return void: ${hook.id}`, { phase: this.phase, hookId: hook.id, pluginId: hook.owner });
    }
  }

  async reduce(this: OrderedHooks<I, I>, initial: I, validate: (value: unknown) => value is I): Promise<I> {
    if (!validate(initial)) throw new TypeError('Invalid initial hook value');
    let result = initial;
    for (const hook of this.snapshot()) {
      const next = await this.invoke(hook, result);
      if (!validate(next)) throw new CormiError('HOOK_RETURN_INVALID', `Invalid reducer result: ${hook.id}`,
        { phase: this.phase, hookId: hook.id, pluginId: hook.owner });
      result = next;
    }
    return result;
  }

  async collect<T>(this: OrderedHooks<I, readonly T[]>, input: I): Promise<T[]> {
    const result: T[] = [];
    for (const hook of this.snapshot()) {
      const items = await this.invoke(hook, input);
      if (!Array.isArray(items)) throw new CormiError('HOOK_RETURN_INVALID', `Collector must return array: ${hook.id}`,
        { phase: this.phase, hookId: hook.id, pluginId: hook.owner });
      result.push(...items);
    }
    return result;
  }
}
