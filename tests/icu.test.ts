import test from 'node:test';
import assert from 'node:assert/strict';
import { formatIcu } from '@cormijs/runtime';

test('simple arguments interpolate and missing values stay literal', () => {
  assert.equal(formatIcu('Hello {name}', { name: 'Ada' }, 'en'), 'Hello Ada');
  assert.equal(formatIcu('Hello {name}', {}, 'en'), 'Hello {name}');
  assert.equal(formatIcu('count: {count}', { count: 3 }, 'en'), 'count: 3');
});

test('plural and selectordinal select categories and replace #', () => {
  const items = '{count, plural, one {# item} other {# items}}';
  assert.equal(formatIcu(items, { count: 1 }, 'en'), '1 item');
  assert.equal(formatIcu(items, { count: 2 }, 'en'), '2 items');
  assert.equal(formatIcu('{count, plural, one {# 项} other {# 项}}', { count: 5 }, 'zh'), '5 项');
  const rank = '{rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
  assert.equal(formatIcu(rank, { rank: 1 }, 'en'), '1st');
  assert.equal(formatIcu(rank, { rank: 2 }, 'en'), '2nd');
  assert.equal(formatIcu(rank, { rank: 3 }, 'en'), '3rd');
  assert.equal(formatIcu(rank, { rank: 11 }, 'en'), '11th');
});

test('offset shifts category and # but not exact selectors', () => {
  const guests = '{count, plural, offset:1 =0 {no guests} =1 {just you} other {you and # others}}';
  assert.equal(formatIcu(guests, { count: 0 }, 'en'), 'no guests');
  assert.equal(formatIcu(guests, { count: 1 }, 'en'), 'just you');
  assert.equal(formatIcu(guests, { count: 3 }, 'en'), 'you and 2 others');
  // count 2 is category one after subtracting the offset, and "=1" still refers to the original value.
  assert.equal(formatIcu(guests, { count: 2 }, 'en'), 'you and 1 others');
});

test('select picks exact keys with other fallback and nests inside plural', () => {
  const replied = '{gender, select, female {She} male {He} other {They}} replied';
  assert.equal(formatIcu(replied, { gender: 'female' }, 'en'), 'She replied');
  assert.equal(formatIcu(replied, { gender: 'unknown' }, 'en'), 'They replied');
  const files = '{count, plural, other {{gender, select, female {her #} other {their #}} files}}';
  assert.equal(formatIcu(files, { count: 2, gender: 'female' }, 'en'), 'her 2 files');
  assert.equal(formatIcu(files, { count: 2, gender: 'male' }, 'en'), 'their 2 files');
});

test('number, date and time formats follow the locale', () => {
  assert.equal(formatIcu('{n, number}', { n: 1234.5 }, 'en'), '1,234.5');
  assert.equal(formatIcu('{n, number}', { n: 1234.5 }, 'de'), '1.234,5');
  assert.equal(formatIcu('{n, number, integer}', { n: 1234.56 }, 'en'), '1,235');
  assert.equal(formatIcu('{n, number, percent}', { n: 0.25 }, 'en'), '25%');
  const day = new Date(2024, 0, 2, 3, 4, 5);
  assert.equal(formatIcu('{when, date, short}', { when: day.getTime() }, 'en'), new Intl.DateTimeFormat('en', { dateStyle: 'short' }).format(day));
  assert.equal(formatIcu('{when, time, short}', { when: day.getTime() }, 'de'), new Intl.DateTimeFormat('de', { timeStyle: 'short' }).format(day));
});

test('quoted literals protect braces and hashes', () => {
  assert.equal(formatIcu("It's '{literal}' and '#'", {}, 'en'), "It's {literal} and #");
  assert.equal(formatIcu("{count, plural, other {literal '#' then #}}", { count: 2 }, 'en'), 'literal # then 2');
  assert.equal(formatIcu("Don''t", {}, 'en'), "Don't");
});

test('malformed messages fail with LOCALE_INVALID', () => {
  assert.throws(() => formatIcu('{name', { name: 'Ada' }, 'en'), /LOCALE_INVALID/);
  assert.throws(() => formatIcu('{n, bogus}', { n: 1 }, 'en'), /LOCALE_INVALID/);
  assert.throws(() => formatIcu('{g, select, female {She}}', { g: 'female' }, 'en'), /LOCALE_INVALID/);
  assert.throws(() => formatIcu('{n, plural, offset:-1 one {# item} other {# items}}', { n: 1 }, 'en'), /LOCALE_INVALID/);
  assert.throws(() => formatIcu('{g, select, offset:1 female {She} other {They}}', { g: 'female' }, 'en'), /LOCALE_INVALID/);
  assert.throws(() => formatIcu('{n, plural}', { n: 1 }, 'en'), /LOCALE_INVALID/);
  assert.throws(() => formatIcu('{n, plural, =0 {none}}', { n: 1 }, 'en'), /LOCALE_INVALID/);
  assert.throws(() => formatIcu('{n, number}', {}, 'en'), /LOCALE_INVALID/);
  assert.throws(() => formatIcu('{count, plural, other {# items}}', { count: 'many' }, 'en'), /LOCALE_INVALID/);
});
