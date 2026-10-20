import type { TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

export async function solution(t: TestContext) {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'cormi TS solution 中文 ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function write(file: string, value: string | object) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  }
  await write('tsconfig.base.json', { compilerOptions: { strict: true, types: [], target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext' } });
  await write('tsconfig.json', { files: [], references: [{ path: './app' }, { path: './tools/tsconfig.tool.json' }] });
  await write('lib/tsconfig.json', { extends: '../tsconfig.base.json', compilerOptions: { composite: true, declaration: true, rootDir: 'src', outDir: 'dist' }, include: ['src'] });
  await write('lib/src/index.ts', 'export interface Value { amount: number };export const value: Value = {amount:12};');
  await write('app/tsconfig.json', { extends: '../tsconfig.base.json', compilerOptions: { noEmit: true }, include: ['src'], references: [{ path: '../lib' }] });
  await write('app/src/index.ts', "import {value} from '../../lib/src/index';export const amount: number = value.amount;");
  await write('tools/tsconfig.tool.json', { extends: '../tsconfig.base.json', compilerOptions: { noEmit: true }, include: ['src'] });
  await write('tools/src/tool.ts', 'export const name: string = "tool";');
  return { root, write };
}
export async function diskFiles(root: string) {
  const result: Record<string, string> = {};
  async function visit(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name === 'node_modules') continue;
      const file = join(directory, item.name);
      if (item.isDirectory()) await visit(file);
      else if (item.isFile()) result[relative(root, file)] = createHash('sha256').update(await readFile(file)).digest('hex');
    }
  }
  await visit(root); return result;
}
