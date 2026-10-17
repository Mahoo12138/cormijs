import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packWorkspace, consumerManifest, consumerNpmrc, run, sha256 } from '../packaging.js';

// Preparation only. Full functional acceptance remains offline after Docker disconnects the network.
assert.equal(process.platform, 'linux');
const root = await realpath(process.cwd()), temporary = await mkdtemp(join(tmpdir(), 'cormi-cache-seed-'));
const output = join(root, '.cache/linux-evidence'); await mkdir(output, { recursive: true });
const env = { ...process.env, CI: 'true', NODE_PATH: '', NODE_OPTIONS: '',
  npm_config_store_dir: join(root, '.cache/pnpm-store'), npm_config_cache_dir: join(root, '.cache/pnpm-cache'),
  npm_config_state_dir: join(temporary, 'state'), npm_config_ignore_scripts: 'true', npm_config_package_import_method: 'copy' };
const stages: Array<Record<string, unknown>> = [];
try {
  const kit = await packWorkspace(root, join(temporary, 'kit'));
  for (const profile of ['raw', 'core', 'launcher', 'sdk', 'react'] as const) {
    const cwd = join(temporary, 'kit', profile); await mkdir(cwd);
    const manifest = consumerManifest(kit, profile === 'raw' ? 'core' : profile === 'sdk' ? 'react' : profile, profile !== 'raw');
    if (profile === 'sdk') Object.assign(manifest.dependencies, manifest.pnpm.overrides);
    await writeFile(join(cwd, 'package.json'), JSON.stringify(manifest)); await writeFile(join(cwd, '.npmrc'), consumerNpmrc);
    const result = await run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], cwd, env, 180000);
    const text = result.stdout + result.stderr; await writeFile(join(output, 'warm-' + profile + '.log'), text);
    stages.push({ profile, code: result.code, sha256: sha256(text) });
    assert.equal(result.code, 0, text.slice(-8000));
    const lock = await readFile(join(cwd, 'pnpm-lock.yaml')); await writeFile(join(output, 'warm-' + profile + '-lock.yaml'), lock);
    stages.at(-1)!.lockSha256 = sha256(lock); console.log('CACHE_PREPARED', profile);
  }
} finally {
  await writeFile(join(output, 'warm-cache.json'), JSON.stringify({ purpose: 'online-cache-preparation-not-functional-validation', stages }, null, 2) + '\n');
  await rm(temporary, { recursive: true, force: true });
}
