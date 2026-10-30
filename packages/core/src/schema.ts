import type { StandardSchemaV1 } from '@standard-schema/spec'
import joi from 'joi'
import Schema from 'schemastery'
import { z } from 'zod'
import type { ConfigSchema, IPluginConfig, JoiRoot, SchemaHelpers } from './types.ts'

export { joi, Schema, z }

let helpers: (JoiRoot & SchemaHelpers) | undefined

/** `joi` merged with `{ zod, z, Schema }`, the argument of `describe({ config: { schema } })`. */
export function getSchemaHelpers(): JoiRoot & SchemaHelpers {
  // umi passes `{ ...joi, zod }`; the spread keeps joi's root methods callable unbound
  return helpers ??= { ...joi, zod: z, z, Schema } as JoiRoot & SchemaHelpers
}

export function isStandardSchema(value: any): value is StandardSchemaV1 {
  return !!value && (typeof value === 'object' || typeof value === 'function') && '~standard' in value
}

export function isJoiSchema(value: any): value is { validate(value: any): { error?: Error; value: any } } {
  return !!value && typeof value === 'object' && (joi.isSchema(value) || value.isJoi === true)
}

/** Turn `IPluginConfig['schema']` into a concrete schema object. */
export function resolveSchema(schema: IPluginConfig['schema']): ConfigSchema | undefined {
  if (!schema) return
  // a schemastery schema is a function *and* a Standard Schema
  if (isStandardSchema(schema) || isJoiSchema(schema)) return schema
  if (typeof schema === 'function') return schema(getSchemaHelpers())
  throw new TypeError('config.schema should be a schema or a function returning one')
}

export type ValidationResult =
  | { value: any; issues?: undefined }
  | { value?: undefined; issues: { message: string; path?: (string | number)[] }[] }

/** Validate synchronously with either a Standard Schema or a joi schema. */
export function validateSchema(schema: ConfigSchema, value: any): ValidationResult {
  if (isStandardSchema(schema)) {
    const result = schema['~standard'].validate(value)
    if (result instanceof Promise) {
      throw new TypeError('async config schemas are not supported')
    }
    if (result.issues) {
      return {
        issues: result.issues.map(issue => ({
          message: issue.message,
          path: issue.path?.map(segment => typeof segment === 'object' ? segment.key as any : segment),
        })),
      }
    }
    return { value: result.value }
  }
  if (isJoiSchema(schema)) {
    const { error, value: output } = schema.validate(value)
    if (error) return { issues: [{ message: error.message }] }
    return { value: output }
  }
  throw new TypeError('invalid config schema, expected a Standard Schema (zod, schemastery, ...) or a joi schema')
}

export function formatIssues(issues: { message: string; path?: (string | number)[] }[]) {
  return issues.map(issue => issue.path?.length
    ? `  - ${issue.message} (at ${issue.path.join('.')})`
    : `  - ${issue.message}`).join('\n')
}
