import { Service, type Context } from 'cordis';
import { OrderedHooks } from '@cormijs/plugin-web';
import type { LocaleCatalogSource } from '../locale.js';

/**
 * LocaleCompilationService: owns the locale catalog contribution surface.
 *
 * Plugins that only care about locale can inject this service directly
 * instead of depending on the full ReactCompilation interface. This reduces
 * coupling and makes the locale compilation pipeline independently testable.
 *
 * The service is registered as 'locale-compiler' on the context. For backward
 * compatibility, ctx.react.locale continues to work as an alias pointing to
 * this service's catalog hook.
 *
 * @example
 * ```ts
 * export const myLocalePlugin: Plugin = {
 *   name: 'my-locale',
 *   inject: ['locale-compiler'],
 *   apply(ctx) {
 *     ctx['locale-compiler'].catalog.tap({
 *       id: 'my-locale:catalog',
 *       owner: 'my-locale',
 *       run: () => [{ id: 'my-locale', directory: 'src/i18n' }]
 *     });
 *   }
 * };
 * ```
 */
export class LocaleCompilationService extends Service {
  static inject = [] as const;

  /**
   * Ordered hooks for locale catalog sources. Plugins contribute directories
   * to scan for locale JSON files. The compilation pipeline merges all catalogs.
   */
  readonly catalog = new OrderedHooks<void, readonly LocaleCatalogSource[]>('locale-catalog');

  constructor(ctx: Context) {
    super(ctx, 'locale-compiler');
  }
}

declare module 'cordis' {
  interface Context {
    'locale-compiler': LocaleCompilationService;
  }
}
