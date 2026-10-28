import { CormiError, type Plugin, type RuntimePluginDescriptor } from '@cormijs/core';
import type {} from '@cormijs/plugin-react';
import type {} from '@cormijs/plugin-vite';

export interface ProLayoutPluginOptions {
  readonly id?: string;
}

export interface AntdThemeOptions {
  /** Antd seed token overrides; JSON values only. */
  readonly token?: Readonly<Record<string, string | number>>;
  /** Select Antd's dark algorithm. */
  readonly dark?: boolean;
}
export interface AntdPluginOptions {
  readonly id?: string;
  readonly theme?: AntdThemeOptions;
}

function themeOptions(value: unknown): AntdThemeOptions {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['token', 'dark'].includes(key))) {
    throw new CormiError('ANTD_INVALID', 'theme must contain token and/or dark.');
  }
  const theme = value as Record<string, unknown>;
  if (theme.dark !== undefined && typeof theme.dark !== 'boolean') throw new CormiError('ANTD_INVALID', 'theme.dark must be boolean.');
  let token: Readonly<Record<string, string | number>> | undefined;
  if (theme.token !== undefined) {
    if (!theme.token || typeof theme.token !== 'object' || Array.isArray(theme.token)) throw new CormiError('ANTD_INVALID', 'theme.token must be an object.');
    const entries = Object.entries(theme.token as Record<string, unknown>);
    if (entries.length > 128 || entries.some(([name, item]) => !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)
      || !(typeof item === 'string' && item.length <= 512 || typeof item === 'number' && Number.isFinite(item)))) {
      throw new CormiError('ANTD_INVALID', 'theme.token entries must be bounded string or finite number values.');
    }
    token = Object.freeze({ ...theme.token as Record<string, string | number> });
  }
  return Object.freeze({ ...(token ? { token } : {}), ...(theme.dark === true ? { dark: true } : {}) });
}

/**
 * Optional Antd bridge. LocaleProvider (localePlugin) should be mounted before this plugin so the
 * Antd provider can read the active locale and direction.
 */
export const antdPlugin: Plugin.Object<AntdPluginOptions> = {
  name: 'cormi:antd', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'theme'].includes(key))) {
      throw new CormiError('ANTD_INVALID', 'Invalid Antd plugin options.');
    }
    const id = options.id ?? 'cormi:antd';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('ANTD_INVALID', 'Invalid Antd plugin id.');
    const theme = themeOptions(options.theme);
    const contribution: RuntimePluginDescriptor = Object.freeze({
      id: id + ':runtime',
      module: { package: '@cormijs/plugin-antd/runtime', export: 'antdRuntime' },
      options: Object.freeze({ theme }),
    });
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage: 20, run: () => [contribution] }));
  },
};

/**
 * Build bridge for the optional ProLayout shell. Pre-bundling the layout package avoids Vite's
 * late dependency discovery when the application layout lazily imports `@cormijs/plugin-antd/pro-layout`.
 */
export const proLayoutPlugin: Plugin.Object<ProLayoutPluginOptions> = {
  name: 'cormi:pro-layout', inject: ['vite'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'id')) {
      throw new CormiError('PRO_LAYOUT_INVALID', 'Invalid ProLayout plugin options.');
    }
    const id = options.id ?? 'cormi:pro-layout';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('PRO_LAYOUT_INVALID', 'Invalid ProLayout plugin id.');
    ctx.effect(() => ctx.vite.add(id, () => [{
      name: id,
      config: () => ({ optimizeDeps: { include: ['@ant-design/pro-layout'] } }),
    }]));
  },
};
