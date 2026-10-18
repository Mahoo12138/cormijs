#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { runCormi } from './supervisor.js';
import { wireError } from './protocol.js';
import { bindLauncherControl } from './control.js';

const lifetime = new AbortController();
const detachControl = bindLauncherControl(lifetime);
let json = false;
try {
  const parsed = parseArgs({ allowPositionals: true, strict: true, options: {
    root: { type: 'string' }, mode: { type: 'string' }, json: { type: 'boolean' }, for: { type: 'string' },
    'no-watch': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    'startup-timeout': { type: 'string' }, 'shutdown-timeout': { type: 'string' },
  } });
  json = !!parsed.values.json;
  if (parsed.values.help || !parsed.positionals.length) {
    console.log('cormi <command> [--root path] [--mode name] [--no-watch] [--json]\nCommands are provided by plugins in cormi.config.ts. Web plugins provide dev/build/preview; the React preset also provides prepare/inspect/typecheck/config. Use config --for dev|build to explain current application inputs without executing that command.');
  } else {
    if (parsed.positionals.length !== 1) throw new Error('Expected exactly one command');
    process.exitCode = await runCormi({ root: resolve(parsed.values.root ?? process.cwd()), command: parsed.positionals[0]!,
      mode: parsed.values.mode, watch: parsed.values['no-watch'] ? false : undefined, signal: lifetime.signal,
      configurationCommand: parsed.values.for,
      startupTimeoutMs: parsed.values['startup-timeout'] === undefined ? undefined : Number(parsed.values['startup-timeout']),
      shutdownTimeoutMs: parsed.values['shutdown-timeout'] === undefined ? undefined : Number(parsed.values['shutdown-timeout']),
      onLog: (_stream, text) => process.stderr.write(text),
      onEvent: event => {
        if (json) console.log(JSON.stringify(event));
        else if (event.type === 'ready') console.log(event.applicationStatus === 'error'
          ? `cormi server listening: ${event.url} (application compilation failed; waiting for repair)`
          : `cormi ready: ${event.url}`);
        else if (event.type === 'error') console.error(`[cormi:${event.code}] ${event.message}`);
        else if (event.type === 'result') console.log(JSON.stringify(event.data, null, 2));
        else if (event.type === 'restarting') console.log('cormi: restarting worker');
      },
    });
  }
} catch (error) {
  const detail = wireError(error);
  if (json) console.log(JSON.stringify({ type: 'error', ...detail }));
  else console.error(`[cormi:${detail.code}] ${detail.message}`);
  process.exitCode = 1;
} finally {
  detachControl();
  // A forked CLI must not stay alive merely because its optional parent channel remains open.
  if (process.connected) process.disconnect();
}
