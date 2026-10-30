import type { Command } from '@cormi/core'
import pc from 'picocolors'
import type { IApi } from '../types.ts'

function padLeft(str: string) {
  return str.trim().split('\n').map(line => `    ${line}`).join('\n')
}

export default (api: IApi) => {
  api.registerCommand({
    name: 'help',
    alias: 'h',
    description: 'show commands help',
    details: `
cormi help build
cormi help dev
`,
    configResolveMode: 'loose',
    fn() {
      const subCommand = api.args._[0] as string | undefined
      if (!subCommand) return showHelps(api.service.commands)
      const command = api.service.commands[subCommand]
      if (!command) {
        api.logger.error(`Invalid sub command ${subCommand}.`)
        return
      }
      showHelp(command)
    },
  })

  function showHelp(command: Command) {
    console.log([
      '',
      `Usage: cormi ${command.name} [options]`,
      command.description ? `${pc.gray(command.description)}.\n` : '',
      command.options ? `Options:\n${padLeft(command.options)}\n` : '',
      command.details ? `Details:\n${padLeft(command.details)}` : '',
      '',
    ].join('\n'))
  }

  function showHelps(commands: Record<string, Command>) {
    // aliases share the command object of their target
    const seen = new Set<Command['fn']>()
    const lines = Object.keys(commands).sort().flatMap((key) => {
      const command = commands[key]
      if (seen.has(command.fn)) return []
      seen.add(command.fn)
      const aliases = Object.keys(commands).filter(name => name !== key && commands[name].fn === command.fn)
      const name = aliases.length ? `${key}, ${aliases.join(', ')}` : key
      return [`    ${pc.green(name.padEnd(14))}${command.description || ''}`]
    })
    console.log(`\nUsage: cormi <command> [options]\n\nCommands:\n\n${lines.join('\n')}\n`)
    console.log(`Run \`${pc.bold('cormi help <command>')}\` for more information of specific commands.\n`)
  }
}
