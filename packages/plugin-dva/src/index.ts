import { CormiError, type Plugin } from '@cormijs/core';
import type { Plugin as VitePlugin } from 'vite';
import type {} from '@cormijs/plugin-react';
import type {} from '@cormijs/plugin-vite';

export interface DvaPluginOptions {
  readonly id?: string;
  /** Allow mutating reducers through immer; default false. */
  readonly immer?: boolean;
  /** Add the loading model and effect tracking; default true (Umi behavior). */
  readonly loading?: boolean;
}

interface DvaSettings {
  readonly id: string;
  readonly immer: boolean;
  readonly loading: boolean;
}
interface RuntimeContribution {
  readonly id: string;
  readonly module: { readonly specifier: string; readonly exportName: string };
  readonly options?: unknown;
}

function settings(options: DvaPluginOptions): DvaSettings {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !['id', 'immer', 'loading'].includes(key))) {
    throw new CormiError('DVA_PLUGIN_INVALID', 'Invalid dva plugin options.');
  }
  const id = options.id ?? 'cormi:dva';
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('DVA_PLUGIN_INVALID', 'Invalid dva plugin id.');
  for (const key of ['immer', 'loading'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new CormiError('DVA_PLUGIN_INVALID', `${key} must be boolean.`);
  }
  return { id, immer: options.immer ?? false, loading: options.loading ?? true };
}

/**
 * Discovers `src/models/**` through @cormijs/dva/auto and mounts a per-application dva Provider.
 * Vite's import.meta.glob is evaluated in the application root, so the package itself is excluded
 * from dependency pre-bundling.
 */
export const dvaPlugin: Plugin.Object<DvaPluginOptions> = {
  name: 'cormi:dva', inject: ['react', 'vite'],
  apply(ctx, options = {} as DvaPluginOptions) {
    const config = settings(options);
    const contribution: RuntimeContribution = { id: config.id, module: { specifier: '@cormijs/dva/auto', exportName: 'dvaRuntime' },
      options: { immer: config.immer, loading: config.loading } };
    ctx.effect(() => ctx.react.runtime.tap({ id: config.id + ':runtime', owner: config.id, ownerOrder: 0, run: () => [contribution] }));
    ctx.effect(() => ctx.vite.add(config.id, (): VitePlugin => ({
      name: config.id,
      config() { return { optimizeDeps: { exclude: ['@cormijs/dva/auto'] } }; },
      // @cormijs/dva/auto uses import.meta.glob to discover src/models/** at build time.
      // It must be excluded from the dependency optimizer so Vite can expand the glob pattern
      // in the application's file system context rather than in the pre-bundled package copy.
      //
      // When Vite serves the raw (non-optimized) file it resolves the relative `./index.js`
      // import against the package dist directory. Rewriting it to the package specifier lets
      // Vite serve the pre-bundled @cormijs/dva entry instead, which avoids raw CJS interop
      // for the runtime helpers (useDispatch, useSelector, etc.) in the same request.
      //
      // Known limitation: the path check relies on the compiled output filename `dva/dist/auto.js`.
      // If the dva package output path changes this transform must be updated to match.
      transform(code, id) {
        if (!id.split('\\').join('/').includes('/dva/dist/auto.js')) return;
        return code.replaceAll("from './index.js'", "from '@cormijs/dva'");
      },
    })));
  },
};
