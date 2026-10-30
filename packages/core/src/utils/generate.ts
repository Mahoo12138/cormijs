import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import Mustache from 'mustache'
import pc from 'picocolors'
import prompts from 'prompts'
import { glob } from 'tinyglobby'

export interface GeneratorOptions {
  baseDir: string
  args?: Record<string, any>
  /** suppress the `Write:` / `Copy:` lines */
  silent?: boolean
}

/** Minimal yeoman-like generator (umi's `Generator`). */
export class Generator {
  baseDir: string
  args: Record<string, any>
  silent: boolean
  prompts: Record<string, any> = {}

  constructor(opts: GeneratorOptions) {
    this.baseDir = opts.baseDir
    this.args = opts.args ?? {}
    this.silent = !!opts.silent
  }

  async run() {
    const questions = this.prompting()
    this.prompts = questions.length
      ? await prompts(questions, { onCancel() { process.exit(1) } })
      : {}
    await this.writing()
  }

  prompting(): prompts.PromptObject[] {
    return []
  }

  async writing() {}

  copyTpl(opts: { templatePath: string; target: string; context: Record<string, any> }) {
    const tpl = readFileSync(opts.templatePath, 'utf8')
    const content = Mustache.render(tpl, opts.context)
    mkdirSync(dirname(opts.target), { recursive: true })
    if (!this.silent) console.log(`${pc.green('Write:')} ${relative(this.baseDir, opts.target)}`)
    writeFileSync(opts.target, content, 'utf8')
  }

  async copyDirectory(opts: { path: string; target: string; context: Record<string, any> }) {
    const files = await glob('**/*', { cwd: opts.path, dot: true, ignore: ['**/node_modules/**'] })
    for (const file of files.sort()) {
      const absFile = join(opts.path, file)
      if (file.endsWith('.tpl')) {
        this.copyTpl({
          templatePath: absFile,
          target: join(opts.target, file.replace(/\.tpl$/, '')),
          context: opts.context,
        })
      } else {
        if (!this.silent) console.log(`${pc.green('Copy: ')} ${file}`)
        const absTarget = join(opts.target, file)
        mkdirSync(dirname(absTarget), { recursive: true })
        copyFileSync(absFile, absTarget)
      }
    }
  }
}

export interface BaseGeneratorOptions extends Partial<GeneratorOptions> {
  path: string
  target: string
  data?: Record<string, any>
  questions?: prompts.PromptObject[]
}

/** Copy a template file or directory, rendering `*.tpl` files with Mustache. */
export class BaseGenerator extends Generator {
  path: string
  target: string
  data: Record<string, any>
  questions: prompts.PromptObject[]

  constructor(opts: BaseGeneratorOptions) {
    super({ baseDir: opts.baseDir ?? opts.target, args: opts.data, silent: opts.silent })
    this.path = opts.path
    this.target = opts.target
    this.data = opts.data ?? {}
    this.questions = opts.questions ?? []
  }

  prompting() {
    return this.questions
  }

  async writing() {
    const context = { ...this.data, ...this.prompts }
    if (statSync(this.path).isDirectory()) {
      await this.copyDirectory({ context, path: this.path, target: this.target })
    } else if (this.path.endsWith('.tpl')) {
      this.copyTpl({ templatePath: this.path, target: this.target, context })
    } else {
      mkdirSync(dirname(this.target), { recursive: true })
      copyFileSync(this.path, this.target)
    }
  }
}

export async function generateFile(opts: BaseGeneratorOptions) {
  await new BaseGenerator(opts).run()
}

export { Mustache, prompts }
