import Schema from '@cormijs/schemastery';
import type { ModuleRef, RouteRecord } from '@cormijs/routes';

// ─── Declaration merging: each feature contributes its own app.* keys ───

declare module '@cormijs/core' {
  interface AppConfig {
    // Core React application
    /** React application pages directory. Default: 'src/pages' */
    pages?: string;
    /** HTML mount element id. Default: 'root' */
    mountId?: string;
    /** Enable React StrictMode. Default: false */
    strict?: boolean;
    /** History type for the router. Default: 'browser' */
    history?: 'browser' | 'hash' | 'memory';
    /** Enable server-side rendering. Requires ssrPlugin. */
    ssr?: boolean;
    /** External runtime configuration module reference */
    runtimeConfig?: ModuleRef;
    /** Explicit route definitions; overrides convention-based discovery */
    routes?: readonly Partial<RouteRecord>[];
    /** Runtime plugin contributions mounted into the React application */
    runtime?: readonly { readonly id: string; readonly module: ModuleRef; readonly options?: unknown }[];

    // Locale
    /** Locale configuration: default/fallback languages and message catalogs */
    locale?: { readonly default?: string; readonly fallback?: string; readonly persist?: boolean | string };

    // Model
    /** Model configuration: discovery directory and extra models */
    model?: { readonly dir?: string };

    // Initial state
    /** Initial state configuration */
    initialState?: { readonly id?: string };

    // Request
    /** Request client configuration */
    request?: { readonly id?: string; readonly baseURL?: string; readonly dataField?: string };

    // Access
    /** Access configuration: permission keys and convention files */
    access?: { readonly id?: string; readonly files?: readonly string[] };

    // Menu
    /** Menu configuration: collapse state persistence */
    menu?: { readonly id?: string; readonly collapse?: boolean | { readonly storageKey?: string } };

    // Head
    /** Route head configuration: title template and auto-sync */
    head?: { readonly titleTemplate?: string; readonly baseTitle?: string; readonly auto?: boolean };

    // Analytics
    /** Analytics configuration: GA4 measurement id and custom pageview events */
    analytics?: { readonly measurementId?: string; readonly eventName?: string; readonly dispatch?: boolean };

    // Prefetch
    /** Route prefetch configuration: idle preheating mode */
    prefetch?: { readonly mode?: 'manual' | 'idle' };

    // Global styles
    /** Global style convention files */
    globalStyle?: { readonly id?: string; readonly files?: readonly string[] };

    // Mock
    /** Mock directory convention */
    mock?: { readonly id?: string };

    // Proxy
    /** Development/preview proxy configuration */
    proxy?: Readonly<Record<string, { readonly target: string; readonly changeOrigin?: boolean; readonly secure?: boolean }>>;

    // Alias
    /** Path aliases merged into the bundler resolver */
    alias?: Readonly<Record<string, string>>;

    // Define
    /** Compile-time constants replaced in dev and build */
    define?: Readonly<Record<string, unknown>>;

    // HTML
    /** HTML document head configuration */
    html?: { readonly title?: string; readonly lang?: string; readonly favicon?: string; readonly metas?: readonly { readonly name?: string; readonly property?: string; readonly content: string }[]; readonly links?: readonly { readonly rel: string; readonly href: string }[]; readonly headScripts?: readonly unknown[]; readonly scripts?: readonly unknown[] };

    // Output
    /** Build output strategy: file copying and hash control */
    output?: { readonly copy?: readonly string[]; readonly hash?: boolean };

    // Server
    /** Dev/preview server configuration */
    server?: { readonly host?: string; readonly port?: number };
  }
}

// ─── Schema builders for runtime validation ───

/** Schema for the core React application keys (pages, mountId, history, ssr, etc.) */
export const ReactAppConfigSchema = Schema.object({
  pages: Schema.string().default('src/pages')
    .description('React application pages directory.'),
  mountId: Schema.string().default('root')
    .description('HTML mount element id.'),
  strict: Schema.boolean().default(false)
    .description('Enable React StrictMode.'),
  history: Schema.union([
    Schema.const('browser' as const).description('Standard URL path history (default).'),
    Schema.const('hash' as const).description('Hash-based history; routes appear after #.'),
    Schema.const('memory' as const).description('In-memory history; no URL changes.'),
  ]).default('browser' as const).description('Router history strategy.'),
  ssr: Schema.boolean().description('Enable server-side rendering (requires ssrPlugin).'),
  runtimeConfig: Schema.any().description('External runtime configuration module reference.'),
  routes: Schema.array(Schema.any()).description('Explicit route definitions.'),
  runtime: Schema.array(Schema.any()).description('Runtime plugin module contributions.'),
}).description('Core React application options');

/** Schema for locale configuration */
export const LocaleAppConfigSchema = Schema.object({
  locale: Schema.object({
    default: Schema.string().description('Default locale code, e.g. "en-US".'),
    fallback: Schema.string().description('Fallback locale when message key is missing.'),
    persist: Schema.union([Schema.boolean(), Schema.string()])
      .description('Persist locale selection; true uses localStorage, string sets a custom key.'),
  }).description('Locale configuration'),
});

