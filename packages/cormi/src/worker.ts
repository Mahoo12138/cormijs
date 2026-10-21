import { ProjectRuntime, CormiError, type CommandResult } from '@cormijs/core';
import { executionSession } from './execution-session.js';
import { pathToFileURL } from 'node:url';
import { resolveEnvironment } from './environment.js';
import { normalizeConfig } from './config.js';
import { verifyLease } from './lock.js';
import { fingerprint } from './inputs.js';
import { wireError, type StartMessage, type WorkerMessage } from './protocol.js';

let started = false; let stopping = false; let host: ProjectRuntime | undefined;
let main: Promise<void> = Promise.resolve(); let closing: Promise<void> | undefined;
let result: CommandResult | undefined; let timeout = 3000;
let execution: ReturnType<typeof executionSession> | undefined;
const lifetime = new AbortController();
const deliveries = new Set<Promise<void>>();
let deliveryFailed = false;
function send(message: WorkerMessage): void {
  if (!process.connected) return;
  const delivery = new Promise<void>((resolve, reject) => {
    process.send!(message, (error: Error | null) => error ? reject(error) : resolve());
  });
  deliveries.add(delivery);
  void delivery.then(() => deliveries.delete(delivery), () => {
    deliveries.delete(delivery); deliveryFailed = true;
    if (!stopping) void shutdown(1);
  });
}
async function flushDeliveries(): Promise<void> {
  // send() can enqueue beyond the IPC pipe capacity. Disconnect only after its callbacks settle.
  // This observes transport completion, not an application-level acknowledgement from the parent.
  while (deliveries.size) await Promise.allSettled([...deliveries]);
}
function report(error: unknown): void { send({ version: 1, type: 'error', error: wireError(error) }); }
function shutdown(code: number): Promise<void> {
  if (closing) return closing;
  stopping = true;
  // Abort listeners are synchronous and may request shutdown again. Publish the
  // single closing task before dispatch, not after entering plugin callbacks.
  closing = Promise.resolve().then(async () => {
    lifetime.abort(new CormiError('STOP_REQUESTED', 'Worker is stopping.'));
    // This is a failure-only last resort, never the normal success path.
    const watchdog = setTimeout(() => {
      report(new CormiError('CLEANUP_INCOMPLETE', 'Worker shutdown timed out.'));
      process.exit(1);
    }, timeout);
    try {
      await main.catch(() => {});
      await execution?.close();
    } catch (error) { code = 1; report(error); }
    try { await host?.dispose(); }
    catch (error) { code = 1; report(error); }
    if (!code && result?.kind === 'result') {
      try { JSON.stringify(result.data); send({ version: 1, type: 'result', data: result.data }); }
      catch (error) { code = 1; report(error); }
    }
    await flushDeliveries();
    if (deliveryFailed) code = 1;
    send({ version: 1, type: 'stopped', code });
    await flushDeliveries();
    process.exitCode = deliveryFailed ? 1 : code;
    clearTimeout(watchdog);
    if (process.connected) process.disconnect();
  });
  return closing;
}
async function run(message: StartMessage): Promise<void> {
  timeout = message.timeoutMs;
  verifyLease(message.root, message.token);
  // Consume the preflighted bytes, not a second on-disk read. No environment values are written to the config cache.
  const resolvedEnv = resolveEnvironment(message.environment, process.env, message.nodeEnv);
  for (const [key, value] of Object.entries(resolvedEnv.env)) process.env[key] = value;
  const module = await import(pathToFileURL(message.module).href);
  const environment = Object.freeze({ root: message.root, command: message.configurationCommand ?? message.command, mode: message.mode, env: resolvedEnv.env });
  const raw = typeof module.default === 'function' ? await module.default(environment) : module.default;
  lifetime.signal.throwIfAborted();
  const config = normalizeConfig(raw, message.root);
  send({ version: 1, type: 'watch', files: [...config.watch], fingerprint: await fingerprint(config.watch) });
  host = new ProjectRuntime(timeout, message.root);
  // Native execution composition owns application activation and observation policy.
  execution = executionSession(host, config, message.command, {
    root: message.root, positionals: Object.freeze([...(message.positionals ?? [])]), mode: message.mode, options: config.app, signal: lifetime.signal,
    publicEnv: resolvedEnv.publicEnv,
    configuration: Object.freeze({ command: environment.command, layers: config.layers, plugins: config.pluginSources, environment: resolvedEnv.summary }),
    serverOnlyFiles: [...message.serverOnlyFiles, ...config.watch],
  }, observation => send({ version: 1, ...observation }), error => {
    if (!stopping) { report(error); void shutdown(1); }
  });
  result = await execution.run();
  if (result.kind === 'server' && !stopping) {
    const status = result.handle.applicationStatus;
    send({ version: 1, type: 'ready', url: result.handle.url, ...(status ? { applicationStatus: status } : {}) });
  }
}
process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object' || (message as { version?: number }).version !== 1) return;
  if ((message as { type?: string }).type === 'stop') { void shutdown(0); return; }
  if ((message as { type?: string }).type !== 'start' || started || stopping) return;
  started = true;
  main = run(message as StartMessage);
  main.then(() => { if (result?.kind !== 'server' || stopping) void shutdown(0); }, error => {
    if (!stopping) report(error);
    void shutdown(stopping ? 0 : 1);
  });
});
process.once('disconnect', () => { void shutdown(0); });
process.once('SIGINT', () => { void shutdown(0); });
process.once('SIGTERM', () => { void shutdown(0); });
