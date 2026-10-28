import type { Context } from 'cordis';
import Schema from '@cormijs/schemastery';

const kSchemaOrder = Symbol('schema-order');

/**
 * SchemaService implementation. Lives here (not in @cormijs/core) so that core
 * stays free of the schemastery runtime dependency and passes the isolation gate.
 * The SchemaService *interface* is declared in @cormijs/core so plugins that only
 * depend on core can still reference ctx.schema without importing schemastery.
 */
export class SchemaServiceImpl {
  readonly data = new Map<string, Schema>();

  constructor(private ctx: Context) {}

  extend(name: string, schema: Schema, order = 0): void {
    const target = this.get(name);
    if (!target) {
      this.set(name, schema);
      return;
    }
    const idx = target.list?.findIndex((s: any) => (s as any)[kSchemaOrder] < order) ?? -1;
    (schema as any)[kSchemaOrder] = order;
    if (target.list) {
      if (idx >= 0) target.list.splice(idx, 0, schema);
      else target.list.push(schema);
    }
    this.ctx.emit('internal/schema', name);
  }

  get(name: string): Schema | undefined {
    return this.data.get(name);
  }

  set(name: string, schema: Schema): void {
    this.data.set(name, schema);
    this.ctx.emit('internal/schema', name);
  }
}
