import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { windowsEnvironment } from '../scripts/windows/environment.js';
const exec = promisify(execFile);
test('Windows preflight reports the real process platform and never accepts a platform argument', () => {
  const env = windowsEnvironment(); assert.equal(env.platform, process.platform); assert.equal(env.processArch, process.arch);
  assert.equal(env.eligible, process.platform === 'win32' && env.osType === 'Windows_NT' && process.version === 'v22.14.0');
});
test('non-Windows native runner fails closed without creating success evidence or running native tests', async () => {
  const before = (await readdir('.cache')).filter(x => x.startsWith('windows-contracts-')).sort();
  let result: { stdout: string; code?: number };
  try { result = await exec(process.execPath, ['--import', 'tsx', 'scripts/test-windows.ts', '--probe'], { timeout: 5000 }); }
  catch (error) { result = error as typeof result; }
  const data = JSON.parse(result.stdout); assert.equal(data.nativeTestsRun, 0); assert.equal(data.supportVerified, false);
  assert.equal(data.platform, process.platform);
  if (process.platform !== 'win32') { assert.equal(data.status, 'blocked'); assert.equal(result.code, 2); }
  assert.deepEqual((await readdir('.cache')).filter(x => x.startsWith('windows-contracts-')).sort(), before);
});
