import { ProjectRuntime, CormiError, type CommandResult } from '@cormijs/core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { normalizeConfig } from './config.js';
import { commandPlugin } from './commands.js';
import { verifyLease } from './lock.js';
import { fingerprint } from './inputs.js';
import { wireError, type StartMessage, type WorkerMessage } from './protocol.js';

let started = false; let stopping = false; let host: ProjectRuntime | undefined;
let main: Promise<void> = Promise.resolve(); let closing: Promise<void> | undefined;
let result: CommandResult | undefined; let timeout = 3000;
const lifetime = new AbortController();
function send(message: WorkerMessage): void {
  if (process.connected) process.send?.(message, (error: Error | null) => { if (error && !stopping) void shutdown(1); });
}
function report(error: unknown): void { send({ version: 1, type: 'error', error: wireError(error) }); }
function shutdown(code: number): Promise<void> {
  if (closing) return closing;
  stopping = true; lifetime.abort(new CormiError('STOP_REQUESTED', 'Worker is stopping.'));
  // This is a failure-only last resort, never the normal success path.
  const watchdog = setTimeout(() => {
    report(new CormiError('CLEANUP_INCOMPLETE', 'Worker shutdown timed out.'));
    process.exit(1);
  }, timeout);
  closing = (async () => {
    try {
      await main.catch(() => {});
      if (result?.kind === 'server') await result.handle.close();
    } catch (error) { code = 1; report(error); }
    try { await host?.dispose(); }
    catch (error) { code = 1; report(error); }
    if (!code && result?.kind === 'result') {
      try { JSON.stringify(result.data); send({ version: 1, type: 'result', data: result.data }); }
      catch (error) { code = 1; report(error); }
    }
    send({ version: 1, type: 'stopped', code });
    process.exitCode = code;
    clearTimeout(watchdog);
    if (process.connected) process.disconnect();
  })();
  return closing;
}
async function run(message: StartMessage): Promise<void> {
  timeout = message.timeoutMs;
  verifyLease(message.root, message.token);
  // Environment is loaded in this fresh process only. Existing inherited values win.
  const envFile = join(message.root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const module = await import(pathToFileURL(message.module).href);
  const environment = Object.freeze({ root: message.root, command: message.command, mode: message.mode });
  const raw = typeof module.default === 'function' ? await module.default(environment) : module.default;
  lifetime.signal.throwIfAborted();
  const config = normalizeConfig(raw, message.root);
  send({ version: 1, type: 'watch', files: [...config.watch], fingerprint: await fingerprint(config.watch) });
  host = new ProjectRuntime(timeout);
  host.mount('cormi:commands', commandPlugin);
  for (const entry of config.plugins) host.mount(entry.id, entry.plugin, entry.options);
  await host.ready(); lifetime.signal.throwIfAborted();
  result = await host.ctx.commands.execute(message.command, {
    root: message.root, mode: message.mode, options: config.app, signal: lifetime.signal,
    serverOnlyFiles: [...message.serverOnlyFiles, ...config.watch],
  });
  if (!result || !['result', 'server'].includes(result.kind)) throw new CormiError('COMMAND_RESULT_INVALID', 'Command returned an invalid result.');
  if (result.kind === 'server') {
    if (!result.handle || typeof result.handle.close !== 'function' || typeof result.handle.url !== 'string') throw new CormiError('COMMAND_RESULT_INVALID', 'Invalid server handle.');
    const status = result.handle.applicationStatus;
    if (status !== undefined && status !== 'ready' && status !== 'error') throw new CormiError('COMMAND_RESULT_INVALID', 'Invalid application status.');
    if (!stopping) send({ version: 1, type: 'ready', url: result.handle.url, ...(status ? { applicationStatus: status } : {}) });
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
