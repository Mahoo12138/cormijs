import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CLIENT_LOADER_EXPORT = 'clientLoader';

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

const functionForm = /\bexport\s+(?:async\s+)?function\s+clientLoader\b/;
const constForm = /\bexport\s+(?:const|let|var)\s+clientLoader\s*=/;

/** Detects the three supported direct export forms; re-exports, `declare` and type aliases never match. */
export function detectClientLoader(source: string): string | undefined {
  const code = stripCommentsAndStrings(source);
  return functionForm.test(code) || constForm.test(code) ? CLIENT_LOADER_EXPORT : undefined;
}

/** Reads conventional page sources and returns `file → exportName` for pages that export a client loader. */
export async function pageLoaders(root: string, files: readonly string[]): Promise<Readonly<Record<string, string>>> {
  if (files.length > 512) throw new TypeError('ROUTE_CLIENT_LOADER_INVALID: too many page files to scan');
  const found: Record<string, string> = {};
  for (const file of [...files].sort()) {
    const source = await readFile(join(root, file), 'utf8');
    if (source.length > 1024 * 1024) continue;
    if (detectClientLoader(source)) found[file] = CLIENT_LOADER_EXPORT;
  }
  return Object.freeze(found);
}
