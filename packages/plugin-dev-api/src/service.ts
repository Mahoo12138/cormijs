import { Context, Service } from 'cordis';
import { CormiError, deadline } from '@cormijs/core';
import { DevApiSession, validateDevApi, type DevApiBinding, type DevApiOptions } from './index.js';

export type DevApiRules = Pick<DevApiOptions, 'mocks' | 'proxies'>;
export interface DevApiHandle {
  readonly middleware: DevApiSession['middleware'];
  close(): Promise<void>;
}
interface Registration {
  readonly id: string;
  readonly owner: string;
  readonly rules: Required<DevApiRules>;
  readonly controller: AbortController;
  requests: number;
  idle?: () => void;
  closing?: Promise<void>;
}
interface State {
  readonly entries: Map<string, Registration>;
  readonly retired: Set<Registration>;
  readonly sessions: Set<DevApiSession>;
  closed: boolean;
  closing?: Promise<void>;
}
declare module 'cordis' { interface Context { devApi: DevApiService } }

/** Cordis owns caller scopes; this service only owns the development HTTP rule domain. */
export class DevApiService extends Service {
  private readonly state: State = { entries: new Map(), retired: new Set(), sessions: new Set(), closed: false };
  private readonly options: Required<DevApiOptions>;

  constructor(ctx: Context, options: DevApiOptions = {}) {
    super(ctx, 'devApi');
    this.options = validateDevApi(options);
    ctx.effect(() => () => this.close());
    if (this.options.mocks.length || this.options.proxies.length) {
      this.add('cormi:configured', { mocks: this.options.mocks, proxies: this.options.proxies });
    }
  }

  /** Registration follows the CALLER's Cordis context, including native nested plugins. */
  add(id: string, rules: DevApiRules): () => Promise<void> {
    const state = this.state;
    if (state.closed) throw new CormiError('DEV_API_CLOSED', 'Development API service is closed.');
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('DEV_API_ID_INVALID', 'Invalid development API contribution id.');
    if (state.entries.has(id)) throw new CormiError('DEV_API_ID_CONFLICT', `Duplicate API contribution: ${id}`);
    if (!rules || typeof rules !== 'object' || Array.isArray(rules) || Object.keys(rules).some(k => k !== 'mocks' && k !== 'proxies')) throw new CormiError('DEV_API_CONFIG_INVALID', 'A contribution may only provide mocks and proxies.');
    if (state.entries.size + state.retired.size >= 256) throw new CormiError('DEV_API_LIMIT', 'Too many API contributions or draining registrations.');
    const checked = validateDevApi(rules);
    const entries = [...state.entries.values()];
    // Validate the entire proposed table before publishing any rule. Conflicts never partially register.
    validateDevApi({ ...this.options,
      mocks: [...entries.flatMap(e => e.rules.mocks), ...checked.mocks],
      proxies: [...entries.flatMap(e => e.rules.proxies), ...checked.proxies] });
    const entry: Registration = { id, owner: this.ctx.fiber.name ?? 'root', rules: checked,
      controller: new AbortController(), requests: 0 };
    const dispose = this.ctx.effect(() => {
      state.entries.set(id, entry);
      return () => this.withdraw(entry);
    });
    let closing: Promise<void> | undefined;
    return () => closing ??= Promise.resolve(dispose()).then(() => {});
  }

  /** A per-server HTTP session has one shared budget across all contributors. */
  open(): DevApiHandle {
    const state = this.state;
    if (state.closed) throw new CormiError('DEV_API_CLOSED', 'Development API service is closed.');
    const session = new DevApiSession({ ...this.options, mocks: [], proxies: [] }, { acquire: (path, method) => this.acquire(path, method) });
    const dispose = this.ctx.effect(() => {
      state.sessions.add(session);
      return async () => { try { await session.close(); } finally { state.sessions.delete(session); } };
    });
    let closing: Promise<void> | undefined;
    return Object.freeze({ middleware: session.middleware, close: () => closing ??= Promise.resolve(dispose()).then(() => {}) });
  }

  /** Diagnostic metadata only: never callbacks, target origins, headers, or private options. */
  summary() {
    return Object.freeze({ prefix: this.options.prefix, contributions: Object.freeze([...this.state.entries.values()].map(e => Object.freeze({
      id: e.id, owner: e.owner,
      mocks: Object.freeze(e.rules.mocks.map(({ method, path }) => Object.freeze({ method, path }))),
      proxies: Object.freeze(e.rules.proxies.map(({ path }) => Object.freeze({ path }))),
    }))) });
  }

  private acquire(path: string, method: string): DevApiBinding | undefined {
    if (this.state.closed) return;
    const entries = [...this.state.entries.values()];
    const exact = (verb: string) => entries.map(entry => ({ entry, mock: entry.rules.mocks.find(r => r.path === path && r.method === verb) })).find(x => x.mock);
    const matched = exact(method) ?? (method === 'HEAD' ? exact('GET') : undefined);
    const proxied = matched ? undefined : entries.flatMap(entry => entry.rules.proxies.map(proxy => ({ entry, proxy })))
      .filter(x => x.proxy.path === '/' || path === x.proxy.path || path.startsWith(x.proxy.path + '/'))
      .sort((a, b) => b.proxy.path.length - a.proxy.path.length)[0];
    const entry = matched?.entry ?? proxied?.entry;
    if (!entry) return;
    entry.requests++;
    let released = false;
    return { mock: matched?.mock, proxy: proxied?.proxy, signal: entry.controller.signal,
      release() { if (released) return; released = true; if (--entry.requests === 0) entry.idle?.(); } };
  }

  private withdraw(entry: Registration): Promise<void> {
    if (entry.closing) return entry.closing;
    if (this.state.entries.get(entry.id) === entry) this.state.entries.delete(entry.id);
    this.state.retired.add(entry);
    const idle = entry.requests ? new Promise<void>(resolve => { entry.idle = resolve; }) : Promise.resolve();
    entry.closing = deadline(idle, 2000, new CormiError('DEV_API_CLEANUP_TIMEOUT', `API contribution did not drain: ${entry.id}`));
    entry.controller.abort();
    // Retain non-cooperative ownership until it really drains, even after the deadline fails.
    void idle.then(() => this.state.retired.delete(entry));
    return entry.closing;
  }

  close(): Promise<void> {
    const state = this.state;
    state.closed = true;
    // Abort callbacks may reenter close; all callers must receive the same owned operation.
    return state.closing ??= Promise.resolve().then(async () => {
      const pending = [...state.entries.values(), ...state.retired].map(e => this.withdraw(e));
      const results = await Promise.allSettled([...pending, ...[...state.sessions].map(s => s.close())]);
      const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (errors.length) throw new AggregateError(errors.map(r => r.reason), 'Development API service cleanup failed');
    });
  }
}
