import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { excessResources, resourceCounts, until } from '../scripts/reliability/resources.js';
import { close, listen } from './helpers.js';

test('resource comparison cannot trade one leaked resource class for a decrease in another', () => {
  assert.deepEqual(excessResources({ PipeWrap: 3, Timeout: 0 }, { PipeWrap: 1, Timeout: 1 }), { Timeout: 1 });
  assert.deepEqual(excessResources({}, { TCPServerWrap: 1, FSEventWrap: 1, FSReqPromise: 3 }), { FSEventWrap: 1, TCPServerWrap: 1 });
});
test('resource observation detects a real listener and sees it settle after close', async () => {
  const baseline = resourceCounts(), server = createServer();
  try {
    await listen(server);
    assert.ok(excessResources(baseline, resourceCounts()).TCPServerWrap! >= 1);
  } finally { await close(server); }
  await until(() => !excessResources(baseline, resourceCounts()).TCPServerWrap, 'listener resource close');
});
