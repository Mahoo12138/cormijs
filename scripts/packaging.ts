import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { pnpmCommand } from './tool-command.js';

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
export const slash = (path: string): string => path.split(sep).join('/');
export interface PackageManifest {
  name: string; version: string; private?: boolean; type?: string;
  exports?: Record<string, { types: string; import: string }>;
  dependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>; devDependencies?: Record<string, string>;
  bin?: Record<string, string>; scripts?: Record<string, string>; engines?: { node?: string };
}
export interface PackedPackage { name: string; version: string; file: string; sha256: string; contentSha256: string; files: number; bytes: number }
export interface LocalKit {
  format: 'cormi:local-kit:1'; packages: PackedPackage[];
  compatibility: { package: string; patch: string; sha256: string; runtimeModified: false };
  publicationEligible: false; blockers: string[];
}
/** pnpm 10.6.3 may reorder dependency keys; preserve semantically significant export-condition order. */
export function contentDigest(files: ReadonlyMap<string, Buffer>): string {
  const entries = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, bytes]) => {
    if (file === 'package.json') {
      const data = JSON.parse(bytes.toString()) as Record<string, unknown>;
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
        const value = data[field];
        if (value && typeof value === 'object') data[field] = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
      }
      bytes = Buffer.from(JSON.stringify(data));
    }
    return [file, sha256(bytes)];
  });
  return sha256(JSON.stringify(entries));
}
export function packagePath(path: string): string {
  assert.ok(path && !isAbsolute(path) && !path.includes(':') && !path.includes('\\') && !/[\x00-\x1f\x7f]/.test(path), `Invalid package path: ${path}`);
  assert.ok(path.split('/').every(part => part && part !== '.' && part !== '..'), `Invalid package path: ${path}`);
  return path;
}
function assertNonPrivate(path: string): void {
  packagePath(path);
  assert.ok(!/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.yarnrc(?:\.yml)?|\.netrc|\.pypirc|\.aws|\.ssh|\.git|\.cache|\.cormi(?:\.lock)?|node_modules|id_(?:rsa|dsa|ecdsa|ed25519))(?:\/|$)|\.(?:pem|key|p12|pfx|crt|cer|der)$|\.tsbuildinfo$/i.test(path), `Private/sensitive file cannot be delivered: ${path}`);
}
export function validatePacked(manifest: PackageManifest, files: ReadonlyMap<string, Buffer>, versions: ReadonlyMap<string, string>): void {
  assert.ok(manifest.name === 'cormijs' || /^@cormijs\/[a-z-]+$/.test(manifest.name));
  assert.equal(manifest.version, versions.get(manifest.name), `Archive version does not match workspace: ${manifest.name}`);
  assert.equal(manifest.private, true, 'Local evaluation must not silently remove the publishing guard');
  assert.equal(manifest.type, 'module');
  assert.ok(manifest.exports && Object.keys(manifest.exports).length);
  for (const [name, spec] of Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })) {
    assert.ok(!/^(workspace:|link:|file:)/.test(spec), `Unconverted dependency ${name}: ${spec}`);
    if (versions.has(name)) assert.equal(spec, versions.get(name), `Unexpected internal version: ${name}`);
  }
  for (const [subpath, value] of Object.entries(manifest.exports!)) {
    assert.ok(subpath === '.' || /^\.\/[a-z-]+$/.test(subpath), `Unsupported export: ${subpath}`);
    assert.equal(Object.keys(value)[0], 'types', `types condition must precede import: ${subpath}`);
    for (const target of [value.types, value.import]) {
      assert.ok(target.startsWith('./dist/')); assert.ok(files.has(packagePath(target.slice(2))), `Missing export: ${target}`);
    }
  }
  for (const target of Object.values(manifest.bin ?? {})) {
    const file = packagePath(target.replace(/^\.\//, ''));
    assert.ok(files.get(file)?.toString().startsWith('#!/usr/bin/env node\n'), `Missing Node bin/shebang: ${target}`);
  }
  const dependencies = new Set([manifest.name, ...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})]);
  for (const [file, bytes] of files) {
    packagePath(file);
    assert.ok(/^(?:dist\/|src\/|package\.json$|README(?:\.md)?$|LICENSE(?:\.md)?$)/.test(file), `Unexpected packed file: ${file}`);
    assertNonPrivate(file);
    assert.ok(!/(?:^|\/)(?:node_modules|tests?|\.env[^/]*|\.cache|\.git)(?:\/|$)|\.tsbuildinfo$/.test(file), `Private/build debris in archive: ${file}`);
    if (file.endsWith('.map')) {
      const map = JSON.parse(bytes.toString()) as { sources: string[]; sourceRoot?: string; sourcesContent?: unknown[] };
      assert.ok(Array.isArray(map.sources));
      assert.ok(!map.sourceRoot || !/^(?:\/|[A-Za-z][A-Za-z0-9+.-]*:)/.test(map.sourceRoot), 'Absolute source map root');
      for (const [index, source] of map.sources.entries()) {
        assert.ok(typeof source === 'string' && !/^(?:\/|[A-Za-z][A-Za-z0-9+.-]*:)/.test(source), 'Absolute source map source');
        const target = packagePath(posix.normalize(posix.join(posix.dirname(file), map.sourceRoot ?? '', source)));
        assert.ok(files.has(target) || typeof map.sourcesContent?.[index] === 'string', `Broken source map: ${file} -> ${source}`);
      }
    }
    if (!file.startsWith('dist/') || !/\.(?:js|d\.ts)$/.test(file)) continue;
    for (const { fileName: spec } of ts.preProcessFile(bytes.toString(), true, true).importedFiles) {
      if (spec.startsWith('.')) {
        const target = packagePath(posix.normalize(posix.join(posix.dirname(file), spec)));
        assert.ok(files.has(target) || file.endsWith('.d.ts') && files.has(target.replace(/\.js$/, '.d.ts')), `Missing relative module: ${file} -> ${spec}`);
      } else {
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
        assert.ok(spec.startsWith('node:') || builtinModules.includes(spec) || dependencies.has(name), `Undeclared dependency: ${manifest.name}/${file} -> ${spec}`);
      }
    }
  }
}
/** Verify the compatibility patch cannot silently modify executable code or declaration semantics. */
export function validateDeclarationPatch(patch: string): number {
  const old: string[] = [], next: string[] = [], paths: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      assert.match(line, /^(?:--- a|\+\+\+ b)\/lib\/[a-z-]+\.d\.ts$/);
      if (line.startsWith('+++')) paths.push(line.slice(6));
    } else if (line.startsWith('-')) old.push(line.slice(1));
    else if (line.startsWith('+')) next.push(line.slice(1));
  }
  assert.ok(paths.length > 0); assert.equal(old.length, next.length);
  for (let i = 0; i < old.length; i++) {
    const normalized = old[i]!.replace(/(['"])(\.{1,2}(?:\/[^'"]*)?)\1/g, (_all, quote: string, path: string) => {
      const target = path === '.' ? './index.js' : path === '..' ? '../index.js' : path + '.js';
      return quote + target + quote;
    });
    assert.equal(next[i], normalized, 'Patch must only add NodeNext relative module extensions');
  }
  return paths.length;
}
export async function run(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env, timeout = 60000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolveResult, reject) => {
    const command = executable === 'pnpm' ? pnpmCommand(args, env) : { executable, args };
    const child = spawn(command.executable, command.args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error(`Command timed out: ${executable} ${args.join(' ')}`); child.kill('SIGKILL'); }, timeout);
    const collect = (chunk: Buffer, output: 'stdout' | 'stderr') => {
      if (output === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
      if (stdout.length + stderr.length > 8 * 1024 * 1024) { failure = new Error('Command output exceeded limit'); child.kill('SIGKILL'); }
    };
    child.stdout.on('data', chunk => collect(chunk, 'stdout')); child.stderr.on('data', chunk => collect(chunk, 'stderr'));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (failure || signal) reject(failure ?? new Error(`Command terminated: ${signal}`));
      else resolveResult({ code: code ?? 1, stdout, stderr });
    });
  });
}
export async function checked(executable: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv, timeout?: number): Promise<string> {
  const result = await run(executable, args, cwd, env, timeout);
  assert.equal(result.code, 0, `${executable} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
export async function filesUnder(root: string): Promise<Map<string, Buffer>> {
  const info = await lstat(root);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Package source root must be a real directory, not a link');
  const result = new Map<string, Buffer>(); let bytes = 0, visited = 0;
  async function visit(directory: string, depth = 0) {
    assert.ok(depth <= 64, 'Package tree exceeds inspection depth');
    for (const name of (await readdir(directory)).sort()) {
      assert.ok(++visited <= 20000, 'Package tree exceeds inspection entry budget');
      const file = join(directory, name), stat = await lstat(file);
      assert.ok(!stat.isSymbolicLink(), `Unexpected package link: ${file}`);
      if (stat.isDirectory()) await visit(file, depth + 1);
      else {
        assert.ok(stat.isFile() && stat.nlink === 1, 'Only independent regular package files are accepted');
        bytes += stat.size; assert.ok(bytes <= 64 * 1024 * 1024 && result.size < 20000, 'Package exceeds inspection budget');
        result.set(packagePath(slash(relative(root, file))), await readFile(file));
      }
    }
  }
  await visit(root); return result;
}
/** Inspects only archives just produced locally by pnpm; not a general untrusted upload extractor. */
export async function inspectArchive(archive: string, versions: ReadonlyMap<string, string>): Promise<{ manifest: PackageManifest; files: Map<string, Buffer> }> {
  const hash = sha256(await readFile(archive));
  const names = (await checked('tar', ['-tzf', archive], dirname(archive))).trim().split('\n');
  for (const name of names) { const path = packagePath(name.replace(/\/$/, '')); assert.ok(path === 'package' || path.startsWith('package/')); }
  const details = (await checked('tar', ['-tvzf', archive], dirname(archive), { ...process.env, LC_ALL: 'C' })).trim().split('\n');
  assert.ok(details.every(line => /^[d-]/.test(line)), 'Links and special entries are not accepted');
  assert.equal(new Set(names).size, names.length, 'Duplicate archive members');
  const temporary = await mkdtemp(join(tmpdir(), 'cormi-archive-'));
  try {
    assert.equal(sha256(await readFile(archive)), hash, 'Archive changed during inspection');
    await checked('tar', ['-xzf', archive, '-C', temporary], dirname(archive));
    const files = await filesUnder(join(temporary, 'package'));
    const manifest = JSON.parse(files.get('package.json')!.toString()) as PackageManifest;
    validatePacked(manifest, files, versions);
    for (const bin of Object.values(manifest.bin ?? {})) assert.ok((await lstat(join(temporary, 'package', bin))).mode & 0o111, 'CLI archive entry must be executable');
    return { manifest, files };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
export async function packWorkspace(root: string, destination: string): Promise<LocalKit> {
  root = await realpath(root);
  assert.equal((await checked('pnpm', ['--version'], root)).trim(), '10.6.3', 'Use the pinned package manager for this profile');
  await mkdir(destination); // Exclusive: never empty or overwrite a delivery directory.
  const tarballs = join(destination, 'tarballs'); await mkdir(tarballs);
  const manifests: Array<{ directory: string; manifest: PackageManifest }> = [];
  for (const name of (await readdir(join(root, 'packages'))).sort()) {
    const directory = join(root, 'packages', name);
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as PackageManifest;
    assert.equal(Object.keys(manifest.scripts ?? {}).filter(key => /^(prepack|prepare|postpack)$/.test(key)).length, 0, 'Review package lifecycle changes before packing');
    manifests.push({ directory, manifest });
  }
  const versions = new Map(manifests.map(({ manifest }) => [manifest.name, manifest.version]));
  const packages: PackedPackage[] = [];
  for (const { directory, manifest } of manifests) {
    const output = JSON.parse(await checked('pnpm', ['pack', '--json', '--pack-destination', tarballs], directory,
      { ...process.env, npm_config_ignore_scripts: 'true' })) as { filename: string };
    const archive = resolve(output.filename); assert.equal(dirname(archive), tarballs);
    const inspected = await inspectArchive(archive, versions); assert.equal(inspected.manifest.name, manifest.name);
    const bytes = await readFile(archive);
    packages.push({ name: manifest.name, version: manifest.version, file: slash(relative(destination, archive)), sha256: sha256(bytes), contentSha256: contentDigest(inspected.files), files: inspected.files.size, bytes: bytes.length });
  }
  const compatibility = join(destination, 'compatibility'); await mkdir(compatibility);
  const patch = await readFile(join(root, 'patches/cordis@4.0.0-rc.11.patch')); validateDeclarationPatch(patch.toString());
  await writeFile(join(compatibility, 'cordis.patch'), patch);
  await cp(join(root, 'patches/CORDIS-LICENSE'), join(compatibility, 'CORDIS-LICENSE'));
  const kit: LocalKit = { format: 'cormi:local-kit:1', packages,
    compatibility: { package: 'cordis@4.0.0-rc.11', patch: 'compatibility/cordis.patch', sha256: sha256(patch), runtimeModified: false },
    publicationEligible: false, blockers: ['packages-are-private', 'project-license-not-selected', 'consumer-root-pnpm-patch-required', 'cross-platform-not-validated'] };
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(kit, null, 2) + '\n');
  return kit;
}
export function consumerManifest(kit: LocalKit, profile: 'core' | 'launcher' | 'react', patched = true) {
  const override = Object.fromEntries(kit.packages.map(item => [item.name, 'file:../' + item.file]));
  const dependencies: Record<string, string> = profile === 'core' ? { '@cormijs/core': override['@cormijs/core']! }
    : profile === 'launcher' ? { cormijs: override.cormijs!, '@cormijs/core': override['@cormijs/core']! }
    : { cormijs: override.cormijs!, '@cormijs/preset-react-vite': override['@cormijs/preset-react-vite']!, '@cormijs/runtime': override['@cormijs/runtime']!, react: '19.3.1', 'react-dom': '19.3.1', 'react-router': '7.18.2' };
  return { name: 'cormi-packed-' + profile, private: true, type: 'module', packageManager: 'pnpm@10.6.3',
    scripts: { dev: 'cormi dev', build: 'cormi build', preview: 'cormi preview', typecheck: 'cormi typecheck', inspect: 'cormi inspect' },
    dependencies, devDependencies: { typescript: '5.9.3', '@types/node': '22.13.10', ...(profile === 'react' ? { '@types/react': '19.2.0', '@types/react-dom': '19.2.0' } : {}) },
    pnpm: { overrides: override, ...(patched ? { patchedDependencies: { [kit.compatibility.package]: '../' + kit.compatibility.patch } } : {}) } };
}
export const consumerNpmrc = 'auto-install-peers=false\nstrict-peer-dependencies=true\nhoist=false\nmanage-package-manager-versions=false\nignore-scripts=true\n';
export async function createReactConsumer(root: string, kit: LocalKit, destination: string, templateName: 'basic' | 'features' = 'basic'): Promise<void> {
  assert.ok(templateName === 'basic' || templateName === 'features', 'Unknown React template');
  root = await realpath(root);
  const base = join(root, 'examples', templateName);
  assert.equal(await realpath(base), base, 'Example directory must not traverse links');
  const sources = await filesUnder(join(base, 'src'));
  const template = new Map([...sources].map(([path, bytes]) => ['src/' + path, bytes]));
  if (templateName === 'features') for (const [path, bytes] of await filesUnder(join(base, 'features'))) template.set('features/' + path, bytes);
  for (const name of ['index.html', 'tsconfig.json', ...(templateName === 'features' ? ['cormi.config.ts'] : [])]) {
    const file = join(base, name), info = await lstat(file);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'Example entry must be an independent file');
    assert.ok(info.size <= 1024 * 1024, 'Example entry exceeds copy budget');
    template.set(name, await readFile(file));
  }
  // Inspect the entire template before admitting a destination. Never copy workspace links or local credentials.
  for (const file of template.keys()) assertNonPrivate(file);
  await mkdir(destination);
  for (const [file, bytes] of template) {
    const target = join(destination, file); await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  const manifest = consumerManifest(kit, 'react');
  if (templateName === 'features') manifest.dependencies['@cormijs/plugin-react'] = manifest.pnpm.overrides['@cormijs/plugin-react']!;
  await writeFile(join(destination, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(destination, '.npmrc'), consumerNpmrc);
  if (templateName === 'features') await writeFile(join(destination, 'cormi.config.ts'), template.get('cormi.config.ts')!.toString().replace('port: 8002', 'port: 0'));
  else await writeFile(join(destination, 'cormi.config.ts'), "import { defineConfig } from 'cormijs';\nimport reactVite from '@cormijs/preset-react-vite';\nexport default defineConfig({presets:[reactVite],app:{base:'/demo/',server:{host:'127.0.0.1',port:0},runtime:[{id:'example',module:{specifier:'./src/runtime.tsx',exportName:'default'}}]}});\n");
}
