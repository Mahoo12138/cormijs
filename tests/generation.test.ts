import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, stat, symlink, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { AtomicEntry, RevisionQueue, GENERATED_HEADER } from '@cormijs/plugin-web';
import { fixture, gate, hasCode } from './helpers.js';

test('single entry publication is atomic, unchanged content preserves mtime', async () => {
  const f = await fixture();
  try {
    const writer = await AtomicEntry.open(f.root), file = join(f.root, '.cormi/app.tsx');
    assert.equal(await writer.publish('const a = 1;', () => true), true);
    const old = await stat(file); assert.equal(await writer.publish('const a = 1;', () => true), false);
    assert.equal((await stat(file)).mtimeMs, old.mtimeMs);
    await assert.rejects(writer.publish('const a = 2;', () => false), hasCode('STALE_GENERATION'));
    assert.equal(await readFile(file, 'utf8'), GENERATED_HEADER + 'const a = 1;');
    assert.deepEqual(await readdir(join(f.root, '.cormi')), ['app.tsx']);
  } finally { await f.clean(); }
});
test('unowned entries and symlink directories are not overwritten', async () => {
  const f = await fixture();
  try {
    const writer = await AtomicEntry.open(f.root), file = join(f.root, '.cormi/app.tsx');
    await writeFile(file, 'USER FILE');
    await assert.rejects(writer.publish('replacement', () => true), hasCode('GENERATED_NOT_OWNED'));
    assert.equal(await readFile(file, 'utf8'), 'USER FILE');
  } finally { await f.clean(); }
  const g = await fixture();
  try { await mkdir(join(g.root, 'target')); await symlink(join(g.root, 'target'), join(g.root, '.cormi')); await assert.rejects(AtomicEntry.open(g.root), hasCode('GENERATED_PATH_INVALID')); }
  finally { await g.clean(); }
});
test('a replaced generation directory is rejected before unchanged fast paths or temporary writes', async () => {
  const f = await fixture();
  try {
    const writer = await AtomicEntry.open(f.root);
    await writer.publish('same content', () => true);
    await rename(join(f.root, '.cormi'), join(f.root, 'saved'));
    await symlink(join(f.root, 'saved'), join(f.root, '.cormi'), 'dir');
    await assert.rejects(writer.publish('same content', () => true), hasCode('GENERATED_PATH_INVALID'));
    await assert.rejects(writer.publish('different content', () => true), hasCode('GENERATED_PATH_INVALID'));
    assert.deepEqual(await readdir(join(f.root, 'saved')), ['app.tsx']);
  } finally { await f.clean(); }
});
test('100 rapid inputs coalesce; noncooperative old work cannot publish over latest input', async () => {
  const blocked = gate(); const commits: number[] = [];
  const queue = new RevisionQueue<number>(async (value, current) => { assert.ok(current()); commits.push(value); return true; });
  const first = queue.enqueue(async () => { await blocked.promise; return 0; });
  const pending = Array.from({ length: 100 }, (_, i) => queue.enqueue(async () => i + 1));
  blocked.resolve(); const results = await Promise.all([first, ...pending]);
  assert.deepEqual(commits, [100]); assert.equal(results.at(-1)?.status, 'changed');
  assert.equal(results.filter(result => result.status === 'superseded').length, 100); await queue.close();
});
test('closing a queue cancels active and pending commits, without claiming forced cancellation', async () => {
  const blocked = gate(); let committed = false;
  const queue = new RevisionQueue<number>(async () => { committed = true; return true; });
  const first = queue.enqueue(async () => { await blocked.promise; return 1; });
  const second = queue.enqueue(async () => 2); const closing = queue.close(); blocked.resolve();
  assert.equal((await first).status, 'superseded'); assert.equal((await second).status, 'superseded'); await closing;
  assert.equal(committed, false); await assert.rejects(queue.enqueue(async () => 3), hasCode('GENERATOR_CLOSED'));
});
test('failed compute preserves the last executable entry and the next generation recovers', async () => {
  const f = await fixture();
  try {
    const writer = await AtomicEntry.open(f.root), queue = new RevisionQueue<string>((value, current) => writer.publish(value, current));
    await queue.enqueue(async () => 'const version = 1;');
    await assert.rejects(queue.enqueue(async () => { throw new Error('syntax fault'); }), /syntax fault/);
    assert.match(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), /version = 1/);
    await queue.enqueue(async () => 'const version = 2;'); await queue.close();
    assert.match(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), /version = 2/);
  } finally { await f.clean(); }
});
test('the final publication guard notices an external write during temporary file IO', async () => {
  const f = await fixture();
  try {
    const writer = await AtomicEntry.open(f.root); await writer.publish('original', () => true);
    const writing = writer.publish('new', () => true);
    const rejected = assert.rejects(writing, hasCode('GENERATED_CONCURRENT_WRITE'));
    await writeFile(join(f.root, '.cormi/app.tsx'), GENERATED_HEADER + 'external'); await rejected;
    assert.equal(await readFile(join(f.root, '.cormi/app.tsx'), 'utf8'), GENERATED_HEADER + 'external');
  } finally { await f.clean(); }
});
