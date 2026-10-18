import { CormiError } from '@cormijs/core';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type RouteMeta = Readonly<Record<string, JsonValue>>;

/** Copy public data before registration; never retain mutable objects or evaluate accessors. */
export function jsonData(value: unknown, code = 'ROUTE_META_INVALID'): JsonValue {
  let nodes = 0, bytes = 0;
  const active = new Set<object>();
  const fail = (): never => { throw new CormiError(code, 'Expected bounded, finite, acyclic JSON data without reserved keys or accessors.'); };
  const charge = (text: string) => { bytes += Buffer.byteLength(text); if (bytes > 65536) fail(); };
  function copy(input: unknown, depth: number): JsonValue {
    if (++nodes > 10000 || depth > 48) return fail();
    if (input === null || typeof input === 'boolean' || typeof input === 'string' && input.length <= 65536
      || typeof input === 'number' && Number.isFinite(input)) { charge(JSON.stringify(input)); return input; }
    if (!input || typeof input !== 'object' || active.has(input)) return fail();
    if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return fail();
    active.add(input);
    try {
      const keys = Reflect.ownKeys(input);
      if (Array.isArray(input)) {
        if (input.length > 10000 || keys.length !== input.length + 1) return fail();
        charge('[]' + ','.repeat(Math.max(0, input.length - 1)));
        const result: JsonValue[] = [];
        for (let i = 0; i < input.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
          if (!descriptor || !('value' in descriptor)) return fail();
          result.push(copy(descriptor.value, depth + 1));
        }
        return Object.freeze(result);
      }
      const entries: Array<[string, JsonValue]> = [];
      charge('{}');
      for (const key of keys) {
        if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) return fail();
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!descriptor.enumerable || !('value' in descriptor)) return fail();
        charge((entries.length ? ',' : '') + JSON.stringify(key) + ':');
        entries.push([key, copy(descriptor.value, depth + 1)]);
      }
      return Object.freeze(Object.fromEntries(entries));
    } finally { active.delete(input); }
  }
  return copy(value, 0);
}
export function routeMeta(value: unknown): RouteMeta {
  const result = jsonData(value);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new CormiError('ROUTE_META_INVALID', 'Route meta must be a JSON object.');
  return result as RouteMeta;
}
