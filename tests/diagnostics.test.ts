import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectRuntime, DiagnosticService, Service, type Context, type RuntimeGraph } from '@cormijs/core';
import { DevApiService } from '@cormijs/plugin-dev-api/service';
import { gate, hasCode } from './helpers.js';

const options = { timeout: 10000 };
const node = (graph: RuntimeGraph, name: string) => { const found = graph.nodes.find(n => n.pluginId === name || n.name === name); assert.ok(found, name); return found; };

test('graph observes nested dependencies and missing services without activating pending plugins', options, async () => {
  const h = new ProjectRuntime(); let starts = 0;
  h.mount('parent-id', { name: 'parent', apply(ctx) { ctx.plugin({ name: 'child', inject: ['absent'], apply() { starts++; } }); } });
  try {
    await assert.rejects(h.ready(), hasCode('SERVICE_MISSING'));
    const g = h.graph(), child = node(g, 'child');
    assert.equal(child.state, 'PENDING'); assert.equal(child.parent, node(g, 'parent-id').id);
    assert.deepEqual(child.dependencies, [{ name: 'absent', visibleProvider: null, committedProvider: null, resolution: 'missing' }]);
    assert.equal(starts, 0); assert.deepEqual(h.graph(), g);
    const after = h.mount('after', { apply() {} }); assert.equal(after.uid, 3, 'Reading a graph must not consume Cordis registry counters');
    assert.ok(Object.isFrozen(g.nodes) && Object.isFrozen(child.dependencies));
  } finally { await h.dispose(); }
});

test('graph separates loading providers from missing dependencies and never reads service values', options, async () => {
  const h = new ProjectRuntime(), entered = gate(), release = gate(); let accessed = 0;
  const secret = Object.defineProperty({}, 'secret', { enumerable: true, get() { accessed++; throw Error('SECRET'); } });
  h.mount('provider', { name: 'slow', async apply(ctx) { ctx.provide('pendingService', secret); entered.resolve(); await release.promise; } });
  h.mount('consumer', { inject: ['pendingService'], apply() {} });
  try {
    await entered.promise;
    const before = h.graph(); assert.equal(node(before, 'consumer').dependencies[0]?.resolution, 'provider-not-active');
    assert.equal(node(before, 'provider').state, 'LOADING'); assert.equal(accessed, 0);
    assert.doesNotMatch(JSON.stringify(before), /SECRET|secret/);
    release.resolve(); await h.ready();
    const after = h.graph(), dep = node(after, 'consumer').dependencies[0]!;
    assert.equal(dep.resolution, 'bound'); assert.equal(dep.visibleProvider, dep.committedProvider);
    assert.equal(accessed, 0);
  } finally { release.resolve(); await h.dispose(); }
});

test('equal service names in isolated Cordis contexts resolve to different concrete providers', options, async () => {
  const h = new ProjectRuntime();
  h.mount('outer', { apply(ctx) {
    ctx.provide('value', 'outer-private');
    ctx.plugin({ name: 'outer-consumer', inject: ['value'], apply() {} });
    const isolated = ctx.isolate('value');
    isolated.plugin({ name: 'inner-provider', apply(child) { child.provide('value', 'inner-private'); } });
    isolated.plugin({ name: 'inner-consumer', inject: ['value'], apply() {} });
  } });
  try {
    await h.ready(); const g = h.graph(), a = node(g, 'outer-consumer').dependencies[0]!, b = node(g, 'inner-consumer').dependencies[0]!;
    assert.equal(a.resolution, 'bound'); assert.equal(b.resolution, 'bound'); assert.notEqual(a.committedProvider, b.committedProvider);
    assert.equal(g.services.filter(s => s.name === 'value').length, 2);
    assert.doesNotMatch(JSON.stringify(g), /outer-private|inner-private/);
  } finally { await h.dispose(); }
});

