import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'dotenv'
import { expand } from 'dotenv-expand'

/** Load `.env` and `.env.local` into `process.env` (later files win). */
export function loadEnv(opts: { cwd: string; envFile: string }) {
  const files = [
    join(opts.cwd, opts.envFile),
    join(opts.cwd, `${opts.envFile}.local`),
  ]
  for (const file of files) {
    if (!existsSync(file)) continue
    const parsed: Record<string, string> = parse(readFileSync(file)) || {}
    expand({ parsed, processEnv: {} as any })
    for (const key of Object.keys(parsed)) {
      process.env[key] = parsed[key]
    }
  }
}
