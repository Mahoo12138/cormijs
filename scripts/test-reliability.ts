import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { nativeCycles } from './reliability/native.js';
import { launcherCycles } from './reliability/launcher.js';
import { generationBatches } from './reliability/generation.js';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ strict: true, options: { out: { type: 'string' }, cycles: { type: 'string' }, batches: { type: 'string' } } });
const cycles = Number(values.cycles ?? 20), batches = Number(values.batches ?? 100);
assert.ok(Number.isInteger(cycles) && cycles >= 1 && cycles <= 200, 'cycles must be 1..200');
assert.ok(Number.isInteger(batches) && batches >= 1 && batches <= 1000, 'batches must be 1..1000');
const out = resolve(values.out ?? join(workspace, '.cache', 'reliability-' + Date.now())); await mkdir(out);
const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi reliability 中文 ')));
const report: Record<string, unknown> = { format: 'cormi:reliability:1', passed: false, cycles, batches,
  baselineProfile: cycles >= 20 && batches >= 100, node: process.version, platform: process.platform + '-' + process.arch,
  startedAt: new Date().toISOString(), root, limitations: ['finite-sample', 'memory-observation-not-leak-proof', 'no-cross-platform-claim', 'no-browser-in-this-driver'] };
const save = () => writeFile(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
try {
  console.log('RELIABILITY native'); report.native = await nativeCycles(join(root, 'native'), cycles); await save();
  console.log('RELIABILITY launcher'); report.launcher = await launcherCycles(join(root, 'launcher'), workspace, cycles, batches); await save();
  console.log('RELIABILITY generation'); report.generation = await generationBatches(join(root, 'generation'), batches); await save();
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); await save();
  if (report.passed) await rm(root, { recursive: true });
  console.log(JSON.stringify({ passed: report.passed, result: join(out, 'result.json'), error: report.error, retained: report.passed ? undefined : root }));
}
