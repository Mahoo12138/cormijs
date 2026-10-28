/**
 * Runtime plugin system: plugins that execute in the browser/Node runtime,
 * not during the build phase. Distinct from build-time Plugin which runs in cordis.
 *
 * Runtime plugins are generated into the application bundle and executed when
 * the application starts (browser) or on each request (SSR).
 */

/**
 * Runtime plugin function: receives runtime context and returns cleanup or void.
 * Runtime plugins execute in the user's browser, not in the build process.
 */
export type RuntimePlugin<TContext = any, TOptions = unknown> = (
  ctx: TContext,
  options: TOptions
) => void | RuntimeCleanup | Promise<void | RuntimeCleanup>;

/**
 * Cleanup function returned by runtime plugins. Called when the application unmounts.
 */
export type RuntimeCleanup = () => void | Promise<void>;

/**
 * Runtime plugin descriptor: references a module containing a runtime plugin,
 * to be imported and executed in the application bundle.
 *
 * The `module` field accepts three shapes:
 * - Plain string: treated as a specifier with default export
 * - ModuleRef shape `{ specifier, exportName }`: legacy/compat with clientModule()
 * - Package shape `{ package, export? }`: new explicit package reference
 * - File shape `{ file }`: new explicit file reference
 */
export interface RuntimePluginDescriptor<TOptions = unknown> {
  /** Unique plugin instance identifier */
  readonly id: string;
  /** Module reference: string, ModuleRef shape, package shape, or file shape */
  readonly module: string
    | { readonly specifier: string; readonly exportName: string }
    | { readonly file: string }
    | { readonly package: string; readonly export?: string };
  /** Static options passed to the plugin at runtime */
  readonly options?: TOptions;
}

/**
 * Type guard: check if a value is a RuntimePluginDescriptor.
 */
export function isRuntimePluginDescriptor(value: unknown): value is RuntimePluginDescriptor {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(item.id)) return false;
  if (typeof item.module === 'string') return true;
  if (item.module && typeof item.module === 'object') {
    const mod = item.module as Record<string, unknown>;
    if (typeof mod.file === 'string') return true;
    if (typeof mod.package === 'string') return true;
  }
  return false;
}

/**
 * Normalize a runtime plugin descriptor's module reference to a string specifier.
 */
export function resolveRuntimePluginModule(descriptor: RuntimePluginDescriptor): string {
  if (typeof descriptor.module === 'string') return descriptor.module;
  if ('file' in descriptor.module) return descriptor.module.file;
  if ('package' in descriptor.module) {
    const pkg = descriptor.module.package;
    const exp = descriptor.module.export;
    return exp ? `${pkg}/${exp}` : pkg;
  }
  throw new TypeError('Invalid runtime plugin module reference');
}
