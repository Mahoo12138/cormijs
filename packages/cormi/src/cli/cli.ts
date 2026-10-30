import { type ChildProcess, fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import yParser from 'yargs-parser'
import { DEV_COMMAND, MIN_NODE_VERSION, RESTART_EXIT_CODE } from '../constants.ts'
import { createApp } from '../app.ts'

export function parseArgs(argv = process.argv.slice(2)) {
  return yParser(argv, {
    alias: { version: ['v'], help: ['h'] },
    boolean: ['version', 'help'],
  })
}

/** `cormi -v` -> `version`, `cormi` / `cormi -h` -> `help`. */
export function resolveCommand(args: yParser.Arguments) {
  const name = args._[0] as string | undefined
  if (args.version || name === 'v') return 'version'
  if (!name || args.help || name === 'h') return 'help'
  return name
}

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10)
  if (major < MIN_NODE_VERSION) {
    console.error(pc.red(`Cormi requires node >= ${MIN_NODE_VERSION}, current is ${process.versions.node}.`))
    process.exit(1)
  }
}

/**
 * The dev server runs in a worker process supervised by this one, like
 * koishi's daemon: the worker restarts in-process for most changes (config,
 * plugins), and exits with {@link RESTART_EXIT_CODE} when it needs a fresh
 * process (e.g. dependencies changed), after which it is forked again.
 */
function daemon(argv: string[]) {
  let child: ChildProcess | undefined
  let exiting = false

  const start = () => {
    child = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), argv, {
      env: { ...process.env, CORMI_DAEMON: '1' },
      stdio: 'inherit',
      execArgv: process.execArgv,
    })
    child.on('exit', (code) => {
      if (exiting) return
      if (code === RESTART_EXIT_CODE) return start()
      process.exit(code ?? 0)
    })
  }

  const onSignal = (signal: NodeJS.Signals) => {
    if (exiting) return
    exiting = true
    if (!child || child.exitCode !== null) process.exit(0)
    child.once('exit', () => process.exit(0))
    child.kill(signal)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  start()
}

export async function run(argv = process.argv.slice(2)) {
  checkNodeVersion()
  const args = parseArgs(argv)
  const name = resolveCommand(args)
  if (name === DEV_COMMAND || ['setup'].includes(name)) {
    process.env.NODE_ENV ??= 'development'
  } else if (['build', 'preview'].includes(name)) {
    process.env.NODE_ENV ??= 'production'
  }

  if (name === DEV_COMMAND && !process.env.CORMI_NO_DAEMON) {
    daemon(argv)
    return
  }

  try {
    const { fiber } = await createApp({ name, args })
    // long-running commands (preview) keep the process alive through their servers
    if (name !== 'preview') await fiber.dispose()
  } catch (error: any) {
    console.error(pc.red('fatal -'), error?.stack ?? error)
    process.exit(1)
  }
}
