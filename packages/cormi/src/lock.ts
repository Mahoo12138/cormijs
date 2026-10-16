import { lstatSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, realpathSync, constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CormiError } from '@cormijs/core';

export interface ProjectLease { readonly root: string; readonly token: string; release(): void }
/** Conservative, exclusive lock. Stale locks are never reclaimed by PID or elapsed time. */
export function acquireProject(rootInput: string): ProjectLease {
  const root = realpathSync(rootInput); const directory = join(root, '.cormi.lock');
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new CormiError('PROJECT_BUSY', `Project is locked: ${root}`, { lock: directory }, { cause });
    throw cause;
  }
  const identity = lstatSync(directory); const token = randomUUID(); const owner = join(directory, 'owner.json');
  try {
    writeFileSync(owner, JSON.stringify({ version: 1, token, pid: process.pid, root, createdAt: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) { rmdirSync(directory); throw error; }
  let released = false;
  return Object.freeze({ root, token, release() {
    if (released) return;
    const current = lstatSync(directory);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new CormiError('LOCK_OWNERSHIP_LOST', 'Lock directory identity changed; refusing removal.');
    const fd = openSync(owner, constants.O_RDONLY | constants.O_NOFOLLOW);
    let data: { token?: string };
    try { data = JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    if (data.token !== token) throw new CormiError('LOCK_OWNERSHIP_LOST', 'Lock owner changed; refusing removal.');
    unlinkSync(owner); rmdirSync(directory); released = true;
  } });
}
export function verifyLease(root: string, token: string): void {
  const directory = join(root, '.cormi.lock');
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new CormiError('LOCK_OWNERSHIP_LOST', 'Invalid project lease.');
  const fd = openSync(join(directory, 'owner.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const data = JSON.parse(readFileSync(fd, 'utf8'));
    if (data.token !== token || data.root !== root) throw new CormiError('LOCK_OWNERSHIP_LOST', 'Worker does not own this project lease.');
  } finally { closeSync(fd); }
}
