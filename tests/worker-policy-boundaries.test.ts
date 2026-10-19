import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { literalModuleEdges } from '../scripts/plugin-boundaries.js';

test('worker transport does not select diagnosis commands or import product command and diagnostic providers',async()=>{
  const source=await readFile('packages/cormi/src/worker.ts','utf8');
  assert.doesNotMatch(source,/diagnose|DiagnosticService|commandPlugin|\.commands\./);
  const imports=literalModuleEdges(source,'worker.ts');assert.equal(imports.includes('./worker-profile.js'),false);assert.equal(imports.includes('./diagnose.js'),false);
  assert.doesNotMatch(await readFile('packages/cormi/src/commands.ts','utf8'),/['"]diagnose['"]/);
});
