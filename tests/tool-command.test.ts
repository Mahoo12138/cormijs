import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nodeScriptCommand, pnpmCommand } from '../scripts/tool-command.js';
const exec = promisify(execFile);
test('explicit pnpm configuration rejects a .cmd shim rather than silently selecting another executable', () => {
  assert.throws(() => pnpmCommand([], { CORMI_PNPM_CLI: join(tmpdir(), 'pnpm.cmd') }), /JS entry/);
  assert.throws(() => pnpmCommand([], { CORMI_PNPM_CLI: 'pnpm.cjs' }), /absolute/);
});
test('native Node argv preserves spaces, Unicode, quotes and shell metacharacters as data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cormi command 中文 '));
  try {
    const script = join(root, 'args.cjs'); await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const args = ['', 'two words', '中文', 'a&b', '%PATH%', '!bang!', '$(touch ignored)', 'quote"x', 'tail\\'];
    const c = nodeScriptCommand(script, args); const result = await exec(c.executable, c.args, { timeout: 5000 });
    assert.deepEqual(JSON.parse(result.stdout), args);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('command plans copy argv, reject relative scripts and reject NUL', () => {
  const args = ['initial'], c = nodeScriptCommand(join(tmpdir(), 'tool.cjs'), args); args.push('later');
  assert.equal(c.args.length, 2); assert.throws(() => nodeScriptCommand('relative.cjs', []));
  assert.throws(() => nodeScriptCommand(join(tmpdir(), 'tool.cjs'), ['bad\0arg']));
});
test('pnpm automation uses a verified JS entry instead of concatenating a .cmd command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cormi pnpm '));
  try {
    const entry = join(root, 'pnpm.cjs'); await writeFile(entry, '');
    assert.deepEqual(pnpmCommand(['pack', '--out', '中文 & path'], { CORMI_PNPM_CLI: entry }), { executable: process.execPath, args: [entry, 'pack', '--out', '中文 & path'] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
