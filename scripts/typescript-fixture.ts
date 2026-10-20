import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

/** Creates synthetic reference projects only within an already-owned test consumer. */
export async function writeTypecheckGraph(root: string, browser: boolean) {
  const write = async (name: string, value: string | object) => {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), typeof value === 'string' ? value : JSON.stringify(value));
  };
  await write('shared/tsconfig.json', { compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext',
    strict: true, types: [], lib: ['ES2023'], composite: true, declaration: true, rootDir: 'src', outDir: 'dist' }, include: ['src'] });
  await write('shared/src/index.ts', 'export const sharedValue: number = 42;');
  await write('tsconfig.tools.json', { compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext',
    strict: true, noCheck: true, noEmit: true, types: ['node'], lib: ['ES2023'], skipLibCheck: false },
    files: browser ? ['tools/check.ts', 'cormi.config.ts'] : ['tools/check.ts'], references: [{ path: './shared' }] });
  await write('tools/check.ts', "import {sharedValue} from '../shared/src/index.js';export const checked:number=sharedValue;export const version:string=process.versions.node;");
  const original = browser ? JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8')) : undefined;
  await write('tsconfig.app.json', { compilerOptions: original?.compilerOptions ?? { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, types: [] },
    include: browser ? ['src', '.cormi/**/*'] : ['src'], references: [{ path: './shared' }] });
  await write('tsconfig.json', { files: [], references: [{ path: './tsconfig.tools.json' }, { path: './tsconfig.app.json' }] });
  if (browser) {
    const page = await readFile(join(root, 'src/Probe.tsx'), 'utf8'); assert.ok(page.includes('return <main>'));
    await write('src/Probe.tsx', "import {sharedValue} from '../shared/src/index';const shared:number=sharedValue;\n"
      + page.replace('return <main>', 'return <main><p id="shared-value">Shared value: {shared}</p>'));
  } else await write('src/check.ts', "import {sharedValue} from '../shared/src/index.js';export const amount:number=sharedValue;");
}

/** prepare owns .cormi; TypeScript itself must not touch any other consumer file. */
export async function compilerFootprint(root: string) {
  const result: Record<string, string> = {};
  async function visit(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', '.cormi', '.cormi.lock'].includes(item.name)) continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) result[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  await visit(root); return result;
}
