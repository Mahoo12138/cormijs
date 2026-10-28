/**
 * Domain compilation services: independent, injectable services that replace
 * the flat ctx.react surface. Each service owns a specific compilation concern
 * (routes, runtime, locale, models, etc.) and can be injected independently.
 *
 * For backward compatibility, ctx.react continues to exist as an aggregation
 * point with aliases to these services. New plugins should inject domain
 * services directly; legacy plugins continue to work unchanged.
 *
 * @example New style (domain service injection):
 * ```ts
 * export const plugin: Plugin = {
 *   inject: ['locale-compiler'],
 *   apply(ctx) {
 *     ctx['locale-compiler'].catalog.tap(...)
 *   }
 * }
 * ```
 *
 * @example Legacy style (still works):
 * ```ts
 * export const plugin: Plugin = {
 *   inject: ['react'],
 *   apply(ctx) {
 *     ctx.react.locale.tap(...)  // Aliases to locale-compiler
 *   }
 * }
 * ```
 */

export { LocaleCompilationService } from './locale-compilation.js';
export { ModelCompilationService } from './model-compilation.js';
export { RuntimeCompilationService } from './runtime-compilation.js';
export { RouteCompilationService } from './route-compilation.js';
