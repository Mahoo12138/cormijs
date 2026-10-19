import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { adaptAssetReferences, publicAssetModule } from '../scripts/admin/assets.js';

async function helper(base: string): Promise<(path: string) => string> {
  const text = ts.transpileModule(publicAssetModule.replace('import.meta.env.BASE_URL', JSON.stringify(base)), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const value = await import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
  return value.publicAsset;
}
test('template public assets work under root and nested prefixes without changing names', async () => {
  for (const base of ['/', '/admin/', '/tools/admin/']) {
    const asset = await helper(base);
    assert.equal(asset('/assets/images/avatar/avatar-1.webp'), base + 'assets/images/avatar/avatar-1.webp');
  }
});
test('template helper rejects external, escaping, ambiguous and CSS-breaking asset paths', async () => {
  const asset = await helper('/admin/');
  for (const path of ['https://host/assets/a.svg', '//host/a.svg', '/assets/../secret', '/assets//a.svg', '/assets/./a.svg', '/assets/a.svg?query', '/assets/a".svg', '/assets/a\\b.svg']) assert.throws(() => asset(path), TypeError);
  assert.throws(() => asset('/admin/assets/a.svg'), TypeError);
  for (const base of ['//host/', '/admin', '/a/../', './']) { const invalid = await helper(base); assert.throws(() => invalid('/assets/a.svg'), TypeError); }
});
test('migration rewrites JSX attributes and data literals without editing comments or unrelated paths', () => {
  const input = '// /assets/comment.svg\nconst data={src:"/assets/a.svg",link:"/user",remote:"https://x/assets/a.svg"};export const Page=()=> <img src="/assets/b.svg"/>;';
  const result = adaptAssetReferences('source.tsx', input);
  assert.equal(result.edits.length, 2); assert.match(result.code, /src=\{publicAsset\("\/assets\/b.svg"\)\}/);
  assert.ok(result.code.includes('// /assets/comment.svg')); assert.ok(result.code.includes('https://x/assets/a.svg')); assert.ok(result.code.includes('link:"/user"'));
});
test('migration preserves template interpolation and handles CSS-in-JS URLs', () => {
  const result = adaptAssetReferences('source.tsx', 'const image=`/assets/product-${index + 1}.webp`; const css={backgroundImage:"url(/assets/overlay.jpg)"};');
  assert.deepEqual(result.edits.map(item => item.kind), ['template', 'css-url']);
  assert.ok(result.code.includes('publicAsset(`/assets/product-${index + 1}.webp`)'));
  assert.ok(result.code.includes('publicAsset("/assets/overlay.jpg")'));
});
test('unrelated imports, fragment SVG paint and existing adaptations remain byte-stable', () => {
  const source = 'import x from "./assets/a.svg"; const gradient=`url(#${id})`;';
  assert.deepEqual(adaptAssetReferences('x.tsx', source), { code: source, edits: [] });
  const result = adaptAssetReferences('x.tsx', 'const a="/assets/a.svg";');
  assert.equal(adaptAssetReferences('x.tsx', result.code).code, result.code);
});
test('migration refuses an existing helper binding and an unreviewed absolute module import', () => {
  assert.throws(() => adaptAssetReferences('x.ts', 'function publicAsset(){};const a="/assets/a.svg";'), /Conflicting/);
  assert.throws(() => adaptAssetReferences('x.ts', 'import x from "/assets/a.svg";'), /separate migration/);
});
