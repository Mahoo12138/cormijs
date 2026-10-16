import type {} from 'cordis';

/** Host protocol only. Individual plugins own command names and application policy. */
export interface CommandRequest {
  readonly root: string;
  readonly mode: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  /** Configuration inputs must not be served to application clients. */
  readonly serverOnlyFiles?: readonly string[];
}
export type CommandResult =
  | { readonly kind: 'result'; readonly data: unknown }
  | { readonly kind: 'server'; readonly handle: { readonly url: string; close(): Promise<void> } };
export type CommandHandler = (request: CommandRequest) => Promise<CommandResult>;
export interface CommandRegistry {
  register(name: string, handler: CommandHandler): () => void;
  execute(name: string, request: CommandRequest): Promise<CommandResult>;
  names(): readonly string[];
}
declare module 'cordis' { interface Context { commands: CommandRegistry } }
