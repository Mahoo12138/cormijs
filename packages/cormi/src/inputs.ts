import { lstat, readFile, readlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Fingerprint exact files, including absent candidates, without evaluating modules. */
export async function fingerprint(files: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    hash.update(file); hash.update('\0');
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink()) { hash.update('link\0'); hash.update(await readlink(file)); }
      else if (!info.isFile() || info.nlink !== 1 || info.size > 16 * 1024 * 1024) hash.update(`non-file-or-oversize\0${info.mode}:${info.ino}:${info.size}:${info.mtimeMs}`);
      else { hash.update('file\0'); hash.update(await readFile(file)); }
    }
    catch (error) { hash.update(`error\0${(error as NodeJS.ErrnoException).code}`); }
    hash.update('\0');
  }
  return hash.digest('hex');
}
