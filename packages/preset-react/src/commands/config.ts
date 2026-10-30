import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { generate } from '@babel/generator'
import { parse, parseExpression } from '@babel/parser'
import type * as t from '@babel/types'
import pc from 'picocolors'
import type { IApi } from '../types.ts'

function list(config: Record<string, any>, name?: string) {
  const print = (key: string) => {
    const value = typeof config[key] === 'function'
      ? pc.yellow('The value data type does not support the view')
      : inspect(config[key], { depth: 4, colors: pc.isColorSupported })
    console.log(` - ${pc.blue(`[key: ${key}]`)} ${value}\n`)
  }
  console.log('\n  Configs:\n')
  if (name) {
    if (!(name in config)) throw new Error(`key ${name} not found`)
    print(name)
  } else {
    Object.keys(config).sort().forEach(print)
  }
}

/** The object literal of `export default {...}` / `export default defineConfig({...})`. */
function findConfigObject(ast: t.File): t.ObjectExpression | undefined {
  const resolveIdentifier = (name: string) => {
    for (const node of ast.program.body) {
      if (node.type !== 'VariableDeclaration') continue
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier' && decl.id.name === name && decl.init) return decl.init
      }
    }
  }
  const unwrap = (node: t.Node | undefined | null): t.ObjectExpression | undefined => {
    if (!node) return
    if (node.type === 'ObjectExpression') return node
    if (node.type === 'CallExpression') return unwrap(node.arguments[0] as t.Node)
    if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') return unwrap(node.expression)
    if (node.type === 'Identifier') return unwrap(resolveIdentifier(node.name))
  }
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') return unwrap(node.declaration as t.Node)
  }
}

function keyOf(prop: t.ObjectProperty) {
  if (prop.key.type === 'Identifier') return prop.key.name
  if (prop.key.type === 'StringLiteral') return prop.key.value
}

function parseValue(value: string): t.Expression {
  try {
    return parseExpression(value, { plugins: ['typescript'] })
  } catch {
    return { type: 'StringLiteral', value } as t.StringLiteral
  }
}

function updateConfigFile(file: string, update: (config: t.ObjectExpression) => void) {
  const code = readFileSync(file, 'utf8')
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const config = findConfigObject(ast)
  if (!config) throw new Error(`Cannot find the default exported config object in ${file}`)
  update(config)
  writeFileSync(file, generate(ast, { retainLines: false }, code).code + '\n', 'utf8')
}

export function setConfig(file: string, name: string, value: string) {
  updateConfigFile(file, (config) => {
    const existing = config.properties.find((prop): prop is t.ObjectProperty => prop.type === 'ObjectProperty' && keyOf(prop) === name)
    const expression = parseValue(value)
    if (existing) {
      existing.value = expression
    } else {
      const key: t.Identifier | t.StringLiteral = /^[A-Za-z_$][\w$]*$/.test(name)
        ? { type: 'Identifier', name } as t.Identifier
        : { type: 'StringLiteral', value: name } as t.StringLiteral
      config.properties.push({ type: 'ObjectProperty', key, value: expression, computed: false, shorthand: false } as t.ObjectProperty)
    }
  })
}

export function removeConfig(file: string, name: string) {
  updateConfigFile(file, (config) => {
    config.properties = config.properties.filter(prop => !(prop.type === 'ObjectProperty' && keyOf(prop) === name))
  })
}

export default (api: IApi) => {
  api.registerCommand({
    name: 'config',
    description: 'cormi config cli',
    details: `
# List configs
$ cormi config list
$ cormi config list --all

# Get the specific config
$ cormi config list --name history
$ cormi config get history

# Set the specific config
$ cormi config set history "{ type: 'hash' }"

# Remove the specific config
$ cormi config remove history
$ cormi config r history
`.trim(),
    configResolveMode: 'loose',
    async fn({ args }) {
      const { _, all = false } = args
      const [command, name, value] = _ as string[]
      switch (command) {
        case 'list':
          list(all ? api.config : api.userConfig, args.name)
          return
        case 'get':
          list(api.config, name)
          return
        case 'set': {
          let file = api.appData.mainConfigFile
          if (!file) {
            file = join(api.cwd, '.cormirc.ts')
            if (!existsSync(file)) writeFileSync(file, `import { defineConfig } from 'cormi';\n\nexport default defineConfig({});\n`)
            api.appData.mainConfigFile = file
          }
          setConfig(file, name, value)
          console.log(`set config:${name} on ${file}`)
          return
        }
        case 'remove':
        case 'r': {
          const file = api.appData.mainConfigFile
          if (!file) throw new Error('No config file found.')
          removeConfig(file, name)
          console.log(`remove config:${name} on ${file}`)
          return
        }
        default:
          throw new Error(`Unsupported sub command ${command} for cormi config.`)
      }
    },
  })
}
