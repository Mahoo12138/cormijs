import type { Diagnosis } from './diagnose.js';
import type { EnvironmentSnapshot } from './environment.js';
export interface StartMessage {
  readonly environment: EnvironmentSnapshot;
  readonly version: 1; readonly type: 'start'; readonly root: string; readonly token: string;
  readonly module: string; readonly command: string; readonly mode: string; readonly timeoutMs: number;
  readonly serverOnlyFiles: readonly string[];
  readonly configurationCommand?: string;
}
export interface WireError { code: string; message: string; cause?: WireError }
export function wireError(error: unknown, depth = 0): WireError {
  if (!(error instanceof Error)) return { code: 'UNKNOWN_ERROR', message: String(error).slice(0, 4000) };
  const code = typeof (error as Error & { code?: unknown }).code === 'string' ? (error as Error & { code: string }).code : 'WORKER_FAILED';
  return { code, message: error.message.slice(0, 4000),
    ...(error.cause !== undefined && depth < 4 ? { cause: wireError(error.cause, depth + 1) } : {}) };
}
export type WorkerMessage =
  | { version: 1; type: 'diagnosis'; data: Diagnosis }
  | { version: 1; type: 'watch'; files: string[]; fingerprint: string }
  | { version: 1; type: 'ready'; url: string; applicationStatus?: 'ready' | 'error' }
  | { version: 1; type: 'result'; data: unknown }
  | { version: 1; type: 'error'; error: WireError }
  | { version: 1; type: 'stopped'; code: number };
