import { fork, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, lstat, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CormiError, deadline } from '@cormijs/core';
import { acquireProject } from './lock.js';
import { compileConfig, fingerprint, ConfigCompileError } from './compiler.js';
import { projectFile } from './config.js';
import { wireError, type StartMessage, type WorkerMessage, type WireError } from './protocol.js';

export interface LauncherEvent { readonly type: string; readonly [key: string]: unknown }
export interface LaunchOptions {
  readonly root: string; readonly command: string; readonly mode?: string; readonly watch?: boolean;
  readonly signal?: AbortSignal; readonly startupTimeoutMs?: number; readonly shutdownTimeoutMs?: number;
  readonly pollIntervalMs?: number; readonly onEvent?: (event: LauncherEvent) => void;
  readonly onLog?: (stream: 'stdout' | 'stderr', text: string) => void;
}
interface Exit { code: number | null; signal: NodeJS.Signals | null }
function remoteError(error: WireError): CormiError {
  return new CormiError(error.code, error.message, {}, error.cause ? { cause: remoteError(error.cause) } : undefined);
}
function cancellable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new CormiError('STOP_REQUESTED', 'Launcher stopped.'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new CormiError('STOP_REQUESTED', 'Launcher stopped.'));
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function startWorker(start: StartMessage, options: LaunchOptions, watch: (files: string[], fingerprint: string) => void) {
  let resolveFirst!: (value: Extract<WorkerMessage, { type: 'ready' | 'result' }>) => void;
  let rejectFirst!: (error: unknown) => void;
  const first = new Promise<Extract<WorkerMessage, { type: 'ready' | 'result' }>>((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
  let exited = false; let failure: CormiError | undefined;
  const child: ChildProcess = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [], {
    cwd: start.root, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: start.command === 'dev' ? 'development' : 'production' },
  });
  child.stdout?.on('data', chunk => options.onLog?.('stdout', String(chunk)));
  child.stderr?.on('data', chunk => options.onLog?.('stderr', String(chunk)));
  const done = new Promise<Exit>(resolve => {
    child.once('close', (code, signal) => {
      exited = true; resolve({ code, signal });
      rejectFirst(failure ?? new CormiError('WORKER_EXITED', `Worker exited before readiness (${code ?? signal}).`));
    });
  });
  child.on('error', error => { failure = new CormiError('WORKER_PROCESS_ERROR', error.message, {}, { cause: error }); rejectFirst(failure); });
  child.on('message', (value: unknown) => {
    if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return;
    const message = value as WorkerMessage;
    if (message.type === 'error') { failure = remoteError(message.error); rejectFirst(failure); }
    else if (message.type === 'ready' || message.type === 'result') resolveFirst(message);
    else if (message.type === 'watch') watch(message.files, message.fingerprint);
  });
  child.send(start, error => { if (error) rejectFirst(error); });
  let stopping: Promise<Exit> | undefined;
  return {
    pid: child.pid, first, done, get exited() { return exited; }, get failure() { return failure; },
    stop(ms: number): Promise<Exit> {
      if (stopping) return stopping;
      stopping = (async () => {
        if (!exited && child.connected) child.send({ version: 1, type: 'stop' }, () => {});
        try { return await deadline(done, ms, new CormiError('WORKER_STOP_TIMEOUT', 'Worker did not exit in time.')); }
        catch (error) {
          // Target only this still-running owned child; never search/kill by process name.
          if (!exited && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          await deadline(done, 2000, new CormiError('CLEANUP_INCOMPLETE', 'Owned worker termination could not be confirmed.'));
          throw error;
        }
      })();
      return stopping;
    },
  };
}

/** Process orchestration, not Web policy. Commands are supplied by configured plugins. */
export async function runCormi(options: LaunchOptions): Promise<number> {
  const startup = options.startupTimeoutMs ?? 10000, shutdown = options.shutdownTimeoutMs ?? 5000;
  const interval = options.pollIntervalMs ?? 200;
  for (const value of [startup, shutdown, interval]) if (!Number.isFinite(value) || value < 20 || value > 120000) throw new RangeError('Invalid launcher timeout/interval');
  if (!/^[a-z][a-z0-9-]*$/.test(options.command)) throw new CormiError('COMMAND_INVALID', 'Invalid command name.');
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted) return 0;
  const emit = (event: LauncherEvent) => options.onEvent?.(event);
  const lease = acquireProject(options.root); const root = lease.root;
  const cache = join(root, '.cormi'); const watching = options.watch ?? options.command === 'dev';
  let active: ReturnType<typeof startWorker> | undefined; let activeDirectory: string | undefined;
  let files: string[] = [join(root, 'cormi.config.ts')]; let previous: string | undefined;
  let extra: string[] = []; let extraStamp = ''; let generation = 0; let exitCode = 0;
  const inputStamp = async () => `${await fingerprint(files)}:${await fingerprint(extra)}`;
  async function stopActive(): Promise<void> {
    try {
      if (active) {
        const old = active;
        try {
          const result = await old.stop(shutdown);
          if (result.code !== 0 || result.signal || old.failure) throw old.failure ?? new CormiError('WORKER_FAILED', `Worker exited with ${result.code ?? result.signal}`);
        } finally { if (old.exited) active = undefined; }
      }
    } finally {
      if (!active && activeDirectory) { await rm(activeDirectory, { recursive: true, force: true }); activeDirectory = undefined; }
    }
  }
  try {
    try { await mkdir(cache, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const state = await lstat(cache);
    if (!state.isDirectory() || state.isSymbolicLink()) throw new CormiError('CACHE_PATH_INVALID', '.cormi must be a real directory.');
    while (!signal.aborted) {
      const current = await inputStamp();
      if (previous === undefined || (watching && current !== previous)) {
        let compiled;
        try {
          compiled = await compileConfig(root); files = [...compiled.files];
          if (signal.aborted) break;
        } catch (error) {
          if (error instanceof ConfigCompileError) files = [...new Set([...files, ...error.files])];
          previous = await inputStamp();
          emit({ type: 'error', ...wireError(error), servingPrevious: !!active && !active.exited });
          if (!watching) { exitCode = 1; break; }
          await delay(interval, undefined, { signal }).catch(() => {}); continue;
        }
        if (await fingerprint(compiled.files) !== compiled.fingerprint) { previous = undefined; continue; }
        if (active) emit({ type: 'restarting', generation: generation + 1, previousPid: active.pid });
        // Compilation succeeds before the old worker is stopped. Runtime validation still occurs in the new worker.
        await stopActive();
        if (signal.aborted) break;
        activeDirectory = await mkdtemp(join(cache, 'run-'));
        const module = join(activeDirectory, 'config.mjs');
        await writeFile(module, compiled.code, { flag: 'wx', mode: 0o600 });
        extra = []; extraStamp = await fingerprint(extra); generation++;
        active = startWorker({ version: 1, type: 'start', root, token: lease.token, module,
          command: options.command, mode: options.mode ?? (options.command === 'dev' ? 'development' : 'production'), timeoutMs: shutdown, serverOnlyFiles: compiled.files }, options,
          (values, stamp) => { extra = values.map(file => projectFile(root, file)); extraStamp = stamp; });
        emit({ type: 'starting', generation, pid: active.pid });
        try {
          const first = await cancellable(deadline(active.first, startup, new CormiError('WORKER_START_TIMEOUT', 'Worker startup/command exceeded its deadline.')), signal);
          emit({ type: first.type, generation, pid: active.pid, ...(first.type === 'ready' ? { url: first.url } : { data: first.data }) });
          if (first.type === 'result') { await stopActive(); break; }
        } catch (error) {
          if (!signal.aborted) emit({ type: 'error', ...wireError(error), generation, servingPrevious: false });
          try { await stopActive(); } catch (cleanup) {
            emit({ type: 'error', ...wireError(cleanup), generation });
            if (signal.aborted) exitCode = 1;
            if (active && !active.exited) throw cleanup;
            active = undefined;
            if (activeDirectory) { await rm(activeDirectory, { recursive: true, force: true }); activeDirectory = undefined; }
          }
          if (!watching && !signal.aborted) { exitCode = 1; break; }
        }
        // Never observe a new on-disk baseline after ready: that can swallow an edit received at readiness.
        previous = `${compiled.fingerprint}:${extraStamp}`;
        if (watching) emit({ type: 'watching', generation });
      }
      if (active?.exited) {
        const problem = active.failure ?? new CormiError('WORKER_EXITED', 'The serving worker exited unexpectedly.');
        emit({ type: 'error', ...wireError(problem), servingPrevious: false });
        active = undefined;
        if (activeDirectory) { await rm(activeDirectory, { recursive: true, force: true }); activeDirectory = undefined; }
        if (!watching) { exitCode = 1; break; }
      }
      await delay(interval, undefined, { signal }).catch(() => {});
    }
  } finally {
    try { await stopActive(); }
    catch (error) { exitCode = 1; emit({ type: 'error', ...wireError(error) }); }
    // Fail closed if termination is unknown: retain the lock rather than admit another writer.
    if (!active || active.exited) lease.release();
    else throw new CormiError('CLEANUP_INCOMPLETE', 'Worker termination unconfirmed; project lock retained.');
    emit({ type: 'stopped', code: exitCode });
  }
  return exitCode;
}
