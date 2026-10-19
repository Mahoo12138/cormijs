import type {} from 'cordis';
import type { DevelopmentPlan, DevelopmentState } from './development.js';
export type { DevelopmentDiagnostic, DevelopmentPlan, DevelopmentState } from './development.js';
/** Deliberately backend-neutral. The first implementation supports HTML applications. */
export interface BuildPlan {
  /** Explicit public snapshot. Never includes private environment values or process.env as a whole. */
  readonly publicEnv?: Readonly<Record<string, string>>;
  readonly root: string;
  readonly entry: string;
  readonly outDir: string;
  readonly mode: string;
  readonly base: string;
  readonly serverOnlyFiles?: readonly string[];
  /** Dev-only recovery descriptor. Must never affect build or preview. */
  readonly development?: DevelopmentPlan;
  readonly server?: { readonly host?: string; readonly port?: number };
}

export interface ServerHandle {
  readonly url: string;
  readonly applicationStatus?: 'ready' | 'error';
  /** Development capability: invalidate committed project-relative files and reload clients. */
  invalidate?(files: readonly string[]): Promise<void>;
  setDevelopmentState?(state: DevelopmentState): Promise<void>;
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
