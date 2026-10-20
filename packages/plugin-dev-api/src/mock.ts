import { CormiError, type Plugin } from '@cormijs/core';
import { build } from 'esbuild';
import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { MockRule } from './index.js';
import type {} from './service.js';

export interface MockPluginOptions {
  readonly id?: string;
  readonly dir?: string;
  readonly files?: readonly string[];
  readonly prefix?: string;
  readonly intervalMs?: number;
}
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const runtime = (file: string) => /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.[cm]?[jt]sx?$/.test(file);
const clean = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\0\r\n\\]/.test(value) || isAbsolute(value)) throw new CormiError('MOCK_INVALID', `Invalid mock ${field}.`);
  return value;
};

function optionsOf(input: unknown): Required<Omit<MockPluginOptions, 'files'>> & { files?: readonly string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CormiError('MOCK_INVALID', 'Invalid mock plugin options.');
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some(key => !['id', 'dir', 'files', 'prefix', 'intervalMs'].includes(key))) throw new CormiError('MOCK_INVALID', 'Unknown mock plugin option.');
  const id = row.id ?? 'cormi:mock';
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('MOCK_INVALID', 'Invalid mock plugin id.');
  const prefix = row.prefix ?? '/api';
  if (typeof prefix !== 'string' || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(prefix)) throw new CormiError('MOCK_INVALID', 'Invalid mock API prefix.');
  const intervalMs = row.intervalMs ?? 200;
  if (!Number.isInteger(intervalMs) || (intervalMs as number) < 50 || (intervalMs as number) > 5000) throw new CormiError('MOCK_INVALID', 'Invalid mock reload interval.');
  if (row.files !== undefined) {
    if (!Array.isArray(row.files) || !row.files.length || row.files.length > 256 || row.files.some(file => typeof file !== 'string' || !runtime(file))) throw new CormiError('MOCK_INVALID', 'Mock files must be runtime source files.');
    return { id, dir: 'mock', prefix, intervalMs: intervalMs as number, files: Object.freeze((row.files as string[]).map(file => clean(file, 'file'))) };
  }
  return { id, dir: clean(row.dir ?? 'mock', 'directory'), prefix, intervalMs: intervalMs as number };
}

