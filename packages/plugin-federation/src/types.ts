export interface FederationRemoteOptions {
  readonly name: string;
  /** Absolute http(s) URL or root-relative path to the remote's `remoteEntry.js`. */
  readonly entry: string;
  /** Exposed module key; defaults to `./routes`. */
  readonly module?: string;
  /** Prefix applied to the remote's top-level route paths, for example `/remote`. */
  readonly prefix?: string;
  /** Fail host startup when this remote cannot load or merge; defaults to true. */
  readonly required?: boolean;
}
export interface FederationRemote {
  readonly name: string;
  readonly entry: string;
  readonly module: string;
  readonly prefix?: string;
  readonly required: boolean;
}
export interface FederationPluginOptions {
  readonly id?: string;
  /** Federation container name; remotes must use the same name in a host's `remotes[].name`. */
  readonly name: string;
  /** Additional exposes, keyed by public module name (`./widget`) and project-relative source. */
  readonly exposes?: Readonly<Record<string, string>>;
  /** Expose the generated route tree as `./routes` for host-side route merging. */
  readonly exposeRoutes?: boolean;
  /** Route prefix published in this remote's manifest; hosts can still override it. */
  readonly prefix?: string;
  /** Optional version published in this remote's manifest. */
  readonly version?: string;
  readonly remotes?: readonly FederationRemoteOptions[];
  /** Remote package roots or direct JSON manifests loaded at startup; falls back to PACKAGE_PUBLIC_URL. */
  readonly publicUrls?: string | readonly string[];
  /** Per-remote route prefix overrides applied to manifest remotes. */
  readonly prefixes?: Readonly<Record<string, string>>;
  /** Shared dependency package names; defaults to React, React DOM, React Router and cormi runtime. */
  readonly shared?: readonly string[];
  /** Milliseconds allowed for one manifest or remote route module; defaults to 15000. */
  readonly routeTimeout?: number;
}
export interface FederationRuntimeOptions {
  readonly name: string;
  readonly remotes: readonly FederationRemote[];
  readonly publicUrls: readonly string[];
  readonly prefixes?: Readonly<Record<string, string>>;
  readonly timeout: number;
}
export const DEFAULT_SHARED = Object.freeze(['react', 'react-dom', 'react-router', '@cormijs/runtime']);
export const DEFAULT_ROUTE_TIMEOUT = 15_000;
export const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const modulePattern = /^\.\/[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
