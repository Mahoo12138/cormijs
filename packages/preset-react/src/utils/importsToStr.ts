import type { IEntryImport } from '../types.ts'

export function importsToStr(imports: (IEntryImport | false | null | undefined)[]) {
  return imports.filter(Boolean).map((imp) => {
    const { source, specifier } = imp as IEntryImport
    if (specifier) return `import ${specifier} from '${winPath(source)}';`
    return `import '${winPath(source)}';`
  })
}

function winPath(path: string) {
  return path.replace(/\\/g, '/')
}
