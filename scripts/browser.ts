import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

/** A chromium from playwright's cache, or `CHROMIUM_PATH`. */
export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const cache = join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
  if (!existsSync(cache)) return
  const dirs = readdirSync(cache).filter(dir => dir.startsWith('chromium_headless_shell-')).sort().reverse()
  for (const dir of dirs) {
    for (const sub of readdirSync(join(cache, dir))) {
      for (const name of ['chrome-headless-shell', 'headless_shell']) {
        const file = join(cache, dir, sub, name)
        if (existsSync(file)) return file
      }
    }
  }
}

export function launch() {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('No chromium found, set CHROMIUM_PATH')
  return chromium.launch({ executablePath })
}
