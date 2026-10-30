import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { merge } from 'es-toolkit/compat'

export type NpmClient = 'npm' | 'cnpm' | 'tnpm' | 'yarn' | 'pnpm' | 'bun'

export const npmClients: NpmClient[] = ['pnpm', 'tnpm', 'cnpm', 'yarn', 'bun', 'npm']

function findUp(cwd: string, files: string[]) {
  let dir = resolve(cwd)
  while (true) {
    for (const file of files) {
      if (existsSync(join(dir, file))) return file
    }
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

/** Detect the package manager of a project by its lockfile / workspace markers. */
export function getNpmClient(opts: { cwd: string }): NpmClient {
  const userAgent = process.env.npm_config_user_agent ?? ''
  const marker = findUp(opts.cwd, [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'yarn.lock',
    'bun.lockb',
    'bun.lock',
    'package-lock.json',
  ])
  if (marker?.startsWith('pnpm')) return 'pnpm'
  if (marker === 'yarn.lock') return 'yarn'
  if (marker?.startsWith('bun')) return 'bun'
  if (marker === 'package-lock.json') return 'npm'
  if (existsSync(join(opts.cwd, 'node_modules', '.pnpm'))) return 'pnpm'
  for (const client of npmClients) {
    if (userAgent.startsWith(client + '/')) return client
  }
  return 'npm'
}

/** Run `<client> install` in `cwd`. */
export function installWithNpmClient(opts: { npmClient: NpmClient; cwd?: string }) {
  // pnpm skips devDependencies when NODE_ENV === 'production'
  const { NODE_ENV: _, ...env } = process.env
  const result = spawnSync(opts.npmClient, opts.npmClient === 'yarn' ? [] : ['install'], {
    stdio: 'inherit',
    cwd: opts.cwd,
    env,
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
}

export interface InstallDepsOptions {
  dependencies?: string[]
  devDependencies?: string[]
}

/** Add dependencies with the project's package manager. */
export function installDeps(opts: { opts: InstallDepsOptions; cwd?: string }) {
  const cwd = opts.cwd ?? process.cwd()
  const client = getNpmClient({ cwd })
  const add = client === 'npm' ? 'install' : 'add'
  const dev = client === 'npm' ? '--save-dev' : '-D'
  const run = (deps: string[], isDev: boolean) => {
    if (!deps.length) return
    console.log(`${client} ${add} ${deps.join(' ')}`)
    const result = spawnSync(client, [add, ...(isDev ? [dev] : []), ...deps], {
      stdio: 'inherit',
      cwd,
      shell: process.platform === 'win32',
    })
    if (result.error) throw result.error
    if (result.status) throw new Error(`${client} ${add} failed with exit code ${result.status}`)
  }
  run(opts.opts.dependencies ?? [], false)
  run(opts.opts.devDependencies ?? [], true)
}

/** Deep-merge `opts` into `<cwd>/package.json`. */
export function updatePackageJSON(opts: { opts: Record<string, any>; cwd?: string }) {
  const pkgPath = resolve(opts.cwd ?? process.cwd(), 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  writeFileSync(pkgPath, `${JSON.stringify(merge(pkg, opts.opts), null, 2)}\n`)
}