test('a draining consumer separates its retained binding from provider liveness and store registration', options, async () => {
  const h = new ProjectRuntime(), entered = gate(), release = gate(); let stopping: Promise<void> | undefined;
  h.mount('provider', { apply(ctx) { ctx.provide('value', 42); } });
  h.mount('consumer', { inject: ['value'], apply(ctx) { ctx.effect(() => async () => { entered.resolve(); await release.promise; }); } });
  try {
    await h.ready(); stopping = h.unmount('provider'); await entered.promise;
    const g = h.graph(), dep = node(g, 'consumer').dependencies[0]!;
    assert.equal(dep.resolution, 'retained-binding'); assert.equal(dep.visibleProvider, dep.committedProvider);
    const old = g.services.find(s => s.id === dep.committedProvider)!;
    // RC.11 keeps the store entry until dependent cleanup, but it is no longer active.
    assert.equal(old.registered, true); assert.equal(old.providerState, 'DISPOSED'); assert.ok(g.nodes.some(n => n.id === old.provider));
    release.resolve(); await stopping;
    assert.equal(node(h.graph(), 'consumer').dependencies[0]?.resolution, 'missing');
    h.mount('replacement', { apply(ctx) { ctx.provide('value', 43); } }); await h.ready();
    assert.notEqual(node(h.graph(), 'consumer').dependencies[0]?.committedProvider, dep.committedProvider);
  } finally { release.resolve(); await stopping; await h.dispose(); }
});

test('graph does not execute service checks to invent a reason for an unbound visible provider', options, async () => {
  const h = new ProjectRuntime(); let checks = 0;
  class Checked extends Service { constructor(ctx: Context) { super(ctx, 'checked'); } [Service.check]() { checks++; return false; } }
  h.mount('checked', Checked); h.mount('consumer', { inject: ['checked'], apply() { throw Error('must not run'); } });
  try {
    await assert.rejects(h.ready(), hasCode('SERVICE_MISSING')); const baseline = checks;
    const g = h.graph(); assert.equal(node(g, 'consumer').dependencies[0]?.resolution, 'visible-unbound');
    h.graph(); assert.equal(checks, baseline);
  } finally { await h.dispose(); }
});

test('failed plugins retain native state while raw configuration and exception values stay outside the graph', options, async () => {
  const h = new ProjectRuntime(); h.mount('broken', { name: 'bad', apply() { throw Error('RAW_PRIVATE_EXCEPTION'); } }, { token: 'RAW_PRIVATE_OPTIONS' });
  try {
    await assert.rejects(h.ready(), hasCode('PLUGIN_FAILED')); assert.equal(node(h.graph(), 'broken').state, 'FAILED');
    assert.doesNotMatch(JSON.stringify(h.graph()), /RAW_PRIVATE/);
  } finally { await h.dispose(); }
});

test('metadata collectors follow caller scopes and domains can report real contribution owner identities', options, async () => {
  const h = new ProjectRuntime(); h.mount('diagnostics', DiagnosticService); await h.ready();
  h.mount('api', DevApiService);
  const parent = h.mount('parent', { apply(ctx) { ctx.plugin({ name: 'nested-contributor', inject: ['devApi'], apply(child) { child.devApi.add('mine', { mocks: [{ path: '/hello', method: 'GET', handle: () => ({ body: 'PRIVATE_BODY' }) }] }); } }); } });
  try {
    await h.ready(); const collector = h.ctx.diagnostics.snapshot().find(s => s.id === 'dev-api')!;
    assert.equal(collector.status, 'ready'); const record = collector.records.find(r => r.kind === 'api-contribution')!;
    assert.equal(record.ownerUid, node(h.graph(), 'nested-contributor').uid);
    assert.doesNotMatch(JSON.stringify(collector), /PRIVATE_BODY|handle/);
    await parent.dispose(); assert.equal(h.ctx.diagnostics.snapshot()[0]?.records.length, 0);
    await h.unmount('api'); assert.equal(h.ctx.diagnostics.snapshot().length, 0);
  } finally { await h.dispose(); }
});

