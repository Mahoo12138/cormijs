import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeatureNamespace } from '@cormijs/plugin-react';
import { hasCode } from './helpers.js';

test('feature namespace is explicit deterministic identity rather than activation-order identity', () => {
  const a = createFeatureNamespace('plugin:example.catalog', 'alpha');
  const b = createFeatureNamespace('plugin:example.catalog', 'beta');
  assert.equal(a.id, 'plugin:example.catalog:alpha');
  assert.equal(a.key('runtime'), 'plugin:example.catalog:alpha:runtime');
  assert.notEqual(a.key('page'), b.key('page'));
  assert.equal(a.key('page'), createFeatureNamespace('plugin:example.catalog', 'alpha').key('page'));
  assert.ok(Object.isFrozen(a));
});

test('namespace input cannot be coerced or silently normalized to a colliding identity', () => {
  for (const instance of ['', 'A', 'a:b', 'a/b', '../x', 'a b', 'a\n', '中文', ['alpha'], 1, null]) {
    assert.throws(() => createFeatureNamespace('plugin:example', instance as string), hasCode('FEATURE_NAMESPACE_INVALID'));
  }
  for (const plugin of ['', 'cormi', 'cormi:reserved', '@example/x', 'a/b', ['name'], null]) {
    assert.throws(() => createFeatureNamespace(plugin as string, 'a'), hasCode('FEATURE_NAMESPACE_INVALID'));
  }
  assert.notEqual(createFeatureNamespace('a:b', 'c').id, createFeatureNamespace('a', 'b-c').id);
});

test('contribution keys reject reserved separators and enforce the final 128-character budget', () => {
  const n = createFeatureNamespace('p'.repeat(106), 'a'.repeat(13));
  assert.equal(n.id.length, 120); assert.equal(n.key('runtime').length, 128);
  assert.throws(() => n.key('too-long'), hasCode('FEATURE_NAMESPACE_INVALID'));
  for (const local of ['', '../x', 'x:y', 'x/y', ['page'], null]) assert.throws(() => n.key(local as string), hasCode('FEATURE_NAMESPACE_INVALID'));
  assert.throws(() => createFeatureNamespace('p'.repeat(106), 'a'.repeat(14)), hasCode('FEATURE_NAMESPACE_INVALID'));
});
