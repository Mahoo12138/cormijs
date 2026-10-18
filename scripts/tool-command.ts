import assert from 'node:assert/strict';
import { isAbsolute, basename } from 'node:path';
import { statSync } from 'node:fs';

export interface LiteralCommand { executable: string; args: string[] }
/** Native argv, never a shell command; metacharacters remain data. */
export function nodeScriptCommand(entry: string, args: readonly string[], node = process.execPath): LiteralCommand {
  for (const value of [node, entry, ...args]) assert.ok(typeof value === 'string' && !value.includes('\0'), 'Invalid command argument');
  assert.ok(isAbsolute(node) && isAbsolute(entry), 'Node executable and script must be absolute paths');
  return { executable: node, args: [entry, ...args] };
}
export function pnpmCommand(args: readonly string[], env: NodeJS.ProcessEnv = process.env): LiteralCommand {
  // pnpm run exposes its actual JS entry; callers outside pnpm can provide it explicitly.
  const entry = env.CORMI_PNPM_CLI ?? env.npm_execpath;
  if (env.CORMI_PNPM_CLI !== undefined) assert.ok(entry && isAbsolute(entry) && /^(?:pnpm|pnpm-entry)\.(?:c?js|mjs)$/.test(basename(entry)), 'CORMI_PNPM_CLI must identify an absolute pnpm JS entry, not a .cmd shim');
  if (entry && isAbsolute(entry) && /^(?:pnpm|pnpm-entry)\.(?:c?js|mjs)$/.test(basename(entry))) {
    assert.ok(statSync(entry).isFile(), 'pnpm JS entry must be a file');
    return nodeScriptCommand(entry, args);
  }
  assert.notEqual(process.platform, 'win32', 'Windows automation requires an absolute CORMI_PNPM_CLI JS entry or invocation through pnpm run; no implicit .cmd shell fallback');
  return { executable: 'pnpm', args: [...args] };
}