test('collector failures are explicit, bounded and do not serialize arbitrary fields or execute accessors', options, async () => {
  const h = new ProjectRuntime(); h.mount('diagnostics', DiagnosticService); await h.ready(); let reads = 0;
  const d = h.ctx.diagnostics;
  try {
    d.add('healthy', () => [{ kind: 'hook', id: 'public\u001b[31m\nname' }]);
    d.add('secret', () => [{ kind: 'hook', id: 'ok', token: 'PRIVATE_PAYLOAD' }] as never);
    d.add('getter', () => [Object.defineProperty({ kind: 'hook' }, 'id', { get() { reads++; throw Error('SECRET_GETTER'); }, enumerable: true })] as never);
    d.add('rejecting', (() => Promise.reject(Error('SECRET_ASYNC'))) as never);
    d.add('sparse', () => new Array(1)); d.add('oversize', () => new Array(513));
    const s = d.snapshot(); await delay(5);
    assert.equal(s[0]?.status, 'ready'); assert.ok(s.slice(1).every(section => section.status === 'failed'));
    assert.equal(reads, 0); assert.doesNotMatch(JSON.stringify(s), /PRIVATE_PAYLOAD|SECRET|\\u001b|\\n/);
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s[0]?.records[0]));
  } finally { await h.dispose(); }
});

test('a collector mutation invalidates the entire metadata snapshot and old disposers cannot remove replacements', options, async () => {
  const h = new ProjectRuntime(); h.mount('diagnostics', DiagnosticService); await h.ready(); const d = h.ctx.diagnostics;
  try {
    let changed = false;
    const off = d.add('mutator', () => { if (!changed) { changed = true; d.add('added', () => []); } return [{ kind: 'hook', id: 'before' }]; });
    assert.ok(d.snapshot().every(section => section.status === 'stale' && section.records.length === 0));
    await off(); d.add('mutator', () => [{ kind: 'hook', id: 'replacement' }]); await off();
    assert.equal(d.snapshot().find(s => s.id === 'mutator')?.records[0]?.id, 'replacement');
  } finally { await h.dispose(); }
});

test('withdrawing a later collector during collection prevents that callback from executing', options, async () => {
  const h = new ProjectRuntime(); h.mount('diagnostics', DiagnosticService); await h.ready();
  const d = h.ctx.diagnostics; let late = 0; let off: () => Promise<void> = async () => {};
  try {
    d.add('first', () => { void off(); return []; });
    off = d.add('later', () => { late++; return [{ kind: 'route', id: 'stale' }]; });
    const snapshot = d.snapshot();
    assert.equal(late, 0, 'A withdrawn collector must not execute from a retained iteration snapshot');
    assert.ok(snapshot.every(s => s.status === 'stale' && s.records.length === 0));
    await off();
  } finally { await h.dispose(); }
});

test('explicit service withdrawal reports an unregistered retained binding during dependent cleanup', options, async () => {
  const h = new ProjectRuntime(), entered = gate(), release = gate(); let withdraw!: () => unknown;
  let stopping: Promise<unknown> | undefined;
  h.mount('provider', { apply(ctx) { withdraw = ctx.provide('value', 1); } });
  h.mount('consumer', { inject: ['value'], apply(ctx) { ctx.effect(() => async () => { entered.resolve(); await release.promise; }); } });
  try {
    await h.ready(); stopping = Promise.resolve(withdraw()); await entered.promise;
    const g = h.graph(), dep = node(g, 'consumer').dependencies[0]!;
    assert.equal(dep.resolution, 'retained-binding'); assert.equal(dep.visibleProvider, null);
    const service = g.services.find(s => s.id === dep.committedProvider)!;
    assert.equal(service.registered, false); assert.equal(service.providerState, 'ACTIVE');
    release.resolve(); await stopping;
    assert.equal(node(h.graph(), 'consumer').dependencies[0]?.resolution, 'missing');
  } finally { release.resolve(); await stopping; await h.dispose(); }
});
