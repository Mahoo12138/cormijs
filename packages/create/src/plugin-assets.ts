// Inert author-tool templates. Resource transformation belongs to the application's bundler.
export const assetToolsScript = String.raw`import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

const code = /\.(?:tsx?|jsx?)$/;
const assets = new Set(['.css','.svg','.png','.jpg','.jpeg','.gif','.webp','.avif','.ico','.woff','.woff2','.ttf','.otf']);
const metadata = '.cormi-plugin-assets.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validPath = path => typeof path === 'string' && path.length <= 512 && !/[\\:\x00-\x1f\x7f]/.test(path)
  && path.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.'));
const resource = path => assets.has(extname(path).toLowerCase()) || /\.d\.ts$/.test(path);

/** Independent bounded source snapshot; binary resource bytes are never decoded or rewritten. */
export async function collectPluginSource(root) {
  assert.equal(await realpath(root), root, 'Source root must be canonical');
  const source = new Map(); let total = 0, visited = 0;
  async function visit(path, depth = 0) {
    assert.ok(++visited <= 512 && depth <= 32, 'Source directory budget exceeded');
    assert.ok(validPath(path), 'Private or invalid files are not package inputs');
    const full = join(root, path), info = await lstat(full);
    assert.ok(!info.isSymbolicLink() && await realpath(full) === full, 'Links are not package inputs');
    if (info.isDirectory()) {
      for (const name of (await readdir(full)).sort()) await visit(path + '/' + name, depth + 1);
      return;
    }
    assert.ok(info.isFile() && info.nlink === 1 && (code.test(path) || assets.has(extname(path).toLowerCase())), 'Only independent TS/JS and supported CSS/image/font sources may be packaged');
    assert.ok(source.size < 256 && info.size <= 1024 * 1024, 'Source budget exceeded');
    const bytes = await readFile(full);
    total += bytes.length;
    assert.ok(bytes.length <= 1024 * 1024 && total <= 8 * 1024 * 1024, 'Source budget exceeded');
    source.set(path, bytes);
  }
  await visit('src');
  return source;
}

async function regular(path) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && await realpath(path) === path, 'Resource output must be an independent regular file: ' + path);
  assert.ok(info.size <= 1024 * 1024, 'Resource output byte budget exceeded');
  return readFile(path);
}

/** Refuse linked compiler destinations before TypeScript can write through them. */
export async function assertPluginOutput(target) {
  let visited = 0;
  async function visit(path, depth = 0) {
    assert.ok(++visited <= 4096 && depth <= 32, 'Plugin output directory budget exceeded');
    let info;
    try { info = await lstat(path); } catch (error) { if (depth === 0 && error.code === 'ENOENT') return; throw error; }
    assert.ok(!info.isSymbolicLink() && await realpath(path) === path, 'Plugin output directory cannot be a link');
    if (info.isDirectory()) for (const name of await readdir(path)) await visit(join(path, name), depth + 1);
    else assert.ok(depth > 0 && info.isFile() && info.nlink === 1, 'Plugin output must contain independent regular files');
  }
  await visit(target);
}

/** Preserve layout relative to source; remove only unchanged resources owned by this manifest. */
export async function copyPluginResources(source, target) {
  const next = new Map();
  for (const [path, bytes] of source) {
    assert.ok(validPath(path) && path.startsWith('src/') && Buffer.isBuffer(bytes), 'Invalid resource snapshot');
    if (resource(path)) next.set(path.slice(4), bytes);
  }
  await assertPluginOutput(target);
  await mkdir(target, { recursive: true });
  const identity = await lstat(target);
  assert.ok(identity.isDirectory() && !identity.isSymbolicLink() && await realpath(target) === target, 'Resource output directory cannot be a link');
  const manifestPath = join(target, metadata), original = await regular(manifestPath);
  let previous = {};
  if (original) {
    const manifest = JSON.parse(original.toString());
    assert.ok(manifest && manifest.format === 'cormi:plugin-resources:1' && manifest.files && !Array.isArray(manifest.files) && typeof manifest.files === 'object', 'Invalid resource ownership manifest');
    previous = manifest.files;
    assert.ok(Object.keys(previous).length <= 256, 'Resource ownership budget exceeded');
    for (const [path, hash] of Object.entries(previous)) {
      assert.ok(validPath(path) && resource(path) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash), 'Invalid resource ownership entry');
      const bytes = await regular(join(target, path));
      assert.ok(bytes && digest(bytes) === hash, 'Previously generated resource changed; refusing overwrite: ' + path);
    }
  }
  // Validate every proposed path before updating any owned resource.
  for (const path of next.keys()) {
    const old = await regular(join(target, path));
    assert.ok(!old || Object.hasOwn(previous, path), 'Resource output is not owned: ' + path);
  }
  async function verify() {
    const current = await lstat(target);
    assert.ok(current.dev === identity.dev && current.ino === identity.ino && await realpath(target) === target, 'Resource output identity changed');
  }
  async function write(path, bytes) {
    await verify(); const full = join(target, path);
    await mkdir(dirname(full), { recursive: true });
    assert.equal(await realpath(dirname(full)), dirname(full), 'Resource output ancestor cannot be a link');
    const temp = join(dirname(full), '.cormi-asset-' + randomUUID());
    try { await writeFile(temp, bytes, { flag: 'wx' }); await verify(); await rename(temp, full); }
    finally { try { await unlink(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  for (const [path, bytes] of next) if (previous[path] !== digest(bytes)) await write(path, bytes);
  for (const path of Object.keys(previous)) if (!next.has(path)) { await verify(); await unlink(join(target, path)); }
  const bytes = Buffer.from(JSON.stringify({ format: 'cormi:plugin-resources:1', files: Object.fromEntries([...next].map(([path, data]) => [path, digest(data)])) }, null, 2) + '\n');
  if (!original?.equals(bytes)) await write(metadata, bytes);
  return { resources: next.size, sourceFiles: source.size };
}
`;

export const buildPluginScript = String.raw`import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPluginSource, copyPluginResources, assertPluginOutput } from './resources.mjs';
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
try { await lstat(join(root, '.cormi.lock')); throw new Error('Stop the active cormi session before building plugin output'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const source = await collectPluginSource(root);
await assertPluginOutput(join(root, 'dist'));
const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--rootDir', 'src', '--outDir', 'dist', '--noEmitOnError', 'true', '--noCheck', 'false', '--skipLibCheck', 'false'], { cwd: root, stdio: 'inherit', shell: false, timeout: 90000, killSignal: 'SIGKILL' });
if (result.error) throw result.error;
assert.equal(result.status, 0, 'Plugin compilation failed');
// Do not combine changed resource input with a compilation that read another source generation.
const current = await collectPluginSource(root);
assert.ok(current.size === source.size && [...source].every(([path, bytes]) => current.has(path) && bytes.equals(current.get(path))), 'Plugin source changed during build; run build again');
console.log(JSON.stringify(await copyPluginResources(source, join(root, 'dist'))));
`;
