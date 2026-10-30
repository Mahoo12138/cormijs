export const DEFAULT_FRAMEWORK_NAME = 'cormi'

export const DEFAULT_CONFIG_FILES = [
  '.cormirc.ts',
  '.cormirc.mts',
  '.cormirc.js',
  '.cormirc.mjs',
  'config/config.ts',
  'config/config.mts',
  'config/config.js',
  'config/config.mjs',
]

export const SHORT_ENV: Record<string, string> = {
  development: 'dev',
  production: 'prod',
  test: 'test',
}

export const LOCAL_EXT = '.local'

export const WATCH_DEBOUNCE_STEP = 300

export const RESOLVE_EXTENSIONS = ['.tsx', '.ts', '.mts', '.mjs', '.jsx', '.js', '.cjs']
