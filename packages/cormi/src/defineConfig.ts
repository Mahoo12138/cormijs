import type { IConfig } from '@cormi/preset-react'

/** Type helper for `.cormirc.ts` / `config/config.ts`. */
export function defineConfig<T extends IConfig>(config: T): T {
  return config
}
