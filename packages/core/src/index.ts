import { Context, FiberState, type Fiber, type Plugin, type Message } from 'cordis';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimeGraph } from './graph.js';
export { DiagnosticService } from './diagnostic-service.js';
export type { DiagnosticContribution, DiagnosticSection } from './diagnostic-service.js';
export type { RuntimeGraph, RuntimeNode, RuntimeService, RuntimeDependency } from './graph.js';


export { Context, Service } from 'cordis';
export type { Fiber, Plugin } from 'cordis';
export type { CommandRequest, CommandResult, CommandHandler, CommandRegistry, CommandMiddleware } from './commands.js';
export { snapshotConfig, mergeConfigData, configLeaves, configLayer } from './config-data.js';
export type { ConfigData, ConfigSource, ConfigChange, ConfigLayer, ConfigurationContext, EnvironmentSummary } from './config-data.js';

export class CormiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CormiError';
  }
}

export function deadline<T>(task: Promise<T>, ms: number, error: Error): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.reject(error);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(error), ms);
    task.then(
      value => { clearTimeout(timer); resolve(value); },
      reason => { clearTimeout(timer); reject(reason); },
    );
  });
}

/** RC.11 can retain a stale state after disposal; uid is the authoritative fence. */
export function isActive(fiber: Fiber): boolean {
  return fiber.uid !== null && fiber.state === FiberState.ACTIVE;
}

export function assertActive(ctx: Context): void {
  if (!isActive(ctx.fiber)) {
    throw new CormiError('PLUGIN_INACTIVE', 'The plugin is not active.', { plugin: ctx.fiber.name });
  }
}

/** Only owns host admission/readiness/teardown, never application or bundler policy. */
export class ProjectRuntime {
  readonly ctx = new Context();
  readonly diagnostics: Message[] = [];
  private readonly mounted = new Map<string, Fiber>();
  private phase: 'open' | 'closing' | 'closed' = 'open';
  private disposal?: Promise<void>;

  constructor(private readonly timeoutMs = 3000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive');
    this.ctx.logger.exporter({
      export: message => {
        if (message.type === 'error') this.diagnostics.push(message);
      },
    });
  }

  private assertOpen(): void {
    if (this.phase !== 'open') throw new CormiError('HOST_CLOSED', 'This project host is closing or closed.');
  }

  mount<T>(id: string, plugin: Plugin<T>, config?: T): Fiber {
    this.assertOpen();
    if (!id.trim() || this.mounted.has(id)) {
      throw new CormiError('PLUGIN_ID_CONFLICT', `Invalid or duplicate plugin id: ${id}`, { id });
    }
    const fiber = this.ctx.plugin(plugin as Plugin, config);
    this.mounted.set(id, fiber);
    return fiber;
  }

  private fibers(): Fiber[] {
    const map = new Map<number, Fiber>();
    for (const runtime of this.ctx.registry.values()) {
      for (const fiber of runtime.fibers) if (fiber.uid !== null) map.set(fiber.uid, fiber);
    }
    return [...map.values()];
  }

  inspect() {
    return [...this.mounted].map(([id, fiber]) => ({
      id, uid: fiber.uid, state: fiber.uid === null ? 'DISPOSED' :
        ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'][fiber.state] ?? 'UNKNOWN',
      requires: Object.keys(fiber.inject),
    }));
  }

  /** A synchronous observation, not a new lifecycle or a readiness assertion. */
  graph() { return runtimeGraph(this.ctx, this.mounted, this.phase); }

  async ready(): Promise<void> {
    this.assertOpen();
    const end = performance.now() + this.timeoutMs;
    for (;;) {
      this.assertOpen();
      for (const [id, fiber] of this.mounted) {
        if (fiber.uid === null) throw new CormiError('PLUGIN_DISPOSED', `Required plugin disposed: ${id}`, { id });
      }
      const fibers = this.fibers();
      for (const fiber of fibers) {
        if (fiber.state !== FiberState.FAILED) continue;
        let cause: unknown;
        try { await deadline(fiber.await(), Math.max(1, end - performance.now()), new Error('Failure did not settle')); }
        catch (error) { cause = error; }
        throw new CormiError('PLUGIN_FAILED', `Plugin failed: ${fiber.name}`, { plugin: fiber.name }, { cause });
      }
      if (fibers.every(isActive)) return;
      const blocked = fibers.filter(fiber => !isActive(fiber));
      const details = blocked.map(fiber => ({ plugin: fiber.name, requires: Object.keys(fiber.inject), state: fiber.state }));
      if (blocked.every(fiber => fiber.state === FiberState.PENDING && !fiber.inertia)) {
        throw new CormiError('SERVICE_MISSING', 'Plugin dependencies cannot become ready.', { blocked: details });
      }
      if (performance.now() >= end) {
        throw new CormiError('PLUGIN_NOT_READY', 'Plugin initialization exceeded its deadline.', { blocked: details });
      }
      // Bounded polling also covers nested native Cordis plugins, without relying on private fields.
      await delay(Math.min(5, Math.max(1, end - performance.now())));
    }
  }

  async unmount(id: string): Promise<void> {
    this.assertOpen();
    const fiber = this.mounted.get(id);
    if (!fiber) throw new CormiError('PLUGIN_NOT_FOUND', `Unknown plugin: ${id}`, { id });
    this.mounted.delete(id);
    const start = this.diagnostics.length;
    await deadline(fiber.dispose(), this.timeoutMs,
      new CormiError('CLEANUP_INCOMPLETE', `Plugin cleanup timed out: ${id}`, { id }));
    this.assertClean(start);
  }

  private assertClean(start: number): void {
    const errors = this.diagnostics.slice(start);
    if (errors.length) throw new CormiError('CLEANUP_INCOMPLETE', 'Errors occurred during plugin teardown.',
      { plugins: errors.map(error => error.name) },
      { cause: new AggregateError(errors.flatMap(error => error.args), 'Teardown errors') });
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.phase = 'closing';
    const start = this.diagnostics.length;
    const close = async () => {
      // Keep the root log exporter alive until children have finished cleanup.
      const roots = this.fibers().filter(fiber => fiber.parent.fiber === this.ctx.fiber);
      const results = await Promise.allSettled(roots.map(fiber => fiber.dispose()));
      await this.ctx.fiber.dispose();
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (rejected.length) throw new CormiError('CLEANUP_INCOMPLETE', 'Plugin teardown rejected.', {},
        { cause: new AggregateError(rejected.map(r => r.reason)) });
      this.assertClean(start);
    };
    this.disposal = deadline(close(), this.timeoutMs,
      new CormiError('CLEANUP_INCOMPLETE', 'Host cleanup timed out; resources may still be draining.'))
      .finally(() => { this.phase = 'closed'; });
    return this.disposal;
  }
}
