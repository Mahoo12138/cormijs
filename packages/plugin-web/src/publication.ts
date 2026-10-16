import { CormiError } from '@cormijs/core';
import type { BuildPlan, BuildResult } from '@cormijs/builder';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync, type Stats } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MARKER = '.cormi-build.json';
const FORMAT = 'cormi:build:1';
type FileEntry = { path: string; kind: 'directory' } | { path: string; kind: 'file'; size: number; sha256: string };
interface Inventory { readonly entries: readonly FileEntry[]; readonly digest: string }
interface OwnedOutput { readonly identity: Stats; readonly marker: string; readonly inventory: Inventory }
export interface PublishedBuildResult extends BuildResult {
  readonly publication: { readonly id: string; readonly replaced: boolean; readonly digest: string };
}
/** Internal injection seam for deterministic filesystem-failure tests, not a config option. */
export interface PublicationIO { rename(from: string, to: string): void }
const disk: PublicationIO = { rename: renameSync };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
function maybeStat(path: string): Stats | undefined {
  try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
function directory(path: string, identity?: Stats): Stats {
  const actual = lstatSync(path);
  if (!actual.isDirectory() || actual.isSymbolicLink() || identity && !same(actual, identity)) throw new CormiError('OUTPUT_PATH_INVALID', `Directory identity changed: ${path}`);
  return actual;
}
function fileText(path: string, limit: number): string {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > limit) throw new CormiError('OUTPUT_INVALID', `Not a bounded regular file: ${path}`);
  return readFileSync(path, 'utf8');
}
/** Complete inventory prevents a marker alone from authorizing removal of later user files. */
function inventory(path: string): Inventory {
  const entries: FileEntry[] = []; let bytes = 0;
  function visit(parent: string, prefix: string): void {
    for (const name of readdirSync(parent).sort()) {
      if (!prefix && name === MARKER) continue;
      if (entries.length >= 100000) throw new CormiError('OUTPUT_TOO_LARGE', 'Output inventory exceeds 100000 entries.');
      const full = join(parent, name), key = prefix + name, info = lstatSync(full);
      if (info.isSymbolicLink()) throw new CormiError('OUTPUT_INVALID', `Output symlink is not managed: ${key}`);
      if (info.isDirectory()) { entries.push({ path: key, kind: 'directory' }); visit(full, key + '/'); }
      else if (info.isFile() && info.nlink === 1) {
        bytes += info.size;
        if (bytes > 1024 ** 3) throw new CormiError('OUTPUT_TOO_LARGE', 'Output inventory exceeds 1 GiB.');
        const fd = openSync(full, 'r'), hash = createHash('sha256'), buffer = Buffer.allocUnsafe(65536);
        try {
          if (!same(info, fstatSync(fd))) throw new CormiError('OUTPUT_CHANGED', `Output changed during inventory: ${key}`);
          let count: number;
          while ((count = readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
          const after = fstatSync(fd);
          if (info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs) throw new CormiError('OUTPUT_CHANGED', `Output changed during inventory: ${key}`);
        } finally { closeSync(fd); }
        entries.push({ path: key, kind: 'file', size: info.size, sha256: hash.digest('hex') });
      } else throw new CormiError('OUTPUT_INVALID', `Output contains a special file or hard link: ${key}`);
    }
  }
  directory(path); visit(path, '');
  return { entries, digest: sha(JSON.stringify(entries)) };
}
function owned(path: string, project: string, output: string): OwnedOutput | undefined {
  if (!maybeStat(path)) return;
  const identity = directory(path), markerFile = join(path, MARKER);
  if (!maybeStat(markerFile)) throw new CormiError('OUTPUT_NOT_OWNED', `Refusing to replace unowned output: ${output}`);
  const marker = fileText(markerFile, 16 * 1024 ** 2);
  let value: Record<string, unknown>;
  try { value = JSON.parse(marker); } catch { throw new CormiError('OUTPUT_NOT_OWNED', 'Malformed output ownership manifest.'); }
  if (!value || value.format !== FORMAT || value.project !== project || value.output !== output || typeof value.id !== 'string') throw new CormiError('OUTPUT_NOT_OWNED', 'Output manifest belongs to another project or format.');
  const actual = inventory(path);
  if (value.digest !== actual.digest || JSON.stringify(value.entries) !== JSON.stringify(actual.entries)) throw new CormiError('OUTPUT_MODIFIED', 'Output changed after publication; preserve those changes before rebuilding.', { output });
  return { identity, marker, inventory: actual };
}
function verifyOld(path: string, before: OwnedOutput | undefined, project: string, output: string): void {
  const now = owned(path, project, output);
  if (!!before !== !!now || before && now && (!same(before.identity, now.identity) || before.marker !== now.marker || before.inventory.digest !== now.inventory.digest)) throw new CormiError('OUTPUT_CHANGED', 'Output changed while the next build was running.');
}
function outputName(root: string, name: string): string {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes('\\')) throw new CormiError('OUTPUT_PATH_INVALID', 'Output must be a dedicated project-relative directory.');
  const target = resolve(root, name);
  if (dirname(target) !== root || name !== basename(target) || name.startsWith('.') || ['src', 'public', 'node_modules', 'packages', 'docs', 'tests', 'examples', 'cordis', 'umi'].includes(name.toLowerCase())) throw new CormiError('OUTPUT_PATH_INVALID', 'Managed output must be a non-reserved direct child of the project.');
  return target;
}
/** Web command policy: compile elsewhere, verify complete output, then replace only our unchanged previous result. */
export async function publishBuild(plan: BuildPlan, build: (plan: BuildPlan, signal: AbortSignal) => Promise<BuildResult>,
  signal: AbortSignal = new AbortController().signal, io: PublicationIO = disk): Promise<PublishedBuildResult> {
  signal.throwIfAborted();
  if (!isAbsolute(plan.root)) throw new CormiError('ROOT_INVALID', 'BuildPlan.root must be absolute.');
  const root = realpathSync(plan.root), rootIdentity = directory(root), target = outputName(root, plan.outDir);
  if (plan.entry !== 'index.html') throw new CormiError('ENTRY_UNSUPPORTED', 'Managed Web output requires index.html.');
  const project = sha(root), output = basename(target), lock = join(root, '.cormi-publish.lock'), token = randomUUID();
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (cause) { throw new CormiError('PUBLISH_BUSY', 'Another or interrupted publication owns this project. Do not remove its lock until its processes and journal have been inspected.', {}, { cause }); }
  const lockIdentity = directory(lock); let work: string | undefined, workIdentity: Stats | undefined;
  let preserve = false, committed = false;
  try {
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ token, pid: process.pid, output }), { flag: 'wx', mode: 0o600 });
    const before = owned(target, project, output);
    work = mkdtempSync(join(root, '.cormi-publish-')); workIdentity = directory(work);
    const staged = join(work, 'output'), previous = join(work, 'previous'), id = randomUUID();
    const journal = { format: FORMAT, id, project, output, work: basename(work), previous: !!before };
    writeFileSync(join(work, 'transaction.json'), JSON.stringify(journal, null, 2), { flag: 'wx', mode: 0o600 });
    const result = await build({ ...plan, root, outDir: relative(root, staged).split(sep).join('/') }, signal);
    signal.throwIfAborted(); directory(root, rootIdentity); directory(work, workIdentity);
    if (resolve(root, result.outDir) !== staged || typeof result.backend !== 'string' || !result.backend) throw new CormiError('BUILD_RESULT_INVALID', 'Builder did not return the assigned staging output.');
    const stagedIdentity = directory(staged);
    if (maybeStat(join(staged, MARKER))) throw new CormiError('OUTPUT_METADATA_CONFLICT', 'The builder wrote reserved ownership metadata.');
    const next = inventory(staged);
    if (!next.entries.some(item => item.path === 'index.html' && item.kind === 'file')) throw new CormiError('OUTPUT_ENTRY_MISSING', 'Successful build did not create index.html.');
    writeFileSync(join(staged, MARKER), JSON.stringify({ format: FORMAT, id, project, output, digest: next.digest, entries: next.entries }, null, 2) + '\n', { flag: 'wx' });
    verifyOld(target, before, project, output); directory(staged, stagedIdentity); signal.throwIfAborted();
    // No awaits through cutover. Two directory renames are not a globally atomic exchange.
    let moved = false;
    try {
      if (before) { io.rename(target, previous); moved = true; }
      io.rename(staged, target); committed = true;
    } catch (cause) {
      if (moved) {
        try {
          if (maybeStat(target)) throw new Error('Destination appeared during rollback; refusing to overwrite it.');
          directory(previous, before!.identity); io.rename(previous, target);
        } catch (rollback) {
          preserve = true;
          throw new CormiError('PUBLISH_ROLLBACK_FAILED', 'Publication and rollback failed. Previous output and transaction are retained; manual recovery is required.', { work, target, published: false }, { cause: new AggregateError([cause, rollback]) });
        }
      }
      throw new CormiError('PUBLISH_FAILED', 'Output cutover failed; the previous output was preserved.', {}, { cause });
    }
    return { backend: result.backend, outDir: target, publication: { id, replaced: !!before, digest: next.digest } };
  } finally {
    if (!preserve) {
      try {
        if (work) { directory(root, rootIdentity); directory(work, workIdentity); rmSync(work, { recursive: true }); }
        directory(lock, lockIdentity);
        if (JSON.parse(fileText(join(lock, 'owner.json'), 4096)).token !== token) throw new Error('Publication lock changed owner.');
        rmSync(join(lock, 'owner.json')); rmdirSync(lock);
      } catch (cause) {
        throw new CormiError('PUBLISH_CLEANUP_INCOMPLETE', committed ? 'New output was published, but cleanup is incomplete; inspect the retained publication workspace.' : 'Publication cleanup is incomplete; previous output was not intentionally replaced.', { published: committed, work, target }, { cause });
      }
    }
  }
}
