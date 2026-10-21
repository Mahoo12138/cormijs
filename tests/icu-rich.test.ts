import test from 'node:test';
import assert from 'node:assert/strict';
import { formatIcu, formatIcuParts } from '@cormijs/runtime';

test('rich parts keep tags, nested tags and interpolated values structured', () => {
  assert.deepEqual(formatIcuParts('<b>Hello {name}</b>', { name: 'Ada' }, 'en', ['b']), [{ tag: 'b', children: ['Hello ', 'Ada'] }]);
  assert.deepEqual(formatIcuParts('a <b>b <i>c</i></b>', {}, 'en', ['b', 'i']), ['a ', { tag: 'b', children: ['b ', { tag: 'i', children: ['c'] }] }]);
  assert.deepEqual(formatIcuParts('<b>{count, plural, one {# post} other {# posts}}</b>', { count: 2 }, 'en', ['b']), [{ tag: 'b', children: ['2 posts'] }]);
  assert.deepEqual(formatIcuParts('{g, select, female {<b>She</b>} other {<i>They</i>}}', { g: 'female' }, 'en', ['b', 'i']), [{ tag: 'b', children: ['She'] }]);
});

test('tags stay literal for plain formatting and for unknown angle brackets', () => {
  assert.equal(formatIcu('<b>Hello {name}</b>', { name: 'Ada' }, 'en'), '<b>Hello Ada</b>');
  assert.deepEqual(formatIcuParts('literal < not a tag', {}, 'en', ['b']), ['literal < not a tag']);
  assert.deepEqual(formatIcuParts('a <3 b', {}, 'en', ['b']), ['a <3 b']);
  assert.deepEqual(formatIcuParts("'{<b>'", {}, 'en', ['b']), ['{<b>']);
});

test('rich parsing rejects unknown, mismatched and unterminated tags', () => {
  assert.throws(() => formatIcuParts('<x>a</x>', {}, 'en', ['b']), /LOCALE_INVALID: unknown rich tag: x/);
  assert.throws(() => formatIcuParts('<b>a</i>', {}, 'en', ['b', 'i']), /LOCALE_INVALID: unexpected rich tag close: i/);
  assert.throws(() => formatIcuParts('<b>a', {}, 'en', ['b']), /LOCALE_INVALID: unterminated rich tag: b/);
  assert.throws(() => formatIcuParts('</b>', {}, 'en', ['b']), /LOCALE_INVALID: unexpected rich tag close: b/);
});
