import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rename, rm, realpath, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, type } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { acquireProject } from '../../packages/cormi/src/lock.js';

// Never simulate Windows by mutating process.platform or turn this suite into skipped green tests.
assert.equal(process.platform, 'win32', 'Native Windows required'); assert.equal(type(), 'Windows_NT');
const options = { timeout: 15000 };
async function fixture(t: import('node:test').TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi windows 中文 ')));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
test('Windows native paths and file URLs round-trip spaces, Unicode and hash characters', options, async t => {
  const root = await fixture(t), file = join(root, '中文 # file.txt'); await writeFile(file, 'native');
  assert.equal(fileURLToPath(pathToFileURL(file)), file); assert.equal(await readFile(pathToFileURL(file), 'utf8'), 'native');
  t.diagnostic(JSON.stringify({ platform: process.platform, arch: process.arch, root }));
});
test('Windows directory replacement uses real filesystem operations and retains old content until rename', options, async t => {
  const root = await fixture(t); const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'dist')); await mkdir(join(root, 'staging'));
  await writeFile(join(root, 'dist/index.html'), 'old'); await writeFile(join(root, 'staging/index.html'), 'new');
  assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), 'old');
  await rename(join(root, 'dist'), join(root, 'previous')); await rename(join(root, 'staging'), join(root, 'dist'));
  assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), 'new'); assert.equal(await readFile(join(root, 'previous/index.html'), 'utf8'), 'old');
});
test('Windows junction aliases contend for the same actual cormi project lease', options, async t => {
  const root = await fixture(t), alias = root + '-junction';
  await symlink(root, alias, 'junction'); t.after(() => rm(alias, { force: true, recursive: true }));
  const lease = acquireProject(root);
  try { assert.throws(() => acquireProject(alias), (e: any) => e.code === 'PROJECT_BUSY'); }
  finally { lease.release(); }
  assert.equal(existsSync(join(root, '.cormi.lock')), false);
});
test('installed Windows cormi.cmd shim launches through the real command processor', options, async () => {
  const shim = resolve('node_modules/.bin/cormi.cmd'); assert.ok(existsSync(shim), 'Windows package-manager shim required');
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/cmd.exe');
  const result = await new Promise<{ code: number | null; text: string }>((resolveResult, reject) => {
    // The command text is fixed; the trusted shim path travels via a quoted environment expansion.
    const child = spawn(executable, ['/d', '/s', '/c', '""%CORMI_NATIVE_SHIM%" --help"'], { windowsVerbatimArguments: true,
      env: { ...process.env, CORMI_NATIVE_SHIM: shim }, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = ''; const timeout = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.stdout.on('data', x => { text += x; }); child.stderr.on('data', x => { text += x; });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => { clearTimeout(timeout); resolveResult({ code, text }); });
  });
  assert.equal(result.code, 0, result.text); assert.match(result.text, /cormi <command>/);
});
test('Windows FileShare.None blocks rename until the actual handle owner releases it', options, async t => {
  const root = await fixture(t), file = join(root, 'locked.txt'); await writeFile(file, 'keep');
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = '$ErrorActionPreference="Stop";$f=[System.IO.File]::Open($env:CORMI_NATIVE_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None);try{[Console]::WriteLine("LOCKED");[Console]::Out.Flush();[Console]::ReadLine()|Out-Null}finally{$f.Dispose()}';
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, CORMI_NATIVE_FILE: file }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '', ended = false;
  const done = new Promise<number | null>((resolveDone, reject) => { child.once('error', reject); child.once('close', code => { ended = true; resolveDone(code); }); }); void done.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolveReady, reject) => {
      timer = setTimeout(() => reject(new Error('FileShare.None acquisition timeout: ' + output + errors)), 8000);
      child.stdout.on('data', x => { output += x; if (output.includes('LOCKED')) resolveReady(); }); child.stderr.on('data', x => { errors += x; });
      child.once('error', reject); child.once('close', () => reject(new Error('Handle owner exited before readiness: ' + errors)));
    }); clearTimeout(timer);
    await assert.rejects(rename(file, join(root, 'renamed.txt')), (error: any) => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code));
    child.stdin.end('release\n');
    timer = setTimeout(() => { if (!ended) child.kill('SIGKILL'); }, 5000);
    assert.equal(await done, 0, errors); clearTimeout(timer);
    await rename(file, join(root, 'renamed.txt')); assert.equal(await readFile(join(root, 'renamed.txt'), 'utf8'), 'keep');
  } finally { clearTimeout(timer); if (!ended) child.kill('SIGKILL'); await done; }
});
