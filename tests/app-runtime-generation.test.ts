import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { generateApplication } from '@cormijs/plugin-react';
import { fixture, hasCode } from './helpers.js';

test('application runtime module is generated as a browser namespace without Node evaluation', async () => {
  const f = await fixture(); const root = await realpath(f.root);
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/app.tsx'), 'throw new Error("APP_MUST_NOT_EXECUTE_IN_NODE");export function rootContainer(node){return node}');
    const code = await generateApplication(root, [], [], '/', 'root', [], false,
      { module: { specifier: './src/app.tsx', exportName: '*' }, keys: ['testExtension'] });
    assert.match(code, /import \* as applicationConfig from "\.\.\/src\/app.tsx"/);
    assert.match(code, /resolveAppConfig\(applicationConfig,\["testExtension"\]\)/);
    assert.doesNotMatch(code, /APP_MUST_NOT_EXECUTE_IN_NODE/);
  } finally { await f.clean(); }
});
test('application runtime references retain the client-server boundary', async () => {
  const f = await fixture();
  try {
    await assert.rejects(generateApplication(f.root, [], [], '/', 'root', [], false,
      { module: { specifier: '@cormijs/core', exportName: '*' }, keys: [] }), hasCode('CLIENT_SERVER_IMPORT'));
  } finally { await f.clean(); }
});
