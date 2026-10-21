import { CormiError, type Plugin } from '@cormijs/core';
import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type {} from './index.js';

export interface ToolSpec {
  /** Binary name resolved from the project `node_modules/.bin`; never a path or shell command. */
  readonly bin?: string;
  /** Default arguments placed before caller positionals. */
  readonly args?: readonly string[];
}
export interface ToolPluginOptions {
  readonly id?: string;
  readonly lint?: ToolSpec;
  readonly format?: ToolSpec;
}
const binPattern = /^[a-z][a-z0-9-]{0,63}$/;
const argPattern = /^[A-Za-z0-9_@./:=+-][A-Za-z0-9_@./:=+ -]{0,255}$/;

function spec(input: unknown, fallback: { bin: string; args: readonly string[] }): Required<ToolSpec> {
  if (input === undefined) return { bin: fallback.bin, args: fallback.args };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CormiError('TOOL_INVALID', 'Tool entries must be objects.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['bin', 'args'].includes(key))) throw new CormiError('TOOL_INVALID', 'Unknown tool option.');
  const bin = value.bin ?? fallback.bin, args = value.args ?? fallback.args;
  if (typeof bin !== 'string' || !binPattern.test(bin)) throw new CormiError('TOOL_INVALID', 'Tool bin must be a bare executable name.', { bin });
  if (!Array.isArray(args) || args.length > 32 || args.some(arg => typeof arg !== 'string' || !argPattern.test(arg))) {
    throw new CormiError('TOOL_INVALID', 'Tool defaults must be at most 32 plain argument strings.');
  }
  return { bin, args: Object.freeze([...args as string[]]) };
}

/** Runs a project tool without a shell; output is forwarded to stderr so the CLI protocol stays intact. */
export async function runTool(root: string, tool: Required<ToolSpec>, extra: readonly string[], signal: AbortSignal): Promise<{ code: number; bin: string }> {
  const path = join(root, 'node_modules', '.bin', tool.bin);
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    throw error.code === 'ENOENT' ? new CormiError('TOOL_MISSING', `The project does not install ${tool.bin}.`, { bin: tool.bin }) : error;
  });
  if (!info.isFile() && !info.isSymbolicLink()) throw new CormiError('TOOL_MISSING', 'Tool executables must be files in node_modules/.bin.', { bin: tool.bin });
  const args = [...tool.args, ...extra];
  signal.throwIfAborted();
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(path, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const abort = () => child.kill('SIGTERM');
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => process.stderr.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(new CormiError('TOOL_FAILED', `Could not start ${tool.bin}.`, { bin: tool.bin }, { cause: error })); });
    child.once('close', (exit, exitSignal) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(new CormiError('TOOL_CANCELLED', 'The tool run was cancelled.', { bin: tool.bin }));
      else if (exit === null) reject(new CormiError('TOOL_FAILED', `Tool terminated by ${exitSignal}.`, { bin: tool.bin }));
      else resolve(exit);
    });
  });
  if (code !== 0) throw new CormiError('TOOL_FAILED', `${tool.bin} exited with code ${code}.`, { bin: tool.bin, code });
  return { code, bin: tool.bin };
}

/** Opt-in plugin: `cormi lint`/`cormi format` run the project's own eslint/prettier binaries. */
export const toolPlugin: Plugin.Object<ToolPluginOptions> = {
  name: 'cormi:tools', inject: ['commands', 'projectRoot'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'lint', 'format'].includes(key))) {
      throw new CormiError('TOOL_INVALID', 'Invalid tool plugin options.');
    }
    const id = options.id ?? 'cormi:tools';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('TOOL_INVALID', 'Invalid tool plugin id.');
    const lint = spec(options.lint, { bin: 'eslint', args: ['.'] });
    const format = spec(options.format, { bin: 'prettier', args: ['--write', '.'] });
    const run = (label: string, tool: Required<ToolSpec>) => async (request: Parameters<Parameters<typeof ctx.commands.register>[1]>[0]) => {
      request.signal.throwIfAborted();
      const result = await runTool(ctx.projectRoot.root, tool, request.positionals ?? [], request.signal);
      return { kind: 'result' as const, data: Object.freeze({ tool: label, bin: result.bin, exitCode: result.code }) };
    };
    ctx.effect(() => ctx.commands.register('lint', run('lint', lint)));
    ctx.effect(() => ctx.commands.register('format', run('format', format)));
  },
};
