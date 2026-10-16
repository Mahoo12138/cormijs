import type {} from 'cordis';

/** Deliberately backend-neutral. The first implementation supports HTML applications. */
export interface BuildPlan {
  readonly root: string;
  readonly entry: string;
  readonly outDir: string;
  readonly mode: string;
  readonly base: string;
  readonly serverOnlyFiles?: readonly string[];
  readonly server?: { readonly host?: string; readonly port?: number };
}

export interface ServerHandle {
  readonly url: string;
  /** Development capability: invalidate committed project-relative files and reload clients. */
  invalidate?(files: readonly string[]): Promise<void>;
  close(): Promise<void>;
}

export interface BuildResult {
  readonly backend: string;
  readonly outDir: string;
}

export interface Builder {
  readonly name: string;
  dev(plan: BuildPlan, signal?: AbortSignal): Promise<ServerHandle>;
  build(plan: BuildPlan, signal?: AbortSignal): Promise<BuildResult>;
  preview(plan: BuildPlan, signal?: AbortSignal): Promise<ServerHandle>;
}

declare module 'cordis' {
  interface Context { builder: Builder }
}
