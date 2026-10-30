import type { Arguments } from 'yargs-parser'
import type { Plugin } from './plugin.ts'

export type ResolveConfigMode = 'strict' | 'loose'

export const resolveConfigModes: ResolveConfigMode[] = ['strict', 'loose']

export interface ICommandOptions {
  name: string
  description?: string
  options?: string
  details?: string
  fn: (opts: { args: Arguments }) => any
  plugin: Plugin
  /** `strict` validates the user config before running, `loose` skips it */
  configResolveMode?: ResolveConfigMode
}

export class Command {
  name: string
  description?: string
  options?: string
  details?: string
  configResolveMode: ResolveConfigMode
  fn: (opts: { args: Arguments }) => any
  plugin: Plugin

  constructor(opts: ICommandOptions) {
    this.name = opts.name
    this.description = opts.description
    this.options = opts.options
    this.details = opts.details
    this.fn = opts.fn
    this.plugin = opts.plugin
    this.configResolveMode = opts.configResolveMode || 'strict'
  }
}
