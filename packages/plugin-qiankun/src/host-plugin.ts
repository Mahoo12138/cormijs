import { CormiError, type Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-react';
import { jsonData, type JsonValue, type RouteRecord } from '@cormijs/routes';

export interface QiankunHostAppOptions {
  readonly name: string;
  /** Absolute or page-relative qiankun HTML entry. */
  readonly entry: string;
  /** Static host route prefix, for example `slave` or `admin/slave`. */
  readonly path?: string;
  /** String URL-prefix alias for `path`; global function/array activeRules are not supported. */
  readonly activeRule?: string;
  readonly title?: string;
  readonly icon?: string;
  readonly order?: number;
  readonly access?: string;
  /** JSON props forwarded to the micro app; `base` is added from the matched host route. */
  readonly props?: Readonly<Record<string, JsonValue>>;
  readonly className?: string;
  readonly style?: Readonly<Record<string, string | number>>;
}
export interface QiankunHostOptions {
  readonly id?: string;
  readonly apps: readonly QiankunHostAppOptions[];
}

interface QiankunHostApp {
  readonly name: string;
  readonly entry: string;
  readonly path: string;
  readonly title?: string;
  readonly icon?: string;
  readonly order?: number;
  readonly access?: string;
  readonly props?: Readonly<Record<string, JsonValue>>;
  readonly className?: string;
  readonly style?: Readonly<Record<string, string | number>>;
}

function fail(message: string, details?: Record<string, unknown>): never {
  throw new CormiError('QIANKUN_HOST_INVALID', message, details);
}

function text(value: unknown, field: string, limit = 256): string {
  if (typeof value !== 'string' || !value || value.length > limit || /[\0-\x1f\x7f]/.test(value)) fail(`${field} must be bounded text.`);
  return value;
}

/** Accepts `slave`, `/slave`, `/slave/` or `/slave/*` and returns a static relative route prefix. */
export function qiankunRoutePath(value: unknown, field = 'path'): string {
  if (typeof value !== 'string' || !value) fail(`${field} must be a non-empty static URL prefix.`);
  let path = value.trim();
  if (path.startsWith('/')) path = path.slice(1);
  if (path.endsWith('/*')) path = path.slice(0, -2);
  else if (path.endsWith('*')) path = path.slice(0, -1);
  path = path.replace(/\/+$/, '');
  if (!path || path.split('/').some(segment => !segment || segment === '.' || segment === '..'
    || !/^[A-Za-z0-9._~-]+$/.test(segment))) {
    fail(`${field} must contain static path segments without parameters or wildcards.`, { [field]: value });
  }
  return path;
}

function appConfig(raw: unknown, index: number): QiankunHostApp {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Invalid qiankun host app.', { index });
  const app = raw as Record<string, unknown>;
  if (Object.keys(app).some(key => !['name', 'entry', 'path', 'activeRule', 'title', 'icon', 'order', 'access', 'props', 'className', 'style'].includes(key))) {
    fail('Unknown qiankun host app option.', { index });
  }
  const name = text(app.name, 'name', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) fail('Invalid qiankun app name.', { name });
  const entry = text(app.entry, 'entry', 2048);
  if (/\s|\\/.test(entry)) fail('Invalid qiankun entry.', { name });
  if (app.path === undefined && app.activeRule === undefined) fail('A qiankun host app needs path or activeRule.', { name });
  const path = qiankunRoutePath(app.path ?? app.activeRule, app.path === undefined ? 'activeRule' : 'path');
  if (app.path !== undefined && app.activeRule !== undefined && qiankunRoutePath(app.activeRule, 'activeRule') !== path) {
    fail('path and activeRule must resolve to the same static prefix.', { name });
  }
  const title = app.title === undefined ? undefined : text(app.title, 'title');
  const icon = app.icon === undefined ? undefined : text(app.icon, 'icon', 128);
  if (app.order !== undefined && (typeof app.order !== 'number' || !Number.isFinite(app.order))) fail('order must be finite.', { name });
  if (app.access !== undefined) {
    if (typeof app.access !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/.test(app.access)) fail('Invalid access key.', { name });
  }
  let props: Readonly<Record<string, JsonValue>> | undefined;
  if (app.props !== undefined) {
    const value = jsonData(app.props, 'QIANKUN_HOST_INVALID');
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('props must be a JSON object.', { name });
    props = value as Readonly<Record<string, JsonValue>>;
  }
  const className = app.className === undefined ? undefined : text(app.className, 'className');
  let style: Readonly<Record<string, string | number>> | undefined;
  if (app.style !== undefined) {
    const value = jsonData(app.style, 'QIANKUN_HOST_INVALID');
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 128
      || Object.values(value).some(item => typeof item !== 'string' && typeof item !== 'number')) {
      fail('style must be a JSON object of string/number values.', { name });
    }
    style = value as Readonly<Record<string, string | number>>;
  }
  return Object.freeze({ name, entry, path, ...(title === undefined ? {} : { title }), ...(icon === undefined ? {} : { icon }),
    ...(app.order === undefined ? {} : { order: app.order as number }), ...(app.access === undefined ? {} : { access: app.access as string }),
    ...(props === undefined ? {} : { props }), ...(className === undefined ? {} : { className }), ...(style === undefined ? {} : { style }) });
}

