import { Context, Exporter, Logger, Message } from 'cordis'
import pc from 'picocolors'

export type CormiLogType = 'wait' | 'error' | 'warn' | 'ready' | 'info' | 'event' | 'debug' | 'fatal'

export type CormiLogMethod = (...message: any[]) => void

/** umi-compatible logger: `wait`, `ready`, `event`, ... plus `profile(id)` for timings. */
export interface CormiLogger extends Record<CormiLogType, CormiLogMethod> {
  profile(id: string, ...message: any[]): void
}

const cordisType: Record<CormiLogType, 'error' | 'info' | 'warn' | 'debug'> = {
  wait: 'info',
  ready: 'info',
  event: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
  debug: 'debug',
}

const profilers: Record<string, number> = Object.create(null)

export interface LoggerMeta {
  /** umi-style label, rendered as `ready -`, `event -`, ... */
  label?: CormiLogType | 'profile'
  /** id of the cormi plugin that logged the message */
  plugin?: string
}

/**
 * Create a umi-style logger that writes through the cordis logger service,
 * so messages reach every registered exporter (console, files, devtools...).
 */
export function createLogger(ctx: Context, name = 'cormi', meta: LoggerMeta = {}): CormiLogger {
  const loggers: Partial<Record<string, Logger>> = {}
  const get = (label: CormiLogType | 'profile') => {
    return loggers[label] ??= new Logger({ name, meta: { ...meta, label } as any }, ctx.logger as any)
  }
  const result = {} as CormiLogger
  for (const type of Object.keys(cordisType) as CormiLogType[]) {
    result[type] = (...message: any[]) => {
      const normalized = normalize(message)
      ;(get(type)[cordisType[type]] as any)(normalized[0], ...normalized.slice(1))
    }
  }
  result.profile = (id: string, ...message: any[]) => {
    const key = `${name}:${id}`
    if (!(key in profilers)) {
      profilers[key] = Date.now()
      const normalized = normalize([pc.green(id), ...message])
      ;(get('profile').info as any)(normalized[0], ...normalized.slice(1))
      return
    }
    const time = Date.now() - profilers[key]
    delete profilers[key]
    const normalized = normalize([pc.green(id), `Completed in ${pc.cyan(`${time}ms`)}`, ...message])
    ;(get('profile').info as any)(normalized[0], ...normalized.slice(1))
  }
  return result
}

// cordis treats a non-string first argument as `%o`; join plain values like console.log does
function normalize(message: any[]) {
  if (!message.length) return ['']
  if (message[0] instanceof Error) return message
  if (typeof message[0] === 'string') return [message[0].replace(/%/g, '%%'), ...message.slice(1)]
  return ['%s', ...message]
}

const labelColor: Record<string, (text: string) => string> = {
  wait: pc.cyan,
  error: pc.red,
  fatal: pc.red,
  warn: pc.yellow,
  ready: pc.green,
  info: pc.cyan,
  event: pc.magenta,
  debug: pc.gray,
  profile: pc.blue,
}

export namespace ConsoleExporter {
  export interface Config {
    /** override the log level (0 error, 1 warn, 2 info, 3 debug); defaults to 3 when `DEBUG` is set */
    level?: number
    /** print timestamps */
    showTime?: boolean
  }
}

/**
 * Console exporter rendering cordis log messages in umi's style:
 *
 * ```
 * ready - App listening at http://localhost:8000
 * info  - [plugin: ./plugin] hello
 * ```
 *
 * The same `Error` object is only printed once: when a plugin fails, its fiber
 * logs the error, and the failure then propagates through `await fiber` to the
 * service, which would otherwise print it again.
 */
export class ConsoleExporter implements Exporter {
  static readonly name = 'cormi-console'

  colors = pc.isColorSupported ? 3 : false as const
  levels: Record<string, number>
  private printed = new WeakSet<object>()

  constructor(ctx: Context, public config: ConsoleExporter.Config = {}) {
    this.levels = { default: config.level ?? (process.env.DEBUG ? 3 : 2) }
    ctx.logger.exporter(this)
  }

  export(message: Message & LoggerMeta) {
    const error = message.args.find(arg => arg instanceof Error)
    if (error) {
      if (this.printed.has(error)) return
      this.printed.add(error)
    }
    const label = message.label ?? message.type
    const color = labelColor[label] ?? ((text: string) => text)
    let prefix = `${color(label)}${' '.repeat(Math.max(1, 6 - label.length))}-`
    if (this.config.showTime) prefix = pc.gray(new Date(message.ts).toLocaleTimeString()) + ' ' + prefix
    let tag = ''
    if (message.plugin) {
      tag = pc.green(`[plugin: ${message.plugin}]`) + ' '
    } else if (message.name && message.name !== 'cormi' && message.name !== 'root') {
      tag = pc.dim(`[${message.name}]`) + ' '
    }
    const text = Logger.format(this, message)
    const output = `${prefix} ${tag}${text}`
    if (message.type === 'error') {
      console.error(output)
    } else if (message.type === 'warn') {
      console.warn(output)
    } else {
      console.log(output)
    }
  }
}
