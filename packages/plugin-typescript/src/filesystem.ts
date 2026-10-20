import { CormiError } from '@cormijs/core';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type * as TS from 'typescript';

/** Per-check overlay. Compiler callbacks never forward a filesystem write to TypeScript's sys. */
export function checkingSystem(ts: typeof TS, root: string, signal: AbortSignal) {
  const key = (file: string) => { const path = resolve(file); return ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase(); };
  const outputs = new Map<string, { text: string; date: Date }>(), directories = new Set<string>(), hidden = new Set<string>();
  const reads = new Map<string, { file: string; text: string | undefined }>();
  const probes = new Map<string, { file: string; kind: 'file' | 'directory'; value: boolean }>();
  const directoryLists = new Map<string, { path: string; names: string[] }>();
  const scans = new Map<string, { args: Parameters<TS.System['readDirectory']>; files: string[] }>();
  let bytes = 0;
  const masked = (file: string) => hidden.has(key(file)) || file.endsWith('.tsbuildinfo');
  const changed = () => new CormiError('TYPECHECK_INPUT_CHANGED', 'Compiler inputs changed during typechecking; run it again.');
  function exists(file: string, kind: 'file' | 'directory'): boolean {
    signal.throwIfAborted(); const id = key(file);
    if (kind === 'file' ? outputs.has(id) : directories.has(id)) return true;
    if (kind === 'file' && masked(file)) return false;
    const value = kind === 'file' ? ts.sys.fileExists(file) : ts.sys.directoryExists(file), identity = kind + ':' + id;
    const previous = probes.get(identity);
    if (previous && previous.value !== value) throw changed();
    if (probes.size >= 100000 && !previous) throw new CormiError('TYPECHECK_LIMIT', 'Module-resolution probe budget exceeded.');
    probes.set(identity, { file, kind, value }); return value;
  }
  function read(file: string, encoding?: string): string | undefined {
    signal.throwIfAborted();
    const id = key(file), virtual = outputs.get(id);
    if (virtual) return virtual.text;
    if (masked(file)) return undefined;
    const text = ts.sys.readFile(file, encoding), previous = reads.get(id);
    if (previous && previous.text !== text) throw changed();
    if (reads.size >= 50000 && !previous) throw new CormiError('TYPECHECK_LIMIT', 'Compiler read budget exceeded.');
    reads.set(id, { file, text }); return text;
  }
  function write(file: string, text: string, bom?: boolean): void {
    signal.throwIfAborted();
    const path = resolve(file), local = relative(root, path), id = key(path);
    if (!local || isAbsolute(local) || local === '..' || local.startsWith('..' + sep) || reads.get(id)?.text !== undefined) {
      throw new CormiError('TYPECHECK_OUTPUT_CONFLICT', 'A virtual compiler output conflicts with an input or escapes the project.');
    }
    const value = (bom ? '\uFEFF' : '') + text;
    bytes += Buffer.byteLength(value) - Buffer.byteLength(outputs.get(id)?.text ?? '');
    if (bytes > 64 * 1024 * 1024 || outputs.size >= 20000 && !outputs.has(id)) throw new CormiError('TYPECHECK_LIMIT', 'Virtual compiler output budget exceeded.');
    outputs.set(id, { text: value, date: new Date() });
    for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) directories.add(key(parent));
  }
  const system: TS.System = {
    ...ts.sys, getCurrentDirectory: () => root, readFile: read, writeFile: write,
    fileExists: file => exists(file, 'file'),
    directoryExists: file => exists(file, 'directory'),
    getDirectories(path) {
      const names = ts.sys.getDirectories(path), previous = directoryLists.get(key(path));
      if (previous && JSON.stringify(previous.names) !== JSON.stringify(names)) throw changed();
      directoryLists.set(key(path), { path, names });
      return [...new Set([...names, ...[...directories].filter(file => key(dirname(file)) === key(path)).map(file => basename(file))])];
    },
    realpath: file => outputs.has(key(file)) || directories.has(key(file)) ? resolve(file) : ts.sys.realpath?.(file) ?? resolve(file),
    readDirectory(...args) {
      signal.throwIfAborted(); const files = ts.sys.readDirectory(...args), id = JSON.stringify(args);
      const before = scans.get(id);
      if (before && JSON.stringify(before.files) !== JSON.stringify(files)) throw changed();
      scans.set(id, { args, files: [...files] }); return files;
    },
    createDirectory: () => {},
    getModifiedTime: file => outputs.get(key(file))?.date ?? (masked(file) ? undefined : ts.sys.getModifiedTime?.(file)),
    setModifiedTime(file, date) { const output = outputs.get(key(file)); if (output) output.date = date; },
    deleteFile: () => { throw new CormiError('TYPECHECK_WRITE_FORBIDDEN', 'Typechecking cannot delete filesystem outputs.'); },
  };
  return { system, key, outputs,
    hide(files: Iterable<string>) { for (const file of files) hidden.add(key(file)); },
    verify() {
      signal.throwIfAborted();
      for (const { file, text } of reads.values()) if (ts.sys.readFile(file) !== text) throw changed();
      for (const { file, kind, value } of probes.values()) if ((kind === 'file' ? ts.sys.fileExists(file) : ts.sys.directoryExists(file)) !== value) throw changed();
      for (const { path, names } of directoryLists.values()) if (JSON.stringify(ts.sys.getDirectories(path)) !== JSON.stringify(names)) throw changed();
      for (const { args, files } of scans.values()) if (JSON.stringify(ts.sys.readDirectory(...args)) !== JSON.stringify(files)) throw changed();
    },
  };
}
