import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { webPlugin } from '@cormijs/plugin-web';
import { vitePlugin } from '@cormijs/plugin-vite';
import { assertPortFree, fixture, gate, hasCode } from './helpers.js';

// node:test runs this file in a different process from dev tests: NODE_ENV is not shared.
const options = { timeout: 15000 };
function host() { const h = new ProjectRuntime(6000); h.mount('web', webPlugin); h.mount('vite', vitePlugin); return h; }

test('real build and preview support base paths and deep-link fallback', options, async () => {
  const f = await fixture('/demo/'); const h = host();
  try {
    await h.ready(); const output = await h.ctx.web.build({ ...f.plan, mode: 'production' });
    assert.equal(output.backend, 'vite'); assert.match(await readFile(join(output.outDir, 'index.html'), 'utf8'), /\/demo\/assets\//);
    const preview = await h.ctx.web.preview(f.plan); const port = Number(new URL(preview.url).port);
    const response = await fetch(new URL('/demo/users/42', preview.url)); assert.equal(response.status, 200); assert.match(await response.text(), /Cormi/);
    await preview.close(); await assertPortFree(port);
  } finally { await h.dispose(); await f.clean(); }
});

test('an existing output directory is never cleared or overwritten', options, async () => {
  const f = await fixture(); const h = host();
  await mkdir(join(f.root, 'dist')); await writeFile(join(f.root, 'dist', 'keep.txt'), 'user owned');
  try {
    await h.ready(); await assert.rejects(h.ctx.web.build(f.plan), hasCode('OUTPUT_NOT_FRESH'));
    assert.equal(await readFile(join(f.root, 'dist', 'keep.txt'), 'utf8'), 'user owned');
  } finally { await h.dispose(); await f.clean(); }
});

test('escaping output paths and output symlinks are refused without deleting targets', options, async () => {
  const f = await fixture(); const external = await fixture(); const h = host();
  await symlink(external.root, join(f.root, 'linked'), 'dir');
  try {
    await h.ready(); await assert.rejects(h.ctx.web.build({ ...f.plan, outDir: '../elsewhere' }), hasCode('OUTPUT_PATH_INVALID'));
    await assert.rejects(h.ctx.web.build({ ...f.plan, outDir: 'linked' }), hasCode('OUTPUT_PATH_INVALID'));
    assert.match(await readFile(join(external.root, 'index.html'), 'utf8'), /Cormi/);
  } finally { await h.dispose(); await f.clean(); await external.clean(); }
});

test('build failure is observable and cannot be disguised as a successful result', options, async () => {
  const f = await fixture(); const h = host();
  await writeFile(join(f.root, 'main.ts'), 'import "./does-not-exist.ts";');
  try { await h.ready(); await assert.rejects(h.ctx.web.build(f.plan), /resolve|exist/i); }
  finally { await h.dispose(); await f.clean(); }
});

test('already-aborted build performs no output write', options, async () => {
  const f = await fixture(); const h = host(); const cancel = new AbortController(); const reason = new Error('cancel-before-start'); cancel.abort(reason);
  try {
    await h.ready(); await assert.rejects(h.ctx.web.build(f.plan, cancel.signal), error => error === reason);
    assert.equal((await readdir(f.root)).includes('dist'), false);
  } finally { await h.dispose(); await f.clean(); }
});

test('cancel during native build waits for work to settle and rejects its late result', options, async () => {
  const f = await fixture(); const h = host(); const entered = gate(); const release = gate(); const cancel = new AbortController();
  h.mount('slow-build', { inject: ['vite'], apply: ctx => {
    ctx.effect(() => ctx.vite.add('slow-build', () => ({ name: 'slow-build', async buildStart() { entered.resolve(); await release.promise; } })));
  } });
  try {
    await h.ready(); const reason = new Error('cancel-in-flight');
    const task = h.ctx.web.build(f.plan, cancel.signal); const rejected = assert.rejects(task, error => error === reason);
    await entered.promise; cancel.abort(reason); release.resolve(); await rejected;
    assert.deepEqual((await readdir(f.root)).filter(x => x.startsWith('.cormi-vite-')), []);
  } finally { release.resolve(); await h.dispose(); await f.clean(); }
});

test('private environment values never enter the client asset while explicit public values do', options, async () => {
  const f = await fixture(); const h = host();
  const oldPrivate = process.env.CORMI_PRIVATE_TEST; const oldPublic = process.env.CORMI_PUBLIC_TEST;
  process.env.CORMI_PRIVATE_TEST = 'private-sentinel-never-publish'; process.env.CORMI_PUBLIC_TEST = 'public-sentinel-visible';
  await writeFile(join(f.root, 'main.ts'), 'console.log(import.meta.env.CORMI_PRIVATE_TEST, import.meta.env.CORMI_PUBLIC_TEST);');
  try {
    await h.ready(); const result = await h.ctx.web.build(f.plan); const files = await readdir(join(result.outDir, 'assets'));
    const text = (await Promise.all(files.map(file => readFile(join(result.outDir, 'assets', file), 'utf8')))).join('\n');
    assert.ok(text.includes('public-sentinel-visible')); assert.ok(!text.includes('private-sentinel-never-publish'));
    assert.ok(!text.includes('ProjectRuntime')); assert.ok(!text.includes('node:fs'));
  } finally {
    if (oldPrivate === undefined) delete process.env.CORMI_PRIVATE_TEST; else process.env.CORMI_PRIVATE_TEST = oldPrivate;
    if (oldPublic === undefined) delete process.env.CORMI_PUBLIC_TEST; else process.env.CORMI_PUBLIC_TEST = oldPublic;
    await h.dispose(); await f.clean();
  }
});
