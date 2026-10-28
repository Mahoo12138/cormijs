/**
 * Application config interface. Plugins extend it via declaration merging:
 *
 * ```ts
 * declare module '@cormijs/core' {
 *   interface AppConfig {
 *     locale?: { default?: string; fallback?: string }
 *   }
 * }
 * ```
 *
 * Framework core never adds fields here. Only the interface lives in core;
 * the runtime Schema value is in the cormijs package (which may import schemastery).
 */
export interface AppConfig {}
