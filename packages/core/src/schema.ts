/**
 * SchemaService interface: declared in core so plugins that only depend on
 * @cormijs/core can reference ctx.schema without importing schemastery at runtime.
 * The implementation (SchemaServiceImpl) lives in cormijs which owns the dep.
 */
export interface SchemaService {
  extend(name: string, schema: unknown, order?: number): void;
  get(name: string): unknown;
  set(name: string, schema: unknown): void;
}

declare module 'cordis' {
  interface Context { schema: SchemaService }
  interface Events { 'internal/schema'(name: string): void }
}
