import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { checked, sha256 } from './packaging.js';
import { createSnapshot, verifySnapshot, type SourceSnapshot } from './linux/snapshot.js';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
assert.ok(!root.includes(','), 'Docker mount source paths containing commas are not supported by this driver');
const parsed = parseArgs({ strict: true, options: { image: { type: 'string' } } });
if (parsed.values.image) assert.match(parsed.values.image, /^sha256:[0-9a-f]{64}$/, 'An explicitly reused image must be an immutable local image ID');
assert.ok(process.platform === 'darwin' || process.platform === 'linux', 'This Docker driver has not been validated on Windows');
const docker = process.env.CORMI_DOCKER ?? 'docker';
await mkdir(join(root, '.cache'), { recursive: true });
const output = await mkdtemp(join(root, '.cache/linux-run-'));
const token = randomUUID(), name = 'cormi-linux-' + token;
let active: ChildProcess | undefined, interrupted = false, container: string | undefined, snapshot: SourceSnapshot | undefined;
const stop = () => { interrupted = true; active?.kill('SIGTERM'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
const report: Record<string, unknown> = { format: 'cormi:linux-run:1', passed: false, startedAt: new Date().toISOString(), commands: [], output };
async function command(label: string, args: string[], timeout = 120000, cleanup = false) {
  if (interrupted && !cleanup) throw new Error('Linux validation interrupted');
  const result = await new Promise<{ code: number; text: string }>((done, fail) => {
    const child = active = spawn(docker, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '', failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error(`Docker command timeout: ${label}`); child.kill('SIGKILL'); }, timeout);
    const collect = (chunk: Buffer) => { if (text.length < 8 * 1024 * 1024) text += chunk.toString(); else { failure = new Error('Docker output limit exceeded'); child.kill('SIGKILL'); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); if (active === child) active = undefined; fail(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); if (active === child) active = undefined;
      if (failure || signal) fail(failure ?? new Error(`Docker command terminated: ${signal}`)); else done({ code: code ?? 1, text }); });
  });
  await writeFile(join(output, label + '.log'), result.text);
  (report.commands as unknown[]).push({ label, args, code: result.code, sha256: sha256(result.text) });
  console.log(label, 'EXIT', result.code);
  assert.equal(result.code, 0, result.text.slice(-18000)); return result.text.trim();
}
try {
  report.baseline = (await checked('git', ['rev-parse', 'HEAD'], root)).trim();
  const names = (await checked('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root)).split('\0').filter(Boolean);
  snapshot = await createSnapshot(root, join(output, 'input'), names); report.snapshot = snapshot;
  let image = parsed.values.image;
  if (!image) {
    await command('image-build', ['build', '--progress=plain', '--iidfile', join(output, 'image-id'), join(output, 'input/source/scripts/linux')], 900000);
    image = (await readFile(join(output, 'image-id'), 'utf8')).trim();
  }
  assert.match(image, /^sha256:[0-9a-f]{64}$/); report.imageId = image;
  report.engine = JSON.parse(await command('engine', ['version', '--format', '{{json .Server}}']));
  container = await command('create', ['create', '--init', '--name', name, '--label', 'io.cormi.validation=' + token,
    '--network', 'bridge', '--user', 'node', '--cpus', '2', '--memory', '3g', '--shm-size', '512m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', `type=bind,source=${join(output, 'input')},target=/input,readonly`, image]);
  assert.match(container, /^[0-9a-f]{64}$/);
  await command('start', ['start', container]);
  await command('install', ['exec', container, 'sh', '-c', 'cp -R /input/source/. /home/node/work/ && pnpm install --frozen-lockfile --ignore-scripts'], 600000);
  await command('cache-prepare', ['exec', container, 'sh', '-c', 'pnpm build && node --import tsx scripts/linux/warm-cache.ts'], 600000);
  await command('disconnect', ['network', 'disconnect', 'bridge', container]);
  const isolation = JSON.parse(await command('isolation', ['inspect', '--format', '{{json .}}', container]));
  assert.equal(isolation.Config.User, 'node'); assert.deepEqual(isolation.NetworkSettings.Networks, {});
  assert.ok(!isolation.HostConfig.Privileged && isolation.HostConfig.Init);
  assert.equal(isolation.Mounts.length, 1); assert.equal(isolation.Mounts[0].Destination, '/input'); assert.equal(isolation.Mounts[0].RW, false);
  assert.equal(Object.keys(isolation.HostConfig.PortBindings ?? {}).length, 0);
  report.isolation = { nonRoot: true, init: true, externalNetworks: 0, publishedPorts: 0, hostMounts: [{ target: '/input', readOnly: true }], nativeContainerWorkspace: '/home/node/work' };
  await command('verify', ['exec', container, 'node', '--import', 'tsx', 'scripts/linux/verify.ts'], 900000);
  await verifySnapshot(root, snapshot, true); report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; console.error(report.error); }
finally {
  if (container) {
    try { await command('evidence-copy', ['cp', container + ':/home/node/work/.cache/linux-evidence', join(output, 'results')], 30000, true); }
    catch (error) { report.evidenceCopyError = String(error); report.passed = false; process.exitCode = 1; }
    try { await command('cleanup', ['rm', '--force', container], 30000, true); report.containerRemoved = true; }
    catch (error) { report.cleanupError = String(error); report.passed = false; process.exitCode = 1; }
  }
  if (snapshot) try { await verifySnapshot(root, snapshot, true); report.hostSourceUnchanged = true; }
  catch (error) { report.sourceError = String(error); report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
  console.log(JSON.stringify({ passed: report.passed, result: join(output, 'result.json'), containerRemoved: report.containerRemoved }));
}
