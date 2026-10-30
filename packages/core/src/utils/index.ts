import { camelCase, cloneDeep, debounce, escapeRegExp, get, intersection, isEqual, isPlainObject, merge, set, uniq, uniqBy, unset } from 'es-toolkit/compat'

export * from './generate.ts'
export * from './load.ts'
export * from './npm.ts'
export * from './path.ts'

/** The subset of lodash used across Cormi (backed by `es-toolkit/compat`). */
export const lodash = { camelCase, cloneDeep, debounce, escapeRegExp, get, intersection, isEqual, isPlainObject, merge, set, uniq, uniqBy, unset }

export function makeArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** Whether `value` is an ES class (as opposed to a plain or arrow function). */
export function isClass(value: any): value is new (...args: any[]) => any {
  return typeof value === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(value))
}

/**
 * `initial-state` -> `initialState`, `webpack.css-loader` -> `webpack.cssLoader`.
 * Plugin keys are derived from file / package names with this function.
 */
export function nameToKey(name: string) {
  return name.split('.').map(part => camelCase(part)).join('.')
}

export function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
