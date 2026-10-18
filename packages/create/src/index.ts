import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { templateFiles, type Template } from './templates.js';
export type { Template } from './templates.js';
export class CreateError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'CreateError'; } }
export interface CreateOptions { readonly directory: string; readonly kit: string; readonly template?: Template; readonly name?: string; readonly signal?: AbortSignal }
interface PackageItem { name: string; version: string; file: string; sha256: string }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fail = (message: string): never => { throw new CreateError('CREATE_KIT_INVALID', message); };
function localPath(value: unknown): value is string {
  return typeof value === 'string' && value.length < 512 && !isAbsolute(value) && !/[\\:\x00-\x1f\x7f]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}
async function boundedFile(root: string, name: string, budget = 16 * 1024 * 1024): Promise<Buffer> {
  const path = join(root, name), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > budget || await realpath(path) !== path) fail('Kit inputs must be bounded, independent regular files.');
  const bytes = await readFile(path); if (bytes.length > budget) fail('Kit file exceeds its byte limit.'); return bytes;
}
/** Read and validate all inputs before admitting an exclusive new project. Never installs or executes code. */
export async function createProject(options: CreateOptions): Promise<{ directory: string; template: Template; files: readonly string[]; packageCount: number; installed: false }> {
  const template = options.template ?? 'react';
  if (!['react','react-api'].includes(template)) throw new CreateError('CREATE_TEMPLATE_INVALID', 'Choose react or react-api.');
  const target = resolve(options.directory), parent = dirname(target);
  if (await realpath(parent) !== parent) throw new CreateError('CREATE_PATH_INVALID', 'Destination parent must exist without symlink aliases.');
  try { await lstat(target); throw new CreateError('CREATE_TARGET_EXISTS', 'Destination already exists; no files were changed.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const name = options.name ?? (basename(target).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'cormi-app');
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(name)) throw new CreateError('CREATE_NAME_INVALID', 'Use a lowercase npm-compatible project name.');
  options.signal?.throwIfAborted();
  const kit = await realpath(options.kit);
  const manifestBytes = await boundedFile(kit, 'manifest.json', 1024 * 1024);
  let raw: Record<string, any>;
  try { raw = JSON.parse(manifestBytes.toString()); } catch { fail('Kit manifest is not JSON.'); }
  if (!raw! || raw!.format !== 'cormi:local-kit:1' || !Array.isArray(raw!.packages) || raw!.packages.length < 1 || raw!.packages.length > 64) fail('Unsupported local kit manifest.');
  const files = new Map<string, Buffer>(), refs: Record<string,string> = Object.create(null), names = new Set<string>(), paths = new Set<string>();
  let total = 0;
  for (const entry of raw!.packages as PackageItem[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.name !== 'string' || typeof entry.version !== 'string' || typeof entry.sha256 !== 'string'
      || !(entry.name === 'cormijs' || /^@cormijs\/[a-z-]+$/.test(entry.name)) || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(entry.version)
      || !localPath(entry.file) || !/^tarballs\/[A-Za-z0-9._-]+\.tgz$/.test(entry.file) || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || names.has(entry.name) || paths.has(entry.file)) fail('Invalid or duplicate tarball entry.');
    names.add(entry.name); paths.add(entry.file);
    const bytes = await boundedFile(kit, entry.file); total += bytes.length;
    if (total > 64 * 1024 * 1024 || hash(bytes) !== entry.sha256) fail('Tarball checksum or byte budget mismatch.');
    const local = '.cormi-local/' + entry.file; files.set(local, bytes); refs[entry.name] = 'file:./' + local;
  }
  const required = ['cormijs','@cormijs/preset-react-vite','@cormijs/runtime', ...(template==='react-api' ? ['@cormijs/plugin-dev-api','@cormijs/plugin-vite'] : [])];
  for (const name of required) if (!refs[name]) fail('Kit does not contain required package: ' + name);
  const compatibility = raw!.compatibility;
  if (!compatibility || compatibility.package !== 'cordis@4.0.0-rc.11' || compatibility.patch !== 'compatibility/cordis.patch' || typeof compatibility.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(compatibility.sha256) || compatibility.runtimeModified !== false) fail('Unsupported declaration compatibility strategy.');
  const patch = await boundedFile(kit, compatibility.patch, 1024 * 1024);
  if (hash(patch) !== compatibility.sha256) fail('Compatibility patch checksum mismatch.');
  files.set('.cormi-local/compatibility/cordis.patch', patch);
  files.set('.cormi-local/compatibility/CORDIS-LICENSE', await boundedFile(kit, 'compatibility/CORDIS-LICENSE', 1024 * 1024));
  files.set('.cormi-local/manifest.json', manifestBytes);
  for (const [path, text] of Object.entries(templateFiles(template))) files.set(path, Buffer.from(text));
  files.set('package.json', Buffer.from(JSON.stringify({ name, private:true, type:'module', packageManager:'pnpm@10.6.3', engines:{node:'>=22.14.0'},
    scripts:{ dev:'cormi dev', build:'cormi build', preview:'cormi preview', typecheck:'cormi typecheck', inspect:'cormi inspect' },
    dependencies:{ ...Object.fromEntries(required.map(name=>[name,refs[name]])), react:'19.3.1','react-dom':'19.3.1','react-router':'7.18.2' },
    devDependencies:{typescript:'5.9.3','@types/node':'22.13.10','@types/react':'19.2.0','@types/react-dom':'19.2.0'},
    pnpm:{ overrides:refs, patchedDependencies:{'cordis@4.0.0-rc.11':'.cormi-local/compatibility/cordis.patch'} },
  },null,2)+'\n'));
  options.signal?.throwIfAborted();
  try { await mkdir(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new CreateError('CREATE_TARGET_EXISTS', 'Another creator acquired this destination.');
    throw error;
  }
  const identity = await lstat(target);
  async function checkTarget() {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== identity.dev || info.ino !== identity.ino || await realpath(target) !== target) throw new CreateError('CREATE_OWNERSHIP_LOST', 'Destination changed during creation.');
  }
  try {
    for (const [path, bytes] of files) {
      options.signal?.throwIfAborted(); await checkTarget();
      const out = join(target,path), local = relative(target,out);
      if (!local || local.startsWith('..'+sep) || isAbsolute(local)) throw new CreateError('CREATE_PATH_INVALID', 'Invalid template output.');
      await mkdir(dirname(out), { recursive:true });
      if (await realpath(dirname(out)) !== dirname(out)) throw new CreateError('CREATE_OWNERSHIP_LOST', 'Output ancestor changed during creation.');
      await writeFile(out,bytes,{flag:'wx'});
    }
    await checkTarget();
  } catch (error) {
    // Preserve any partial directory for inspection; never recursively delete a concurrent user's files.
    throw new CreateError('CREATE_INCOMPLETE', 'Creation did not finish; the new directory was retained. Cause: ' + (error instanceof Error ? error.message : String(error)));
  }
  return Object.freeze({directory:target,template,files:Object.freeze([...files.keys()].sort()),packageCount:names.size,installed:false});
}
