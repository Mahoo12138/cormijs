import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { windowsEnvironment } from './windows/environment.js';

const environment = windowsEnvironment();
const options = parseArgs({ strict: true, options: { probe: { type: 'boolean' } } });
if (!environment.eligible) {
  console.log(JSON.stringify({ status: 'blocked', nativeTestsRun: 0, supportVerified: false, ...environment }));
  process.exitCode = 2;
} else if (options.values.probe) {
  console.log(JSON.stringify({ status: 'eligible', nativeTestsRun: 0, supportVerified: false, ...environment }));
} else {
  const { run, sha256 } = await import('./packaging.js');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  await mkdir(join(root, '.cache'), { recursive: true });
  const output = await mkdtemp(join(root, '.cache/windows-contracts-'));
  const report: Record<string, any> = { format: 'cormi:windows-contracts:1', status: 'failed', startedAt: new Date().toISOString(), environment,
    supportVerified: false, coverage: 'native-contracts-only', pending: ['full-Node-regression', 'browser-and-Fast-Refresh', 'tarball-consumer', 'interactive-console-Ctrl-C', 'architecture-matrix'], commands: [] };
  const source = async () => {
    const list = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root);
    assert.equal(list.code, 0, list.stderr);
    const paths = [...new Set(list.stdout.split('\0'))].filter(path => /^(?:packages|scripts|tests|patches|examples)\//.test(path) || /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.base)?\.json)$/.test(path)).sort();
    return Object.fromEntries(await Promise.all(paths.map(async path => [path, sha256(await readFile(join(root, path)))])));
  };
  try {
    const baseline = await source(); report.sources = baseline;
    for (const [label, executable, args] of [
      ['pnpm-version', 'pnpm', ['--version']],
      ['types-and-build', 'pnpm', ['typecheck']],
      ['native-contracts', process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', 'tests/windows/native.test.ts', 'tests/launcher-control.test.ts', 'tests/tool-command.test.ts']],
    ] as const) {
      const result = await run(executable, [...args], root, process.env, 180000), text = result.stdout + result.stderr;
      await writeFile(join(output, label + '.log'), text);
      const counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|cancelled|skipped) (\d+)\r?$/gm)].map(m => [m[1], Number(m[2])]));
      report.commands.push({ label, executable, args, code: result.code, counts, sha256: sha256(text) });
      assert.deepEqual(await source(), baseline, 'Source changed during native execution');
      assert.equal(result.code, 0, text.slice(-16000));
      if (label === 'pnpm-version') assert.equal(result.stdout.trim(), '10.6.3');
      if (label === 'native-contracts') {
        assert.ok(counts.tests >= 1); assert.equal(counts.pass, counts.tests);
        for (const name of ['fail', 'cancelled', 'skipped']) assert.equal(counts[name], 0);
        report.nativeTestsRun = counts.tests;
      }
    }
    report.status = 'passed';
  } catch (error) { report.error = String(error); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, coverage: report.coverage, nativeTestsRun: report.nativeTestsRun ?? 0, supportVerified: false, result: join(output, 'result.json') }));
  }
}
