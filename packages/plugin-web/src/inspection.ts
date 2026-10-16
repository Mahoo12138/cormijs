import { CormiError, type Plugin } from '@cormijs/core';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED_HEADER } from './generation.js';

export interface GeneratedInspection {
  readonly format: 'cormi:generation:1';
  readonly generation: string;
  readonly files: Readonly<Record<'app.tsx' | 'routes.d.ts', string>>;
  readonly summary: unknown;
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export function inspectionManifest(code: string, types: string, summary: unknown): GeneratedInspection {
  const files = { 'app.tsx': digest(GENERATED_HEADER + code), 'routes.d.ts': digest(GENERATED_HEADER + types) };
  return { format: 'cormi:generation:1', generation: digest(JSON.stringify({ files, summary })), files, summary };
}
function readOwned(file: string): string {
  const state = lstatSync(file);
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || state.size > 8 * 1024 ** 2) throw new CormiError('GENERATED_PATH_INVALID', 'Inspection requires bounded regular generated files.');
  const data = readFileSync(file, 'utf8');
  if (!data.startsWith(GENERATED_HEADER)) throw new CormiError('GENERATED_NOT_OWNED', 'Generated file lacks its ownership header.');
  return data;
}
/** Snapshot read only: never scans routes, evaluates pages, or silently repairs mismatching files. */
export function readInspection(root: string): GeneratedInspection {
  const directory = join(realpathSync(root), '.cormi');
  try {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new CormiError('GENERATED_PATH_INVALID', '.cormi is not a real directory.');
    const raw = readOwned(join(directory, 'inspect.jsonc'));
    const result = JSON.parse(raw.slice(GENERATED_HEADER.length)) as GeneratedInspection;
    if (!result || result.format !== 'cormi:generation:1' || typeof result.generation !== 'string'
      || !result.files || Object.keys(result.files).sort().join(',') !== 'app.tsx,routes.d.ts') throw new CormiError('INSPECT_INVALID', 'Unsupported generation manifest.');
    for (const name of ['app.tsx', 'routes.d.ts'] as const) {
      if (digest(readOwned(join(directory, name))) !== result.files[name]) throw new CormiError('GENERATED_SET_INCONSISTENT', `Generated file does not match the last committed manifest: ${name}. Run prepare to repair.`);
    }
    if (digest(JSON.stringify({ files: result.files, summary: result.summary })) !== result.generation) throw new CormiError('INSPECT_INVALID', 'Generation manifest digest does not match.');
    return result;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw new CormiError('INSPECT_MISSING', 'No complete generated snapshot exists; run cormi prepare first.', {}, { cause });
    throw cause;
  }
}
export const inspectionPlugin: Plugin.Object<void> = {
  name: 'cormi:inspect', inject: ['commands'],
  apply: ctx => {
    ctx.effect(() => ctx.commands.register('inspect', async request => {
      request.signal.throwIfAborted();
      return { kind: 'result', data: { basis: 'last-successful-generation', freshness: 'source-not-reevaluated', ...readInspection(request.root) } };
    }));
  },
};
