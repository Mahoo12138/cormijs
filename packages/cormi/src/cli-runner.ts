import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { runCormi, type LaunchOptions } from './supervisor.js';
import { wireError } from './protocol.js';
import { bindLauncherControl } from './control.js';
import { renderDiagnosis, type Diagnosis } from './diagnose.js';

export interface CliOptions {
  readonly bootstrap?: LaunchOptions['bootstrap'];
  readonly signal?: AbortSignal;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}
/** Standard CLI policy for an explicit carrier. Importing it installs no listeners and executes no command. */
export async function runCormiCli(argv: readonly string[], options: CliOptions = {}): Promise<number> {
  const lifetime = new AbortController(), detach = bindLauncherControl(lifetime);
  const stdout = options.stdout ?? (text => { process.stdout.write(text); });
  const stderr = options.stderr ?? (text => { process.stderr.write(text); });
  const line = (value: unknown) => stdout(String(value) + '\n');
  let json = false;
  try {
    const parsed = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: {
      root: { type: 'string' }, mode: { type: 'string' }, json: { type: 'boolean' }, for: { type: 'string' },
      'no-watch': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      'startup-timeout': { type: 'string' }, 'shutdown-timeout': { type: 'string' },
    } });
    json = !!parsed.values.json;
    if (parsed.values.help || !parsed.positionals.length) {
      line('cormi <command> [args...] [--root path] [--mode name] [--no-watch] [--json]\nCommands are provided by plugins in cormi.config.ts. Web plugins provide dev/build/preview; the React preset also provides prepare/inspect/typecheck/config. Use config --for dev|build to explain current application inputs. The default worker profile handles diagnose --for dev|build without executing the target command.');
      return 0;
    }
    if (parsed.positionals.length > 33) throw new Error('Expected a command with at most 32 arguments');
    return await runCormi({ root: resolve(parsed.values.root ?? process.cwd()), command: parsed.positionals[0]!,
      positionals: parsed.positionals.slice(1),
      mode: parsed.values.mode, watch: parsed.values['no-watch'] ? false : undefined,
      signal: options.signal ? AbortSignal.any([lifetime.signal, options.signal]) : lifetime.signal,
      bootstrap: options.bootstrap, configurationCommand: parsed.values.for,
      startupTimeoutMs: parsed.values['startup-timeout'] === undefined ? undefined : Number(parsed.values['startup-timeout']),
      shutdownTimeoutMs: parsed.values['shutdown-timeout'] === undefined ? undefined : Number(parsed.values['shutdown-timeout']),
      onLog: (_stream, text) => stderr(text),
      onEvent: event => {
        if (json) line(JSON.stringify(event));
        else if (event.type === 'ready') line(event.applicationStatus === 'error'
          ? `cormi server listening: ${event.url} (application compilation failed; waiting for repair)` : `cormi ready: ${event.url}`);
        else if (event.type === 'diagnosis' || event.type === 'result' && (event.data as {format?:string})?.format === 'cormi:diagnosis:1') line(renderDiagnosis(event.data as Diagnosis));
        else if (event.type === 'error') stderr(`[cormi:${event.code}] ${event.message}\n`);
        else if (event.type === 'result') line(JSON.stringify(event.data, null, 2));
        else if (event.type === 'execution-report') line(JSON.stringify(event));
        else if (event.type === 'restarting') line('cormi: restarting worker');
      },
    });
  } catch (error) {
    const detail = wireError(error);
    if (json) line(JSON.stringify({ type: 'error', ...detail }));
    else stderr(`[cormi:${detail.code}] ${detail.message}\n`);
    return 1;
  } finally { detach(); }
}
