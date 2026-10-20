import { CormiError } from '@cormijs/core';

export interface TypecheckOptions {
  /** Project in the root tsconfig reference graph that owns generated application roots. */
  readonly generatedProject?: string;
}
export interface TypeDiagnostic { readonly code: number; readonly message: string; readonly project?: string; readonly file?: string; readonly line?: number; readonly column?: number }
export interface TypecheckResult {
  readonly compiler: string; readonly version: string; readonly files: number; readonly generatedFiles: readonly string[];
  readonly mode: 'single' | 'solution';
  readonly projects: readonly { readonly config: string; readonly files: number; readonly references: readonly string[]; readonly generated: boolean }[];
  readonly virtualDeclarations: number;
}
/** Domain contract: implementations are selected through native Cordis composition. */
export interface TypeChecker {
  check(root: string, generated: readonly string[], signal: AbortSignal, options?: TypecheckOptions): Promise<TypecheckResult>;
}
declare module 'cordis' { interface Context { typechecker: TypeChecker } }
export function typecheckOptions(value: unknown): TypecheckOptions {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new CormiError('TYPECHECK_OPTIONS_INVALID', 'typecheck must be an object.');
  }
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).some(key => key !== 'generatedProject') || entry.generatedProject !== undefined
    && (typeof entry.generatedProject !== 'string' || !entry.generatedProject || entry.generatedProject.length > 512)) {
    throw new CormiError('TYPECHECK_OPTIONS_INVALID', 'typecheck.generatedProject must name a project configuration.');
  }
  return Object.freeze({ generatedProject: entry.generatedProject as string | undefined });
}
