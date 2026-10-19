import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHeaderFixes, headerFixPaths } from '../scripts/admin/header-fixes.js';

const path = 'src/layouts/components/menu-button.tsx';
const source = "import IconButton from '@mui/material/IconButton';\nexport function MenuButton({sx,...other}) { return (\n    <IconButton sx={sx} {...other}><span>menu</span></IconButton>\n); }\n";
test('optional header adaptation preserves all bytes outside its reviewed accessibility change', () => {
  const fixed = applyHeaderFixes(path, source);
  assert.equal(fixed.edits, 1);
  assert.equal(fixed.code.replace(' aria-label="Open navigation"', ''), source);
  assert.equal(new Set(headerFixPaths).size, 7);
});
test('header patch rejects missing, duplicated and already-applied anchors', () => {
  assert.throws(() => applyHeaderFixes(path, source.replace('sx={sx}', 'sx={{}}')), /reviewed anchor/);
  assert.throws(() => applyHeaderFixes(path, source + source), /reviewed anchor/);
  assert.throws(() => applyHeaderFixes(path, applyHeaderFixes(path, source).code), /reviewed anchor/);
});
test('unrelated business modules remain untouched even when they contain the same JSX', () => {
  assert.deepEqual(applyHeaderFixes('src/sections/user/view/user-view.tsx', source), { code: source, edits: 0 });
});
