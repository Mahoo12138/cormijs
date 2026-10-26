import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoutes } from '@cormijs/routes';
import { hasCode } from './helpers.js';
import { qiankunHostRoutes, qiankunRoutePath } from '../packages/plugin-qiankun/src/host-plugin.js';

test('qiankun host apps become menu-visible parent routes with a catch-all child', () => {
  const routes = qiankunHostRoutes({ apps: [
    { name: 'slave', entry: '/host/fake/qiankun.html', path: 'slave', title: 'Slave', icon: 'Appstore', order: 2,
      access: 'canSlave', props: { greeting: 'hello' }, className: 'micro', style: { height: 320 } },
    { name: 'admin', entry: './admin/qiankun.html', activeRule: '/admin/*', title: 'Admin' },
  ] });
  assert.equal(routes.length, 4);
  const [parent, child, admin] = routes;
  assert.equal(parent!.id, 'qiankun:slave');
  assert.equal(parent!.path, 'slave');
  assert.equal(parent!.parentId, undefined);
  assert.equal(parent!.access, 'canSlave');
  assert.deepEqual(parent!.meta, { title: 'Slave', icon: 'Appstore', order: 2, qiankun: {
    name: 'slave', entry: '/host/fake/qiankun.html', props: { greeting: 'hello' }, className: 'micro', style: { height: 320 },
  } });
  assert.deepEqual(parent!.module, { specifier: '@cormijs/plugin-qiankun/host', exportName: 'QiankunRoute' });
  assert.equal(child!.id, 'qiankun:slave:rest');
  assert.equal(child!.parentId, 'qiankun:slave');
  assert.equal(child!.path, '*');
  assert.equal(child!.module, undefined);
  assert.equal(admin!.path, 'admin');
  assert.equal(admin!.meta?.title, 'Admin');
  // The IR must stay valid before it reaches the React generator.
  const valid = validateRoutes(routes);
  assert.equal(valid.length, 4);
  assert.equal(valid[1]!.parentId, 'qiankun:slave');
});

test('route prefixes accept path or activeRule aliases and reject dynamic prefixes', () => {
  assert.equal(qiankunRoutePath('slave'), 'slave');
  assert.equal(qiankunRoutePath('/slave/'), 'slave');
  assert.equal(qiankunRoutePath('/admin/slave/*'), 'admin/slave');
  assert.equal(qiankunRoutePath('slave/*'), 'slave');
  for (const value of ['', '/', '/*', 'slave/:id', 'slave/*/edit', 'slave?x=1', '../slave', 'slave//x', 'a b']) {
    assert.throws(() => qiankunRoutePath(value), hasCode('QIANKUN_HOST_INVALID'), String(value));
  }
  assert.equal(qiankunHostRoutes({ apps: [{ name: 'a', entry: '/a.html', path: '/a/', activeRule: 'a/*' }] })[0]!.path, 'a');
  assert.throws(() => qiankunHostRoutes({ apps: [{ name: 'a', entry: '/a.html', path: 'a', activeRule: 'b' }] }),
    /same static prefix/);
});

test('invalid qiankun host options fail with actionable codes', () => {
  const valid = { name: 'a', entry: '/a.html', path: 'a' };
  for (const input of [null, {}, { apps: [] }, { apps: [valid, valid] },
    { apps: [{ ...valid, name: '../a' }] },
    { apps: [{ ...valid, entry: 'a b' }] },
    { apps: [{ ...valid, path: 'b' }, { ...valid, name: 'b', path: 'b' }] },
    { apps: [{ ...valid, extra: true }] },
    { apps: [{ ...valid, order: Number.NaN }] },
    { apps: [{ ...valid, access: 'bad key' }] },
    { apps: [{ ...valid, props: { fn: () => 1 } }] },
    { apps: [{ ...valid, style: { height: true } }] },
    { id: 'bad id', apps: [valid] }]) {
    assert.throws(() => qiankunHostRoutes(input), hasCode('QIANKUN_HOST_INVALID'));
  }
  assert.throws(() => qiankunHostRoutes({ apps: [{ ...valid, path: undefined, activeRule: undefined }] }), /path or activeRule/);
  assert.throws(() => qiankunHostRoutes({ apps: [{ ...valid, title: 'x'.repeat(257) }] }), /title/);
});
