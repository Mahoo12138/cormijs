/**
 * ApplicationManifest: the typed contract between Node-side generation and
 * the browser runtime. Both sides evolve against this schema, so the compiler
 * can only emit a value that `bootApplication` accepts, and vice versa.
 *
 * Today the generated `.cormi/app.tsx` hardcodes this wiring inline. The manifest
 * makes the contract explicit and machine-verifiable: the generator produces a
 * valid manifest, the runtime consumes one. This unlocks stable `app.tsx`,
 * plugin-level HMR, browser DevTools, and auditability of provider ordering.
 *
 * Versioning: `version: '1'`. Bump when an additive change could mislead an older
 * consumer; additive optional fields do not require a bump.
 */
export interface ManifestRoute {
  /** Stable path id, unique across the route tree. */
  readonly id: string;
  readonly path?: string;
  readonly index?: boolean;
  /** Browser module specifier for the page component. */
  readonly module?: string;
  /** Module specifier for the route's error boundary. */
  readonly errorBoundary?: string;
  /** Export name of the client loader on the page module, if any. */
  readonly clientLoader?: string;
  /** Export name of the server loader on the page module, if any. */
  readonly serverLoader?: string;
  /** Route metadata (title, access, head, locale, icon, ...). */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** Child routes. */
  readonly children?: readonly ManifestRoute[];
}

/**
 * A runtime plugin entry in the manifest. Resolved from RuntimePluginDescriptor
 * at generation time; the browser loader imports `module` and calls its default
 * export with `options`.
 */
export interface ManifestPlugin {
  readonly id: string;
  readonly module: string;
  readonly options?: unknown;
  /**
   * Provider priority. Lower runs first (wraps outer). Plugins without a
   * priority are ordered by declaration. This makes provider nesting explicit
   * and auditable instead of hardcoded in generated source.
   */
  readonly priority?: number;
}

export interface ManifestLocaleCatalog {
  readonly locale: string;
  readonly messages: Readonly<Record<string, string>>;
}

export interface ManifestLocale {
  readonly default?: string;
  readonly fallback?: string;
  readonly catalogs: readonly ManifestLocaleCatalog[];
}

export interface ManifestModel {
  readonly namespace: string;
  readonly module: string;
}

export interface ManifestAccess {
  /** Module specifier of the access function. */
  readonly module: string;
}

export interface ManifestLayout {
  readonly module: string;
  readonly owner: string;
}

export interface ManifestLoading {
  readonly module: string;
  readonly owner: string;
}

export interface ManifestGlobalStyle {
  readonly module: string;
  readonly owner: string;
}

export interface ManifestAppRuntime {
  /** Module specifier of the src/app.ts(x) runtime config, if present. */
  readonly module?: string;
  /** Runtime config keys registered by plugins (render, rootContainer, ...). */
  readonly keys: readonly string[];
}

/**
 * The complete, serializable description of a compiled application.
 * Everything the browser needs to boot, nothing it does not.
 */
export interface ApplicationManifest {
  readonly version: '1';
  /** Unique build id; changes when any input that affects the bundle changes. */
  readonly buildId: string;
  readonly base: string;
  readonly history: 'browser' | 'hash' | 'memory';
  readonly mountId: string;
  readonly strict: boolean;
  readonly ssr: boolean;

  readonly routes: readonly ManifestRoute[];
  /**
   * Runtime plugins that mount Providers or run app-level setup, ordered by
   * priority then declaration. This is the full browser plugin graph.
   */
  readonly plugins: readonly ManifestPlugin[];

  readonly appRuntime: ManifestAppRuntime;
  readonly locale?: ManifestLocale;
  readonly models?: readonly ManifestModel[];
  readonly access?: ManifestAccess;
  readonly layout?: ManifestLayout;
  readonly loading?: ManifestLoading;
  readonly globalStyles?: readonly ManifestGlobalStyle[];
}

/** Type guard for the manifest envelope. */
export function isApplicationManifest(value: unknown): value is ApplicationManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return m.version === '1'
    && typeof m.buildId === 'string'
    && typeof m.base === 'string'
    && (m.history === 'browser' || m.history === 'hash' || m.history === 'memory')
    && typeof m.mountId === 'string'
    && typeof m.strict === 'boolean'
    && typeof m.ssr === 'boolean'
    && Array.isArray(m.routes)
    && Array.isArray(m.plugins)
    && !!m.appRuntime && typeof m.appRuntime === 'object';
}
