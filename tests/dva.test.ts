import test from 'node:test';
import assert from 'node:assert/strict';
import { createDvaRuntime } from '@cormijs/dva';

test('dva runtime factory validates registered models', () => {
  assert.throws(() => createDvaRuntime([]), /DVA_INVALID/);
  assert.throws(() => createDvaRuntime([{ namespace: 'a' }, { namespace: 'a' }]), /duplicate/);
  assert.throws(() => createDvaRuntime([{ namespace: 'a', reducers: { bad: 1 as never } }]), /reducers/);
  assert.throws(() => createDvaRuntime(1 as never), /DVA_INVALID/);
  assert.doesNotThrow(() => createDvaRuntime([], { allowEmpty: true }));
  assert.throws(() => createDvaRuntime([{ namespace: 'loading' }], { loading: true }), /reserved/);
  for (const options of [{ immer: 'yes' }, { loading: 1 }, { allowEmpty: 'yes' }]) {
    assert.throws(() => createDvaRuntime([{ namespace: 'a' }], options as never), /boolean/);
  }
});
