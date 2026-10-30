import { tsImport } from 'tsx/esm/api'
import { pathToFileURL } from 'node:url'
const url = pathToFileURL('/tmp/tsx-exp/conf.ts').href
for (let i = 0; i < 2; i++) {
  const deps = []
  const mod = await tsImport(url, { parentURL: import.meta.url, onImport: (u) => deps.push(u) })
  const v = mod.default?.__esModule ? mod.default.default : mod.default
  console.log(i, JSON.stringify(v), deps)
}
