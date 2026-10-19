import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveStaticCopy } from '../scripts/application-static.js';

test('static acceptance host separates navigation fallback from missing assets API and private paths', { timeout: 10000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cormi static test ')); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'assets')); await writeFile(join(dir, 'index.html'), '<h1>app</h1>');
  await writeFile(join(dir, 'assets', 'main.js'), 'export const ok = true;');
  const host = await serveStaticCopy(dir, '/workbench/'); t.after(() => host.close());
  const home = await fetch(host.url); assert.equal(home.status, 200);
  const deep = await fetch(new URL('users/42', host.url), { headers: { accept: 'text/html' } }); assert.equal(await deep.text(), '<h1>app</h1>');
  const js = await fetch(new URL('assets/main.js', host.url)); assert.match(js.headers.get('content-type')!, /javascript/);
  for (const name of ['assets/missing.js', 'missing.css', 'api/hello', '.env', '.cormi-build.json', 'src/pages/index.tsx', 'node_modules/x', '../wrong/']) {
    const response = await fetch(new URL(name, host.url), { headers: { accept: 'text/html' } });
    assert.equal(response.status, 404, name); assert.doesNotMatch(response.headers.get('content-type')!, /html/);
  }
  assert.equal((await fetch(new URL('users/42', host.url))).status, 404, 'non-navigation is not HTML fallback');
  assert.equal((await fetch(host.url, { method: 'POST' })).status, 405);
  const head = await fetch(host.url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
});
