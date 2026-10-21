import { CormiError, type Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-vite';

export interface ProxyTargetOptions {
  /** Absolute http(s) URL of the upstream server. */
  readonly target: string;
  readonly changeOrigin?: boolean;
  readonly secure?: boolean;
  readonly ws?: boolean;
}
export type ProxyTarget = string | ProxyTargetOptions;
export interface ProxyPluginOptions {
  readonly id?: string;
  /** Path prefix → upstream target; at most 32 entries. */
  readonly proxy: Readonly<Record<string, ProxyTarget>>;
}
export interface NormalizedProxyTarget {
  readonly target: string;
  readonly changeOrigin?: boolean;
  readonly secure?: boolean;
  readonly ws?: boolean;
}

/** Validate a small, serializable subset of Vite/http-proxy options; no rewrite functions. */
export function normalizeProxy(input: unknown): Readonly<Record<string, NormalizedProxyTarget>> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CormiError('PROXY_INVALID', 'proxy must be an object.');
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length || entries.length > 32) throw new CormiError('PROXY_INVALID', 'proxy must contain 1 to 32 entries.');
  const output: Record<string, NormalizedProxyTarget> = {};
  for (const [prefix, value] of entries) {
    if (!prefix.startsWith('/') || prefix.length > 256 || prefix.includes('\\') || prefix.includes('\0') || prefix.startsWith('//') || prefix.split('/').includes('..')) {
      throw new CormiError('PROXY_INVALID', 'Proxy prefixes must be absolute URL paths.', { prefix });
    }
    if (typeof value === 'string') {
      output[prefix] = { target: checkTarget(value, prefix) };
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !['target', 'changeOrigin', 'secure', 'ws'].includes(key))) {
      throw new CormiError('PROXY_INVALID', 'Proxy entries must be a target string or a bounded options object.', { prefix });
    }
    const row = value as Record<string, unknown>;
    const target = checkTarget(row.target, prefix);
    for (const flag of ['changeOrigin', 'secure', 'ws'] as const) {
      if (row[flag] !== undefined && typeof row[flag] !== 'boolean') throw new CormiError('PROXY_INVALID', `${flag} must be boolean.`, { prefix });
    }
    output[prefix] = {
      target,
      ...(row.changeOrigin !== undefined ? { changeOrigin: row.changeOrigin as boolean } : {}),
      ...(row.secure !== undefined ? { secure: row.secure as boolean } : {}),
      ...(row.ws !== undefined ? { ws: row.ws as boolean } : {}),
    };
  }
  return output;
}

function checkTarget(value: unknown, prefix: string): string {
  if (typeof value !== 'string' || value.length > 1024) throw new CormiError('PROXY_INVALID', 'Proxy target must be an http(s) URL.', { prefix });
  let url: URL;
  try { url = new URL(value); } catch { throw new CormiError('PROXY_INVALID', 'Proxy target must be an http(s) URL.', { prefix }); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new CormiError('PROXY_INVALID', 'Proxy target must use http or https.', { prefix });
  if (url.username || url.password) throw new CormiError('PROXY_INVALID', 'Proxy target must not embed credentials.', { prefix });
  return value;
}

/** Opt-in dev/preview proxy; production deployment still terminates these paths at the gateway. */
export const proxyPlugin: Plugin.Object<ProxyPluginOptions> = {
  name: 'cormi:proxy', inject: ['vite'],
  apply(ctx, options) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'proxy'].includes(key))) {
      throw new CormiError('PROXY_INVALID', 'Invalid proxy plugin options.');
    }
    const id = options.id ?? 'cormi:proxy';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('PROXY_INVALID', 'Invalid proxy plugin id.');
    if (options.proxy === undefined) throw new CormiError('PROXY_INVALID', 'proxy is required.');
    const proxy = normalizeProxy(options.proxy);
    ctx.effect(() => ctx.vite.add(id, () => ({
      name: id,
      config(config) {
        return {
          server: { proxy: { ...(config.server?.proxy ?? {}), ...proxy } },
          preview: { proxy: { ...(config.preview?.proxy ?? {}), ...proxy } },
        };
      },
    })));
  },
};
