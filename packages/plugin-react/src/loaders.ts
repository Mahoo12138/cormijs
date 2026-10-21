export interface LoaderTypeEntry {
  readonly id: string;
  /** Module specifier relative to `.cormi/`, as produced by the client module resolver. */
  readonly specifier: string;
  readonly exportName: string;
}

/**
 * Generated namespace keyed by route id. The conditional keeps a missing loader export a type error
 * in the application instead of silently widening to `unknown`.
 */
export function generateLoaderTypes(entries: readonly LoaderTypeEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rows = sorted.map(({ id, specifier, exportName }) =>
    `    ${JSON.stringify(id)}: Awaited<ReturnType<typeof import(${JSON.stringify(specifier)})[${JSON.stringify(exportName)}]>>;`);
  return `declare namespace CormiLoaderData {
  interface Routes {
${rows.join('\n')}${rows.length ? '\n' : ''}  }
  type Data<Id extends keyof Routes> = Routes[Id];
}
`;
}
