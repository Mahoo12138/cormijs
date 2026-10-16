import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app, cli } from './launcher-helpers.js';

test('a transitive browser import of the Node SDK fails the real production build', { timeout: 15000 }, async t => {
  const f = await app(t); await mkdir(join(f.root, 'src/pages'), { recursive: true });
  await f.write('index.html', '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await f.write('cormi.config.ts', `import reactVite from '@cormijs/preset-react-vite'; export default {presets:[reactVite]};`);
  await f.write('src/barrel.ts', 'export { CormiError } from "@cormijs/core";');
  await f.write('src/pages/index.tsx', 'import { CormiError } from "../barrel"; export default function Home(){return <p>{new CormiError("test","test").message}</p>}');
  const child = cli(t, f.root, 'build'); assert.notEqual(await child.finish(), 0);
  assert.match(JSON.stringify(child.events), /CLIENT_SERVER_IMPORT/);
});
