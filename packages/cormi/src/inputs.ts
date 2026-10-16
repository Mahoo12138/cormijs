import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Fingerprint exact files, including absent candidates, without evaluating modules. */
export async function fingerprint(files: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    hash.update(file); hash.update('\0');
    try { hash.update('file\0'); hash.update(await readFile(file)); }
    catch (error) { hash.update(`error\0${(error as NodeJS.ErrnoException).code}`); }
    hash.update('\0');
  }
  return hash.digest('hex');
}
