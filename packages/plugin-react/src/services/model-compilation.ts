import { Service, type Context } from 'cordis';
import { OrderedHooks } from '@cormijs/plugin-web';
import type { ModelContribution } from '../model.js';

/**
 * ModelCompilationService: owns the model contribution surface.
 *
 * Plugins that provide state management models can inject this service directly
 * instead of depending on the full ReactCompilation interface. This allows for
 * clean separation between model discovery, other compilation concerns, and
 * makes the model pipeline independently testable.
 *
 * The service is registered as 'model-compiler' on the context. For backward
 * compatibility, ctx.react.models continues to work as an alias pointing to
 * this service's contribution hook.
 *
 * @example
 * ```ts
 * export const myModelPlugin: Plugin = {
 *   name: 'my-model',
 *   inject: ['model-compiler'],
 *   apply(ctx) {
 *     ctx['model-compiler'].contributions.tap({
 *       id: 'my-model:contrib',
 *       owner: 'my-model',
 *       run: () => [{ id: 'my-model', dir: 'src/models' }]
 *     });
 *   }
 * };
 * ```
 */
export class ModelCompilationService extends Service {
  static inject = [] as const;

  /**
   * Ordered hooks for model contributions. Plugins contribute directories
   * or explicit file lists to include in the model registry. The compilation
   * pipeline discovers and generates runtime wiring for all models.
   */
  readonly contributions = new OrderedHooks<void, readonly ModelContribution[]>('models');

  constructor(ctx: Context) {
    super(ctx, 'model-compiler');
  }
}

declare module 'cordis' {
  interface Context {
    'model-compiler': ModelCompilationService;
  }
}
