import pc from 'picocolors'
import { createApp } from '../app.ts'
import { DEV_COMMAND } from '../constants.ts'
import { parseArgs } from './cli.ts'

process.env.NODE_ENV ??= 'development'

async function start() {
  const args = parseArgs(process.argv.slice(2))
  const { ctx, fiber } = await createApp({ name: DEV_COMMAND, args })

  let exiting = false
  const exit = (signal: NodeJS.Signals) => {
    if (exiting) return
    exiting = true
    ctx.logger.info?.(`terminated by ${signal}`)
    // dispose every effect: servers, watchers, bundler
    fiber.dispose().finally(() => process.exit(0))
  }
  process.on('SIGINT', exit)
  process.on('SIGTERM', exit)
}

process.on('unhandledRejection', (error) => {
  console.warn(pc.yellow('warn  -'), error)
})

start().catch((error) => {
  console.error(pc.red('fatal -'), error?.stack ?? error)
  process.exit(1)
})
