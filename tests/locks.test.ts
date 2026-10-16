import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { acquireProject, verifyLease } from '../packages/cormi/dist/lock.js';
import { fixture, hasCode } from './helpers.js';

test('project lock is exclusive, lease-checked and idempotently released', async () => {
  const f = await fixture();
  try {
    const lease = acquireProject(f.root); verifyLease(lease.root, lease.token);
    assert.throws(() => acquireProject(f.root), hasCode('PROJECT_BUSY'));
    assert.throws(() => verifyLease(lease.root, 'wrong'), hasCode('LOCK_OWNERSHIP_LOST'));
    lease.release(); lease.release();
    const next = acquireProject(f.root); assert.notEqual(next.token, lease.token); next.release();
  } finally { await f.clean(); }
});

test('a changed lock token is never deleted by an old owner', async () => {
  const f = await fixture();
  try {
    const lease = acquireProject(f.root); const owner = join(f.root, '.cormi.lock/owner.json');
    const original = await readFile(owner, 'utf8'); await writeFile(owner, JSON.stringify({ token: 'other' }));
    assert.throws(() => lease.release(), hasCode('LOCK_OWNERSHIP_LOST')); assert.equal(existsSync(owner), true);
    await writeFile(owner, original); lease.release();
  } finally { await f.clean(); }
});

test('symlink lock targets and apparent stale locks are not reclaimed', async () => {
  const f = await fixture(); const other = await fixture();
  try {
    await symlink(other.root, join(f.root, '.cormi.lock'), 'dir');
    assert.throws(() => acquireProject(f.root), hasCode('PROJECT_BUSY'));
    assert.equal(existsSync(join(other.root, 'index.html')), true);
    await rm(join(f.root, '.cormi.lock')); await mkdir(join(f.root, '.cormi.lock'));
    await writeFile(join(f.root, '.cormi.lock/owner.json'), JSON.stringify({ pid: -1, createdAt: '1970-01-01', token: 'stale' }));
    assert.throws(() => acquireProject(f.root), hasCode('PROJECT_BUSY'));
  } finally { await f.clean(); await other.clean(); }
});

test('alias roots lock the same canonical project; different projects remain independent', async () => {
  const f = await fixture(); const other = await fixture();
  try {
    const alias = join(other.root, 'alias'); await symlink(f.root, alias, 'dir');
    const first = acquireProject(f.root); const second = acquireProject(other.root);
    try { assert.throws(() => acquireProject(alias), hasCode('PROJECT_BUSY')); }
    finally { first.release(); second.release(); }
  } finally { await f.clean(); await other.clean(); }
});