async function collect(root: string, directory: string, out: string[], depth: number): Promise<void> {
  if (depth > 32) throw new CormiError('MOCK_INVALID', 'Mock directory exceeds the supported depth.');
  const absolute = resolve(root, directory);
  const local = relative(root, absolute);
  if (!local || local === '..' || local.startsWith('..' + sep) || isAbsolute(local) || local.split(sep).some(part => part.startsWith('.'))) throw new CormiError('MOCK_INVALID', 'Mock directory must be inside the project.');
  let info;
  try { info = await lstat(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new CormiError('MOCK_INVALID', 'Mock directory must be a real directory.');
  for (const name of (await readdir(absolute)).sort()) {
    if (name.startsWith('.') || /\.(test|spec)\./.test(name)) continue;
    const file = join(directory, name), info = await lstat(join(absolute, name));
    if (info.isSymbolicLink()) throw new CormiError('MOCK_INVALID', 'Mock files cannot be symbolic links.', { file });
    if (info.isDirectory()) await collect(root, file, out, depth + 1);
    else if (info.isFile() && runtime(name)) out.push(file.split(sep).join('/'));
  }
}

async function filesOf(root: string, options: ReturnType<typeof optionsOf>): Promise<string[]> {
  if (options.files) return [...options.files].sort();
  const files: string[] = []; await collect(root, options.dir, files, 0); return files.sort();
}

async function signature(root: string, files: readonly string[]): Promise<string> {
  const parts: unknown[] = [files];
  for (const file of files) {
    try { const info = await lstat(resolve(root, file)); parts.push([file, info.mtimeMs, info.size]); }
    catch (error) { parts.push([file, (error as NodeJS.ErrnoException).code]); }
  }
  return JSON.stringify(parts);
}

function rulesOf(file: string, value: unknown, prefix: string): MockRule[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CormiError('MOCK_INVALID', `Mock module must default-export an object: ${file}`);
  const rules: MockRule[] = [];
  for (const [key, response] of Object.entries(value as Record<string, unknown>)) {
    const match = /^([A-Z]+)\s+(\/[^\s?#]*)$/.exec(key);
    if (!match || !methods.has(match[1]!)) throw new CormiError('MOCK_INVALID', `Invalid mock key: ${key}`, { file });
    let path = match[2]!;
    if (path === prefix) path = '/'; else if (path.startsWith(prefix + '/')) path = path.slice(prefix.length);
    if (!path.startsWith('/') || path.length > 512 || path.includes('//')) throw new CormiError('MOCK_INVALID', `Invalid mock path: ${key}`, { file });
    if (typeof response === 'function') rules.push({ method: match[1]!, path, handle: async request => (response as (request: unknown) => unknown)(request) as never });
    else if (response && typeof response === 'object') rules.push({ method: match[1]!, path, handle: async () => response as never });
    else throw new CormiError('MOCK_INVALID', `Mock response must be an object or function: ${key}`, { file });
  }
  return rules;
}

async function loadFile(root: string, file: string, prefix: string): Promise<MockRule[]> {
  const absolute = resolve(root, file);
  let code: string;
  try {
    const result = await build({ absWorkingDir: root, entryPoints: [absolute], bundle: true, platform: 'node', format: 'esm',
      target: 'node22', write: false, logLevel: 'silent', sourcemap: false, metafile: false });
    code = result.outputFiles?.[0]?.text ?? '';
  } catch (error) {
    throw new CormiError('MOCK_COMPILE_FAILED', `Mock module failed to compile: ${file}`, { file }, { cause: error });
  }
  if (!code || Buffer.byteLength(code) > 2 * 1024 * 1024) throw new CormiError('MOCK_INVALID', `Mock module is empty or too large: ${file}`, { file });
  let module: { default?: unknown };
  const encoded = Buffer.from(code).toString('base64');
  try { module = await import(['data', 'text/javascript;base64,' + encoded].join(':')); }
  catch (error) { throw new CormiError('MOCK_EVALUATION_FAILED', `Mock module failed to evaluate: ${file}`, { file }, { cause: error }); }
  return rulesOf(file, module.default, prefix);
}

/** Opt-in Umi-style mock files: each default export maps "METHOD /api/path" to a response or handler. */
export const mockPlugin: Plugin.Object<MockPluginOptions> = {
  name: 'cormi:mock', inject: ['devApi', 'projectRoot'],
  async apply(ctx, input = {}) {
    const options = optionsOf(input), root = ctx.projectRoot.root;
    let registration: (() => Promise<void>) | undefined, previousRules: readonly MockRule[] = [], signatureText = '', reloading = false;
    const load = async () => {
      const files = await filesOf(root, options), nextSignature = await signature(root, files);
      if (nextSignature === signatureText) return;
      const rules: MockRule[] = [];
      for (const file of files) rules.push(...await loadFile(root, file, options.prefix));
      const dispose = registration;
      await dispose?.();
      try {
        const next = rules.length ? ctx.devApi.add(options.id + ':rules', { mocks: rules }) : undefined;
        registration = next; previousRules = rules; signatureText = nextSignature;
      } catch (error) {
        if (previousRules.length) registration = ctx.devApi.add(options.id + ':rules', { mocks: previousRules });
        throw error;
      }
    };
    await load();
    ctx.effect(() => () => { clearInterval(timer); return registration?.(); });
    const timer = setInterval(() => {
      if (reloading) return;
      reloading = true;
      void load().catch(error => console.error('[cormi:mock]', error)).finally(() => { reloading = false; });
    }, options.intervalMs);
    timer.unref?.();
  },
};
