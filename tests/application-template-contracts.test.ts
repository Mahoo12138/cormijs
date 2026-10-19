import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { templateFiles } from '../packages/create/src/templates.js';
import { app, cli } from './launcher-helpers.js';

const bounds = { timeout: 30000 };
async function scaffold(t: import('node:test').TestContext, template: 'react' | 'react-api') {
  const f = await app(t), files = templateFiles(template);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(f.root, path)), { recursive: true }); await writeFile(join(f.root, path), text);
  }
  return f;
}

test('fresh application types cover public environment and asset imports without any or claiming missing values exist', bounds, async t => {
  const f = await scaffold(t, 'react');
  await f.write('src/contracts.ts', `import styles from './card.module.css';
import image from './mark.svg';
const base: string = import.meta.env.BASE_URL;
const dev: boolean = import.meta.env.DEV;
const optional: string | undefined = import.meta.env.CORMI_PUBLIC_OPTIONAL;
const asset: string = image; const className: string = styles.card!;
// @ts-expect-error environment values are not numbers
const invalid: number = import.meta.env.CORMI_PUBLIC_OPTIONAL;
// @ts-expect-error an undeclared public key can be absent
const required: string = import.meta.env.CORMI_PUBLIC_UNDECLARED;
// @ts-expect-error private values are not a client API
const secret = import.meta.env.DATABASE_PASSWORD;
// @ts-expect-error public environment is readonly
import.meta.env.CORMI_PUBLIC_OPTIONAL = 'mutated';
void [base, dev, optional, asset, className, invalid, required, secret];
`);
  const check = cli(t, f.root, 'typecheck', ['--startup-timeout', '25000']);
  assert.equal(await check.finish(25000), 0, JSON.stringify(check.events) + check.stderr);
});

test('fresh application keeps dependency declaration checking and generated roots visible to the editor', () => {
  for (const kind of ['react', 'react-api'] as const) {
    const config = JSON.parse(templateFiles(kind)['tsconfig.json']!);
    assert.equal(config.compilerOptions.skipLibCheck, false);
    assert.ok(config.include.includes('.cormi'));
  }
});

test('react-api template registers its provider only for the development target', bounds, async t => {
  const f = await scaffold(t, 'react-api');
  for (const target of ['dev', 'build']) {
    const command = cli(t, f.root, 'diagnose', ['--for', target]);
    assert.equal(await command.finish(), 0, JSON.stringify(command.events) + command.stderr);
    const report = command.events.find(e => e.type === 'result')?.data;
    assert.equal(report.configured.find((entry: { id: string }) => entry.id === 'dev-api').enabled, target === 'dev');
    assert.equal(report.graph.services.some((service: { name: string }) => service.name === 'devApi'), target === 'dev');
  }
});
