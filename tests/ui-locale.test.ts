import test from 'node:test';
import assert from 'node:assert/strict';
import { dayjsLocaleCandidates, localeCandidates, localeDirection, normalizeLocaleTag, resolveLocaleResource } from '@cormijs/runtime';

test('normalizeLocaleTag accepts separators, casing and encoding suffixes', () => {
  assert.equal(normalizeLocaleTag('en_us.UTF-8'), 'en-US');
  assert.equal(normalizeLocaleTag('zh-hant-tw'), 'zh-Hant-TW');
  assert.equal(normalizeLocaleTag('es-419'), 'es-419');
  assert.equal(normalizeLocaleTag('en'), 'en');
  assert.equal(normalizeLocaleTag('zh@Hans'), 'zh');
  assert.equal(normalizeLocaleTag(' zh-CN '), 'zh-CN');
  for (const bad of ['', 'bad--tag', 'en-', 'a'.repeat(9), 'en US', 1 as never, null as never]) assert.equal(normalizeLocaleTag(bad), undefined, String(bad));
});

test('localeCandidates walk full, language-script and language', () => {
  assert.deepEqual(localeCandidates('zh-Hant-TW'), ['zh-Hant-TW', 'zh-Hant', 'zh']);
  assert.deepEqual(localeCandidates('en-US'), ['en-US', 'en']);
  assert.deepEqual(localeCandidates('fr'), ['fr']);
  assert.deepEqual(localeCandidates('bad--tag'), []);
  assert.deepEqual(dayjsLocaleCandidates('zh-CN'), ['zh-cn', 'zh']);
  assert.deepEqual(dayjsLocaleCandidates('en-US'), ['en-us', 'en']);
});

test('localeDirection detects RTL languages and honours normalized overrides', () => {
  for (const locale of ['ar', 'ar-EG', 'he-IL', 'fa', 'ur-PK', 'ckb']) assert.equal(localeDirection(locale), 'rtl', locale);
  for (const locale of ['en', 'zh-Hant-TW', 'ja-JP', 'es-419']) assert.equal(localeDirection(locale), 'ltr', locale);
  assert.equal(localeDirection('ar', { ar: 'ltr' }), 'ltr');
  assert.equal(localeDirection('en_US', { 'en-US': 'rtl' }), 'rtl');
  assert.equal(localeDirection('ar', { 'ar-EG': 'ltr' }), 'rtl');
  assert.throws(() => localeDirection('en', { en: 'sideways' as never }), /LOCALE_DIRECTION_INVALID/);
  assert.throws(() => localeDirection('en', [] as never), /LOCALE_DIRECTION_INVALID/);
});

test('resolveLocaleResource normalizes keys and falls back along the chain', () => {
  const resources = { zh_CN: 'cn', zh: 'zh', 'en-US': 'us' };
  assert.deepEqual(resolveLocaleResource('zh-CN', resources), { locale: 'zh-CN', value: 'cn' });
  assert.deepEqual(resolveLocaleResource('zh-Hant-TW', resources), { locale: 'zh', value: 'zh' });
  assert.deepEqual(resolveLocaleResource('en-us', resources), { locale: 'en-US', value: 'us' });
  assert.equal(resolveLocaleResource('fr-FR', resources), undefined);
  assert.deepEqual(resolveLocaleResource('en_US', { en_US: 'first', 'en-US': 'second' }), { locale: 'en-US', value: 'first' });
  assert.equal(resolveLocaleResource('en', { 'bad--key': 'x', en: 'ok' })?.value, 'ok');
  assert.throws(() => resolveLocaleResource('en', [] as never), /LOCALE_RESOURCE_INVALID/);
  assert.throws(() => resolveLocaleResource('en', null as never), /LOCALE_RESOURCE_INVALID/);
});
