import type {} from 'cordis';
import type { ConfigurationContext } from './config-data.js';

/** Host protocol only. Individual plugins own command names and application policy. */
export interface CommandRequest {
  /** Explicit browser-public bootstrap values; absent in low-level hosts unless supplied. */
  readonly publicEnv?: Readonly<Record<string, string>>;
  readonly root: string;
  readonly mode: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  /** Bootstrap provenance only, without old values or private plugin options. */
  readonly configuration?: ConfigurationContext;
  /** Configuration inputs must not be served to application clients. */
  readonly serverOnlyFiles?: readonly string[];
}
export type CommandResult =
  | { readonly kind: 'result'; readonly data: unknown }
  | { readonly kind: 'server'; readonly handle: { readonly url: string; readonly applicationStatus?: 'ready' | 'error'; close(): Promise<void> } };
export type CommandHandler = (request: CommandRequest) => Promise<CommandResult>;
export type CommandMiddleware = (name: string, request: CommandRequest, next: CommandHandler) => Promise<CommandResult>;
export interface CommandRegistry {
  use(id: string, middleware: CommandMiddleware): () => void;
  register(name: string, handler: CommandHandler): () => void;
  execute(name: string, request: CommandRequest): Promise<CommandResult>;
  names(): readonly string[];
}
declare module 'cordis' { interface Context { commands: CommandRegistry } }
