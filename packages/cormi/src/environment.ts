import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseEnv } from 'node:util';
import { CormiError, type EnvironmentSummary } from '@cormijs/core';
import { fingerprint } from './inputs.js';

const fileLimit = 64 * 1024;
const prefix = 'CORMI_PUBLIC_';
export interface EnvironmentSnapshot {
  readonly mode: string;
  readonly paths: readonly string[];
  readonly fingerprint: string;
  readonly files: readonly { readonly name: string; readonly present: boolean }[];
  readonly values: Readonly<Record<string, string>>;
  readonly origins: Readonly<Record<string, readonly string[]>>;
}
export function validateMode(mode: unknown): asserts mode is string {
  if (typeof mode !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(mode) || mode === 'local') {
    throw new CormiError('MODE_INVALID', 'mode must be 1–64 lowercase ASCII letters, digits, _ or -; local is reserved.');
  }
}
export function environmentFiles(root: string, mode: string): readonly string[] {
  validateMode(mode);
  return Object.freeze(['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`].map(name => join(root, name)));
}
/** Validate complete assignment framing, then delegate value interpretation to Node. No expansion or execution. */
export function parseEnvironment(source: string, name: string): Readonly<Record<string, string>> {
  if (source.includes('\0')) throw new CormiError('ENV_SYNTAX_INVALID', `${name}: NUL is not allowed.`);
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const values: Record<string, string> = Object.create(null);
  const header = /[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*/y;
  const tail = /[ \t]*(?:#[^\n]*)?(?:\n|$)/y;
  let at = 0, assignments = 0;
  const invalid = (position: number): never => {
    const line = text.slice(0, position).split('\n').length;
    throw new CormiError('ENV_SYNTAX_INVALID', `${name}:${line}: invalid or incomplete environment assignment.`);
  };
  while (at < text.length) {
    const blank = /^[ \t]*(?:#[^\n]*)?(?:\n|$)/.exec(text.slice(at));
    if (blank?.[0]) { at += blank[0].length; continue; }
    const start = at; header.lastIndex = at; const matched = header.exec(text);
    if (!matched) return invalid(at);
    const key = matched[1]!;
    if (key.length > 128 || ['__proto__', 'constructor', 'prototype', 'NODE_OPTIONS', 'VITE_USER_NODE_ENV'].includes(key)
      || key === prefix || ++assignments > 512) return invalid(at);
    at = header.lastIndex;
    const quote = text[at];
    if (quote === '"' || quote === "'" || quote === '`') {
      const end = text.indexOf(quote, at + 1); if (end < 0) return invalid(start);
      at = end + 1; tail.lastIndex = at; const ending = tail.exec(text);
      if (!ending) return invalid(start); at = tail.lastIndex;
    } else {
      const end = text.indexOf('\n', at); at = end < 0 ? text.length : end + 1;
    }
    const parsed = parseEnv(text.slice(start, at)) as Record<string, unknown>;
    const value = parsed[key];
    if (!Object.hasOwn(parsed, key) || Object.keys(parsed).length !== 1 || typeof value !== 'string') return invalid(start);
    values[key] = value;
  }
  return Object.freeze(values);
}
async function readEnvironmentFile(path: string): Promise<string | undefined> {
  const name = basename(path);
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new CormiError('ENV_FILE_INVALID', `${name}: cannot open an independent environment file.`);
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > fileLimit) throw new CormiError('ENV_FILE_INVALID', `${name}: expected an independent regular file of at most 64 KiB.`);
    const bytes = Buffer.alloc(fileLimit + 1); let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break; length += read.bytesRead;
    }
    const after = await handle.stat(), current = await lstat(path);
    if (length > fileLimit || before.size !== length || before.mtimeMs !== after.mtimeMs || before.ino !== current.ino
      || before.dev !== current.dev || current.isSymbolicLink() || current.nlink !== 1) throw new CormiError('ENV_CHANGED', `${name}: changed while being read.`);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)); }
    catch { throw new CormiError('ENV_SYNTAX_INVALID', `${name}: expected UTF-8 text.`); }
  } finally { await handle.close(); }
}
/** Private in-memory bootstrap snapshot. Never written into generated code or diagnostic output. */
export async function readEnvironment(root: string, mode: string): Promise<EnvironmentSnapshot> {
  const paths = environmentFiles(root, mode), initial = await fingerprint(paths);
  const values: Record<string, string> = Object.create(null), origins: Record<string, string[]> = Object.create(null);
  const files: Array<{ name: string; present: boolean }> = [];
  for (const path of paths) {
    const source = await readEnvironmentFile(path), name = basename(path);
    files.push(Object.freeze({ name, present: source !== undefined }));
    if (source === undefined) continue;
    for (const [key, value] of Object.entries(parseEnvironment(source, name))) {
      values[key] = value; (origins[key] ??= []).push(name);
    }
    if (Object.keys(values).length > 512) throw new CormiError('ENV_LIMIT', 'Environment files contain too many distinct keys.');
  }
  if (await fingerprint(paths) !== initial) throw new CormiError('ENV_CHANGED', 'Environment files changed while the snapshot was being read.');
  return Object.freeze({ mode, paths, fingerprint: initial, files: Object.freeze(files), values: Object.freeze(values),
    origins: Object.freeze(Object.fromEntries(Object.entries(origins).map(([key, history]) => [key, Object.freeze(history)]))) });
}
/** Inherited values win, including empty strings; NODE_ENV remains command-owned. */
export function resolveEnvironment(snapshot: EnvironmentSnapshot, inherited: Readonly<Record<string, string | undefined>>, nodeEnv: 'development' | 'production') {
  const env: Record<string, string> = Object.assign(Object.create(null), snapshot.values);
  for (const [key, value] of Object.entries(inherited)) if (value !== undefined) env[key] = value;
  env.NODE_ENV = nodeEnv;
  const publicEnv: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(env)) if (key.startsWith(prefix)) {
    if (!/^CORMI_PUBLIC_[A-Za-z0-9_]+$/.test(key) || key.length > 128) throw new CormiError('ENV_PUBLIC_INVALID', 'Invalid public environment variable name.');
    publicEnv[key] = value;
  }
  if (Object.keys(publicEnv).length > 256 || Buffer.byteLength(JSON.stringify(publicEnv)) > 256 * 1024) throw new CormiError('ENV_PUBLIC_LIMIT', 'Public environment snapshot exceeds its budget.');
  const names = [...new Set([...Object.keys(snapshot.values), ...Object.keys(publicEnv), 'NODE_ENV'])].sort();
  const summary: EnvironmentSummary = Object.freeze({ mode: snapshot.mode, nodeEnv,
    files: Object.freeze(snapshot.files.map(file => Object.freeze({ ...file }))),
    variables: Object.freeze(names.map(name => {
      const history = [...(snapshot.origins[name] ?? [])];
      if (inherited[name] !== undefined) history.push('inherited');
      if (name === 'NODE_ENV') history.push('command');
      return Object.freeze({ name, public: name.startsWith(prefix), source: history.at(-1)!, history: Object.freeze(history) });
    })),
  });
  return Object.freeze({ env: Object.freeze(env), publicEnv: Object.freeze(publicEnv), summary });
}
