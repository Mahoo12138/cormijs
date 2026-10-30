import type { generateFile, installDeps, updatePackageJSON } from './utils/index.ts'
import type { Plugin } from './plugin.ts'

export enum GeneratorType {
  generate = 'generate',
  enable = 'enable',
}

export interface GeneratorHelpers {
  args: any
  generateFile: typeof generateFile
  updatePackageJSON: typeof updatePackageJSON
  installDeps: typeof installDeps
}

interface GeneratorBase {
  key: string
  name: string
  description: string
  fn: (opts: GeneratorHelpers) => any
  plugin: Plugin
}

export interface IGeneratorOptsWithoutEnableCheck extends GeneratorBase {
  type: GeneratorType.generate
}

export interface IGeneratorOptsWithEnableCheck extends GeneratorBase {
  type: GeneratorType.enable
  checkEnable: (opts: { args: any }) => boolean | Promise<boolean>
  disabledDescription: string | (() => string)
}

export type IGenerator = IGeneratorOptsWithEnableCheck | IGeneratorOptsWithoutEnableCheck

export function makeGenerator<T>(opts: T): T {
  return { ...opts }
}
