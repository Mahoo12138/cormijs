import { CormiError } from '@cormijs/core';
import type { DevelopmentDiagnostic } from '@cormijs/builder';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { lstat } from 'node:fs/promises';

const messages: Readonly<Record<string, string>> = {
  APP_RUNTIME_CONFLICT: 'More than one application runtime module was found. Keep one app file or disable a conflicting contribution.',
  APP_RUNTIME_INVALID: 'Application runtime contributions are invalid.',
  APP_RUNTIME_KEY_CONFLICT: 'Application runtime keys must be unique and cannot replace built-in hooks.',
  LAYOUT_INVALID: 'A global layout contribution is invalid.',
  LAYOUT_CONFLICT: 'More than one global layout module is active. Keep one layout file or disable a conflicting contribution.',
  LOADING_INVALID: 'A loading contribution is invalid.',
  LOADING_CONFLICT: 'More than one loading component is active. Keep one loading file or disable a conflicting contribution.',
  ROUTE_LAYOUT_INVALID: 'Route layout options only support false.',
  ROUTE_CONFLICT: 'Two routes resolve to the same URL. Rename or remove one of the conflicting pages.',
  ROUTE_ID_CONFLICT: 'Route identifiers must be unique and cannot use reserved identifiers.',
  ROUTE_PARENT_MISSING: 'A route refers to a missing parent.',
  ROUTE_PARENT_CYCLE: 'Route parents contain a cycle or exceed the supported depth.',
  ROUTE_PATH_INVALID: 'A page filename or route path does not follow the supported convention.',
  ROUTE_INVALID: 'The route configuration does not satisfy the route contract.',
  ROUTE_META_INVALID: 'Route metadata must be bounded public JSON data.',
  ROUTE_MODULE_INVALID: 'A route module reference is invalid.',
  ROUTE_SYMLINK: 'Page directories cannot contain symbolic links.',
  ROUTE_LIMIT: 'The page tree exceeds the supported size or depth.',
  HOOK_FAILED: 'A compilation hook failed. See the terminal for the original error.',
  HOOK_RETURN_INVALID: 'A compilation hook returned an invalid value.',
  HOOK_ORDER_CYCLE: 'Compilation hook ordering contains a cycle.',
  HOOK_TARGET_MISSING: 'A compilation hook refers to a missing ordering target.',
  CONTRIBUTIONS_CHANGED: 'Plugin contributions changed during compilation. Waiting for the latest input.',
  CLIENT_MODULE_INVALID: 'A browser module is missing, private, or outside the allowed project boundary.',
  CLIENT_SERVER_IMPORT: 'A browser module references the Node toolchain.',
  RUNTIME_INVALID: 'Runtime module contributions are invalid.',
  RUNTIME_ID_CONFLICT: 'Runtime identifiers must be unique.',
  RUNTIME_OPTIONS_INVALID: 'Runtime options must be finite JSON data.',
  ENOENT: 'A required application module is missing. Create it or fix the reference.',
};
export function recoverable(error: unknown): boolean {
  return error instanceof Error && Object.hasOwn(messages, (error as NodeJS.ErrnoException).code ?? '');
}
/** Never serialize cause, stack, source code, private options, or arbitrary exception messages. */
export function developmentDiagnostic(error: unknown, phase: string, root: string): DevelopmentDiagnostic {
  const code = error instanceof Error && Object.hasOwn(messages, (error as NodeJS.ErrnoException).code ?? '')
    ? (error as NodeJS.ErrnoException).code! : 'COMPILATION_FAILED';
  const details = error instanceof CormiError ? error.details : {};
  const clean = (value: unknown) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 240) : undefined;
  const files: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const local = relative(root, resolve(root, value)).split(sep).join('/');
    if (!local || isAbsolute(local) || local === '..' || local.startsWith('../') || local.split('/').some(p => p.startsWith('.'))) return;
    const safe = clean(local); if (safe && !files.includes(safe)) files.push(safe);
  };
  add(details.file);
  for (const key of ['first', 'second']) {
    const source = details[key]; if (source && typeof source === 'object') add((source as { file?: unknown }).file);
  }
  if (error instanceof Error) add((error as NodeJS.ErrnoException).path);
  return Object.freeze({ code, phase, message: messages[code] ?? 'Application generation failed. See the terminal for details.',
    files: Object.freeze(files.slice(0, 8)),
    ...(clean(details.pluginId) ? { pluginId: clean(details.pluginId) } : {}),
    ...(clean(details.hookId) ? { hookId: clean(details.hookId) } : {}) });
}
/** Metadata only; no file contents or symlink targets are read to detect repair. */
export async function repairSignature(root: string, files: readonly string[], anchoredFiles: ReadonlySet<string> = new Set()): Promise<string> {
  const result: unknown[] = [];
  for (const file of [...new Set(files)].sort()) {
    const path = resolve(root, file), local = relative(root, path);
    if (!anchoredFiles.has(file) && (isAbsolute(file) || !local || local === '..' || local.startsWith(`..${sep}`))) continue;
    try { const s = await lstat(path); result.push([file, s.dev, s.ino, s.size, s.mtimeMs, s.isSymbolicLink()]); }
    catch (error) { result.push([file, (error as NodeJS.ErrnoException).code]); }
  }
  return JSON.stringify(result);
}