interface QiankunHostPlan {
  readonly id: string;
  readonly apps: readonly QiankunHostApp[];
  readonly routes: readonly RouteRecord[];
}

function plan(input: unknown): QiankunHostPlan {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid qiankun host options.');
  const options = input as Record<string, unknown>;
  if (Object.keys(options).some(key => !['id', 'apps'].includes(key))) fail('Unknown qiankun host option.');
  const id = options.id ?? 'cormi:qiankun-host';
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) fail('Invalid qiankun host id.');
  if (!Array.isArray(options.apps) || options.apps.length === 0 || options.apps.length > 64) {
    fail('apps must contain 1 to 64 qiankun host apps.');
  }
  const apps = options.apps.map(appConfig);
  const names = new Set<string>(), paths = new Set<string>();
  for (const app of apps) {
    if (names.has(app.name)) fail('Duplicate qiankun app name.', { name: app.name });
    if (paths.has(app.path)) fail('Duplicate qiankun route prefix.', { path: app.path });
    names.add(app.name); paths.add(app.path);
  }
  const source = { pluginId: id };
  const routes: RouteRecord[] = [];
  for (const app of apps) {
    const parentId = `qiankun:${app.name}`;
    const meta = Object.freeze({ ...(app.title === undefined ? {} : { title: app.title }), ...(app.icon === undefined ? {} : { icon: app.icon }),
      ...(app.order === undefined ? {} : { order: app.order }),
      qiankun: Object.freeze({ name: app.name, entry: app.entry, ...(app.props === undefined ? {} : { props: app.props }),
        ...(app.className === undefined ? {} : { className: app.className }), ...(app.style === undefined ? {} : { style: app.style }) }) });
    routes.push(Object.freeze({ id: parentId, path: app.path, module: { specifier: '@cormijs/plugin-qiankun/host', exportName: 'QiankunRoute' },
      ...(app.access === undefined ? {} : { access: app.access }), meta, source: Object.freeze({ ...source }) }));
    routes.push(Object.freeze({ id: parentId + ':rest', parentId, path: '*', source: Object.freeze({ ...source }) }));
  }
  return Object.freeze({ id, apps: Object.freeze(apps), routes: Object.freeze(routes) });
}

/** Pure route plan used by tests and by the plugin's route contribution. */
export function qiankunHostRoutes(input: unknown): readonly RouteRecord[] {
  return plan(input).routes;
}

/**
 * Adds menu-visible host routes for qiankun apps. Matching is route-driven (`loadMicroApp` per
 * route) rather than qiankun's global registerMicroApps/start loop, so React owns mount/unmount.
 */
export const qiankunHostPlugin: Plugin.Object<QiankunHostOptions> = {
  name: 'cormi:qiankun-host', inject: ['react'],
  apply(ctx, options = {} as QiankunHostOptions) {
    const value = plan(options);
    ctx.effect(() => ctx.react.routes.tap({ id: value.id + ':routes', owner: value.id, ownerOrder: 0, stage: 10,
      run: current => [...current, ...value.routes] }));
  },
};
