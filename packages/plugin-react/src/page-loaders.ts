import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CLIENT_LOADER_EXPORT = 'clientLoader';
export const SERVER_LOADER_EXPORT = 'serverLoader';

/**
 * Rewrites comments and string/template contents to spaces so the declaration scan cannot match them.
 * This is a lexer for that one purpose, not a TypeScript parser: it keeps newlines and code positions.
 */
export function stripCommentsAndStrings(source: string): string {
  const out: string[] = [];
  let index = 0, state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (index < source.length) {
    const char = source[index]!, next = source[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') { state = 'line'; out.push('  '); index += 2; continue; }
      if (char === '/' && next === '*') { state = 'block'; out.push('  '); index += 2; continue; }
      if (char === "'") { state = 'single'; out.push(' '); index++; continue; }
      if (char === '"') { state = 'double'; out.push(' '); index++; continue; }
      if (char === '`') { state = 'template'; out.push(' '); index++; continue; }
      out.push(char); index++; continue;
    }
    if (state === 'line') { if (char === '\n') { state = 'code'; out.push('\n'); } else out.push(' '); index++; continue; }
    if (state === 'block') {
      if (char === '*' && next === '/') { state = 'code'; out.push('  '); index += 2; continue; }
      out.push(char === '\n' ? '\n' : ' '); index++; continue;
    }
    // string and template bodies: keep newlines, hide contents, and honour escapes.
    if (char === '\\' && index + 1 < source.length) { out.push('  '); index += 2; continue; }
    if ((state === 'single' && char === "'") || (state === 'double' && char === '"') || (state === 'template' && char === '`')) {
      state = 'code'; out.push(' '); index++; continue;
    }
    out.push(char === '\n' ? '\n' : ' '); index++;
  }
  return out.join('');
}

const functionForm = (name: string) => new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${name}\\b`);
const constForm = (name: string) => new RegExp(`\\bexport\\s+(?:const|let|var)\\s+${name}\\s*=`);
const exportList = /\bexport\s+(type\s+)?\{([^}]*)\}/g;
const entryPattern = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/;

function exportsName(code: string, name: string): boolean {
  for (const match of code.matchAll(exportList)) {
    if (match[1]) continue;
    for (const raw of match[2]!.split(',')) {
      const entry = entryPattern.exec(raw.trim());
      if (!entry) continue;
      const exported = entry[2] ?? entry[1];
      if (exported === name) return true;
    }
  }
  return false;
}

function detectExport(source: string, name: string): string | undefined {
  const code = stripCommentsAndStrings(source);
  return functionForm(name).test(code) || constForm(name).test(code) || exportsName(code, name) ? name : undefined;
}

/** Direct declarations and value re-exports count; `declare`, type aliases and type-only exports never match. */
export function detectClientLoader(source: string): string | undefined {
  return detectExport(source, CLIENT_LOADER_EXPORT);
}

/** Detects the server-only loader export; the browser bundle never calls it. */
export function detectServerLoader(source: string): string | undefined {
  return detectExport(source, SERVER_LOADER_EXPORT);
}

export interface PageLoaderExports {
  readonly clientLoaders: Readonly<Record<string, string>>;
  readonly serverLoaders: Readonly<Record<string, string>>;
}

/** Reads page sources once and reports both loader conventions for files that declare them. */
export async function pageLoaderExports(root: string, files: readonly string[]): Promise<PageLoaderExports> {
  if (files.length > 512) throw new TypeError('ROUTE_CLIENT_LOADER_INVALID: too many page files to scan');
  const clientLoaders: Record<string, string> = {}, serverLoaders: Record<string, string> = {};
  for (const file of [...files].sort()) {
    const source = await readFile(join(root, file), 'utf8');
    if (source.length > 1024 * 1024) continue;
    if (detectClientLoader(source)) clientLoaders[file] = CLIENT_LOADER_EXPORT;
    if (detectServerLoader(source)) serverLoaders[file] = SERVER_LOADER_EXPORT;
  }
  return Object.freeze({ clientLoaders: Object.freeze(clientLoaders), serverLoaders: Object.freeze(serverLoaders) });
}

/** Reads conventional page sources and returns `file → exportName` for pages that export a client loader. */
export async function pageLoaders(root: string, files: readonly string[]): Promise<Readonly<Record<string, string>>> {
  return (await pageLoaderExports(root, files)).clientLoaders;
}

/** Reads conventional page sources and returns `file → exportName` for pages that export a server loader. */
export async function pageServerLoaders(root: string, files: readonly string[]): Promise<Readonly<Record<string, string>>> {
  return (await pageLoaderExports(root, files)).serverLoaders;
}
