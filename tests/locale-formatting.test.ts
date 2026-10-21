import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDateFor, formatNumberFor, selectPluralKey } from '@cormijs/runtime';

const tables = {
  en: { 'items_one': '{count} item', 'items_other': '{count} items', 'legacy_other': 'legacy {count}' },
  zh: { 'items_other': '{count} 项' },
};

test('selectPluralKey prefers the exact category, then _other, then the plain key across locales', () => {
  assert.equal(selectPluralKey(tables, ['en'], 'items', 'one'), '{count} item');
  assert.equal(selectPluralKey(tables, ['en'], 'items', 'other'), '{count} items');
  assert.equal(selectPluralKey(tables, ['zh'], 'items', 'one'), '{count} 项');
  assert.equal(selectPluralKey(tables, ['zh', 'en'], 'legacy', 'one'), 'legacy {count}');
  assert.equal(selectPluralKey({ en: { plain: 'plain' } }, ['en'], 'plain', 'one'), 'plain');
  assert.equal(selectPluralKey({}, ['en'], 'missing', 'one'), undefined);
});

test('number formatting follows the locale and rejects non-finite values', () => {
  assert.equal(formatNumberFor('en', 1234.5), '1,234.5');
  assert.equal(formatNumberFor('de', 1234.5), '1.234,5');
  assert.equal(formatNumberFor('en', 0.5, { style: 'percent' }), '50%');
  assert.throws(() => formatNumberFor('en', Number.NaN), /LOCALE_INVALID/);
});

test('date formatting follows the locale and rejects invalid dates', () => {
  const day = Date.UTC(2024, 0, 2, 3, 4, 5);
  assert.equal(formatDateFor('en', day, { timeZone: 'UTC', dateStyle: 'short' }), '1/2/24');
  assert.equal(formatDateFor('de', day, { timeZone: 'UTC', dateStyle: 'short' }), '02.01.24');
  assert.throws(() => formatDateFor('en', 'not-a-date'), /LOCALE_INVALID/);
});