/** Schema for model configuration */
export const ModelAppConfigSchema = Schema.object({
  model: Schema.object({
    dir: Schema.string().description('Model discovery directory relative to project root.'),
  }).description('Model configuration'),
});

/** Schema for initial state configuration */
export const InitialStateAppConfigSchema = Schema.object({
  initialState: Schema.object({
    id: Schema.string().description('Plugin instance id.'),
  }).description('Initial state configuration'),
});

/** Schema for request configuration */
export const RequestAppConfigSchema = Schema.object({
  request: Schema.object({
    id: Schema.string().description('Plugin instance id.'),
    baseURL: Schema.string().description('Base URL for all requests.'),
    dataField: Schema.string().description('Response field to extract as data.'),
  }).description('Request client configuration'),
});

/** Schema for access configuration */
export const AccessAppConfigSchema = Schema.object({
  access: Schema.object({
    id: Schema.string().description('Plugin instance id.'),
    files: Schema.array(Schema.string()).description('Convention files for access functions.'),
  }).description('Access configuration'),
});

/** Schema for menu configuration */
export const MenuAppConfigSchema = Schema.object({
  menu: Schema.object({
    id: Schema.string().description('Plugin instance id.'),
    collapse: Schema.union([
      Schema.boolean(),
      Schema.object({ storageKey: Schema.string() }),
    ]).description('Menu collapse state; boolean enables localStorage, object customizes the key.'),
  }).description('Menu configuration'),
});

/** Schema for head configuration */
export const HeadAppConfigSchema = Schema.object({
  head: Schema.object({
    titleTemplate: Schema.string().description('Title template, e.g. "%s - My App".'),
    baseTitle: Schema.string().description('Base title when no route title is set.'),
    auto: Schema.boolean().default(true).description('Auto-sync head tags on route change.'),
  }).description('Route head configuration'),
});

/** Schema for analytics configuration */
export const AnalyticsAppConfigSchema = Schema.object({
  analytics: Schema.object({
    measurementId: Schema.string().pattern(/^G-[A-Z0-9]{4,32}$/).description('GA4 measurement id, e.g. "G-XXXXXXXX".'),
    eventName: Schema.string().description('Custom pageview event name.'),
    dispatch: Schema.boolean().description('Dispatch a custom cormi:pageview event.'),
  }).description('Analytics configuration'),
});

/** Schema for prefetch configuration */
export const PrefetchAppConfigSchema = Schema.object({
  prefetch: Schema.object({
    mode: Schema.union([
      Schema.const('manual' as const).description('Prefetch only on explicit request (default).'),
      Schema.const('idle' as const).description('Preheat all routes during browser idle time.'),
    ]).default('manual' as const).description('Route prefetch mode.'),
  }).description('Prefetch configuration'),
});

/** Schema for global styles configuration */
export const GlobalStyleAppConfigSchema = Schema.object({
  globalStyle: Schema.object({
    id: Schema.string().description('Plugin instance id.'),
    files: Schema.array(Schema.string()).description('Convention files for global styles.'),
  }).description('Global style configuration'),
});

/** Schema for HTML document configuration */
export const HtmlAppConfigSchema = Schema.object({
  html: Schema.object({
    title: Schema.string().description('Document title.'),
    lang: Schema.string().description('Document language attribute.'),
    favicon: Schema.string().description('Favicon href.'),
    metas: Schema.array(Schema.object({
      name: Schema.string().description('Meta name attribute.'),
      property: Schema.string().description('Meta property attribute (e.g. og:title).'),
      content: Schema.string().required().description('Meta content value.'),
    })).description('Meta tags.'),
    links: Schema.array(Schema.object({
      rel: Schema.string().required().description('Link rel attribute.'),
      href: Schema.string().required().description('Link href attribute.'),
    })).description('Link tags.'),
    headScripts: Schema.array(Schema.any()).description('Scripts injected into <head>.'),
    scripts: Schema.array(Schema.any()).description('Scripts injected before </body>.'),
  }).description('HTML document configuration'),
});

/** Schema for server configuration */
export const ServerAppConfigSchema = Schema.object({
  server: Schema.object({
    host: Schema.string().description('Server host.'),
    port: Schema.number().min(0).max(65535).description('Server port (0 = random).'),
  }).description('Dev/preview server configuration'),
});

/** Combined schema for all plugin-react app.* keys. */
export const AllReactAppSchemas = [
  ReactAppConfigSchema,
  LocaleAppConfigSchema,
  ModelAppConfigSchema,
  InitialStateAppConfigSchema,
  RequestAppConfigSchema,
  AccessAppConfigSchema,
  MenuAppConfigSchema,
  HeadAppConfigSchema,
  AnalyticsAppConfigSchema,
  PrefetchAppConfigSchema,
  GlobalStyleAppConfigSchema,
  HtmlAppConfigSchema,
  ServerAppConfigSchema,
] as const;
