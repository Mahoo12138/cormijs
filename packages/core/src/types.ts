import type { StandardSchemaV1 } from '@standard-schema/spec'

export enum Env {
  development = 'development',
  production = 'production',
  test = 'test',
}

export enum PluginType {
  preset = 'preset',
  plugin = 'plugin',
}

export enum ServiceStage {
  uninitialized,
  init,
  initPresets,
  initPlugins,
  resolveConfig,
  collectAppData,
  onCheck,
  onStart,
  runCommand,
}

export enum ConfigChangeType {
  /** restart the app (in-process: the service fiber is restarted) */
  reload = 'reload',
  regenerateTmpFiles = 'regenerateTmpFiles',
  /** reload only the plugin owning the key (`fiber.update()`); default of cordis-native plugins */
  reloadPlugin = 'reloadPlugin',
}

export type ChangeTypeValue = string | `${ConfigChangeType}` | Function
export type IOnChangeTypes = Record<string, ChangeTypeValue>

export enum ApplyPluginsType {
  add = 'add',
  modify = 'modify',
  event = 'event',
}

export enum EnableBy {
  register = 'register',
  config = 'config',
}

export type EnableByFunction = (opts: { userConfig: any; config: any; env: Env }) => boolean

/**
 * Anything that can validate a config value: a Standard Schema (schemastery, zod, valibot, ...)
 * or a joi schema (for umi compatibility).
 */
export type ConfigSchema = StandardSchemaV1 | { isJoi?: boolean; validate(value: any): any }

export interface SchemaHelpers {
  /** zod (v4), implements Standard Schema */
  zod: typeof import('zod')
  /** alias of `zod` */
  z: typeof import('zod')
  /** schemastery, the schema library of the cordis ecosystem */
  Schema: typeof import('schemastery')
}

export type JoiRoot = typeof import('joi')

export interface IPluginConfig {
  default?: any
  /**
   * Either a schema, or a factory receiving `joi` merged with `{ zod, z, Schema }`
   * (umi passes `{ ...joi, zod }`, so `schema({ zod })` and `schema(joi)` both work).
   */
  schema?: ConfigSchema | ((helpers: JoiRoot & SchemaHelpers) => ConfigSchema)
  onChange?: ChangeTypeValue
}

export interface IRoute {
  path: string
  absPath: string
  file?: string
  id: string
  parentId?: string
  [key: string]: any
}

type HookOptions = {
  name?: string
  before?: string | string[]
  stage?: number
}

export interface IEvent<T> {
  (fn: { (args: T): void | Promise<void> }): () => void
  (args: HookOptions & { fn: { (args: T): void | Promise<void> } }): () => void
}

export interface IModify<T, U> {
  (fn: { (initialValue: T, args: U): T | Promise<T> }): () => void
  (args: HookOptions & { fn: { (initialValue: T, args: U): T | Promise<T> } }): () => void
}

export interface IAdd<T, U> {
  (fn: { (args: T): U | U[] | Promise<U | U[]> }): () => void
  (args: HookOptions & { fn: { (args: T): U | U[] | Promise<U | U[]> } }): () => void
}

export type IFrameworkType = 'react'
