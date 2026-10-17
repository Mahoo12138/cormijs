import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { networkInterfaces, release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, sha256 } from '../packaging.js';
import { verifySnapshot, type SourceSnapshot } from './snapshot.js';

const root = await import('node:fs/promises').then(fs => fs.realpath(process.cwd()));
const output = join(root, '.cache/linux-evidence'); await mkdir(output, { recursive: true });
const snapshot = JSON.parse(await readFile('/input/snapshot.json', 'utf8')) as SourceSnapshot;
const report: { passed: boolean; startedAt: string; environment: Record<string, unknown>; commands: Array<Record<string, unknown>>; sources: SourceSnapshot; error?: string } = {
  passed: false, startedAt: new Date().toISOString(), environment: {}, commands: [], sources: snapshot,
};
async function command(label: string, args: string[], tests = false, timeout = 180000) {
  await verifySnapshot(root, snapshot);
  const result = await run(args[0]!, args.slice(1), root, process.env, timeout), text = result.stdout + result.stderr;
  const log = label + '.log'; await writeFile(join(output, log), text);
  const counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|cancelled|skipped) (\d+)$/gm)].map(m => [m[1]!, Number(m[2])]));
  report.commands.push({ label, args, code: result.code, log, sha256: sha256(text), counts });
  console.log(label, 'EXIT', result.code, counts);
  await verifySnapshot(root, snapshot);
  if (label.startsWith('package-')) {
    const path = /"result":\s*"([^"]+)"/.exec(text)?.[1]; assert.ok(path && path.startsWith(join(root, '.cache/package-test-')));
    const content = JSON.parse(await readFile(path, 'utf8'));
    await cp(resolve(path, '..'), join(output, label), { recursive: true });
    assert.equal(content.passed, true, text.slice(-14000));
    assert.ok(content.stages.some((s: { label: string }) => s.label === 'relocated-clean-install'));
    report.commands.at(-1)!.packageStages = content.stages.length;
  }
  assert.equal(result.code, 0, text.slice(-14000));
  if (tests) { assert.ok(counts.tests! > 0); assert.equal(counts.pass, counts.tests); for (const key of ['fail', 'cancelled', 'skipped']) assert.equal(counts[key], 0); }
}
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.version, 'v22.14.0');
  assert.ok(process.getuid && process.getuid() !== 0, 'Use an unprivileged container user');
  assert.ok(Object.values(networkInterfaces()).flat().every(info => info?.internal), 'External networking must be disconnected before verification');
  const probe = await mkdtemp(join(tmpdir(), 'cormi-case-'));
  try { await writeFile(join(probe, 'Case'), 'upper'); await writeFile(join(probe, 'case'), 'lower'); assert.equal(await readFile(join(probe, 'Case'), 'utf8'), 'upper'); }
  finally { await rm(probe, { recursive: true }); }
  report.environment = { platform: process.platform, arch: process.arch, node: process.version, kernel: release(), uid: process.getuid(),
    init: (await readFile('/proc/1/comm', 'utf8')).trim(), os: await readFile('/etc/os-release', 'utf8'), fsType: (await statfs(root)).type,
    networkIsolated: true, caseSensitive: true, browser: (await run('/usr/bin/chromium', ['--version'], root)).stdout.trim(),
    pnpm: (await run('pnpm', ['--version'], root)).stdout.trim() };
  assert.equal(report.environment.pnpm, '10.6.3');
  const font = await run('fc-match', ['-f', '%{family}', ':lang=zh-cn'], root);
  assert.equal(font.code, 0); assert.match(font.stdout, /Noto.*CJK/, 'Chinese rendering requires a CJK-capable font');
  report.environment.cjkFont = font.stdout;
  await command('offline-install', ['pnpm', 'install', '--offline', '--frozen-lockfile', '--ignore-scripts']);
  await command('check', ['pnpm', 'check'], true);
  await command('browser', ['pnpm', 'test:browser'], true);
  await command('package-1', ['pnpm', 'test:package']);
  await command('package-2', ['pnpm', 'test:package']);
  await command('lifecycle-repeat', ['node', '--import', 'tsx', '--test', '--test-concurrency=1', 'tests/launcher-recovery.test.ts', 'tests/development-lifecycle.test.ts', 'tests/publication.test.ts', 'tests/vite-dev.test.ts'], true);
  await command('example-types', ['pnpm', 'typecheck:example']);
  await command('strict-types', ['node', 'node_modules/typescript/bin/tsc', '-p', 'packages/plugin-vite', '--noEmit', '--skipLibCheck', 'false']);
  await command('demo', ['pnpm', 'demo']);
  await command('app-types', ['pnpm', 'cormi', 'typecheck', '--root', 'examples/basic', '--startup-timeout', '30000']);
  await command('inspect', ['pnpm', 'cormi', 'inspect', '--root', 'examples/basic', '--json']);
  await verifySnapshot(root, snapshot); report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; console.error(report.error); }
finally { await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ passed: report.passed, result: join(output, 'result.json') })); }
