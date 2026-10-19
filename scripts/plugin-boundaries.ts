import ts from 'typescript';
import { builtinModules } from 'node:module';

const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
export function packageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0]!;
}
/** Audits syntax-level literal edges only; generated strings and computed imports require review. */
export function literalModuleEdges(source: string, filename: string): string[] {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const edges = new Set<string>();
  const add = (node: ts.Node | undefined) => { if (node && ts.isStringLiteralLike(node)) edges.add(node.text); };
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require')) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(tree); return [...edges].sort();
}
export function forbiddenPackages(edges: readonly string[], allowed: ReadonlySet<string>, nodeAllowed: boolean): string[] {
  return edges.filter(edge => {
    if (edge.startsWith('.')) return false;
    if (edge.startsWith('node:') || builtins.has(edge)) return !nodeAllowed;
    return !allowed.has(packageName(edge));
  });
}
