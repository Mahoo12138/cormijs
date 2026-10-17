import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { sha256 } from '../packaging.js';

export interface SourceSnapshot { format: 'cormi:source-snapshot:1'; files: Record<string, string> }
const rootFiles = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.nvmrc', 'tsconfig.json', 'tsconfig.base.json']);
/** Allow only build/test inputs. Never copy the repository, home directory, or node_modules wholesale. */
export function sourcePath(file: string): boolean {
  assert.ok(file && !isAbsolute(file) && !/[\\:\x00-\x1f\x7f]/.test(file) && file.split('/').every(x => x && x !== '.' && x !== '..'), 'Unsafe snapshot path');
  if (rootFiles.has(file)) return true;
  if (!/^(packages|examples|tests|scripts|patches)\//.test(file)) return false;
  const parts = file.split('/');
  assert.ok(!parts.some(x => x.startsWith('.') || /^(?:node_modules|dist|coverage|id_rsa|id_ed25519)$/.test(x))
    && !/\.(?:pem|key|p12|pfx|crt|cer|der|tsbuildinfo|log)$/i.test(file), `Private/generated snapshot input: ${file}`);
  return /\.(?:ts|tsx|js|mjs|cjs|json|yaml|html|css|patch)$/.test(file) || file === 'scripts/linux/Dockerfile' || file === 'patches/CORDIS-LICENSE';
}
export async function createSnapshot(root: string, destination: string, candidates: readonly string[]): Promise<SourceSnapshot> {
  root = await realpath(root);
  const sources = [...new Set(candidates)].filter(sourcePath).sort();
  assert.ok(sources.length && sources.length <= 5000, 'Invalid source snapshot size');
  const data = new Map<string, { bytes: Buffer; mode: number }>(); let size = 0;
  for (const file of sources) {
    const path = join(root, file), stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, `Snapshot input must be a regular independent file: ${file}`);
    assert.equal(await realpath(path), path, `Snapshot ancestor must not be a link: ${file}`);
    size += stat.size; assert.ok(stat.size <= 4 * 1024 * 1024 && size <= 32 * 1024 * 1024, 'Snapshot budget exceeded');
    data.set(file, { bytes: await readFile(path), mode: stat.mode & 0o777 });
  }
  // Host .npmrc is intentionally excluded. Use this reviewed configuration inside the disposable Linux workspace.
  data.set('.npmrc', { bytes: Buffer.from('save-exact=true\nstore-dir=.cache/pnpm-store\ncache-dir=.cache/pnpm-cache\nstate-dir=.cache/pnpm-state\nauto-install-peers=false\nmanage-package-manager-versions=false\n'), mode: 0o644 });
  await mkdir(destination);
  const files: Record<string, string> = {};
  for (const [file, value] of data) {
    const target = join(destination, 'source', file); await mkdir(dirname(target), { recursive: true });
    await writeFile(target, value.bytes, { flag: 'wx' }); await chmod(target, value.mode);
    files[file] = sha256(value.bytes);
  }
  const snapshot: SourceSnapshot = { format: 'cormi:source-snapshot:1', files };
  await writeFile(join(destination, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
  return snapshot;
}
export async function verifySnapshot(root: string, snapshot: SourceSnapshot, host = false): Promise<void> {
  for (const [file, hash] of Object.entries(snapshot.files)) {
    if (host && file === '.npmrc') continue;
    assert.ok(file === '.npmrc' || sourcePath(file), 'Unexpected manifest input');
    const target = join(root, file), local = relative(root, target);
    assert.ok(local && !local.startsWith(`..${sep}`));
    const stat = await lstat(target);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Snapshot path changed: ${file}`);
    assert.equal(await realpath(target), target, `Snapshot ancestor changed: ${file}`);
    assert.equal(sha256(await readFile(target)), hash, `Source changed during validation: ${file}`);
  }
}
