import assert from 'node:assert/strict';
import ts from 'typescript';

/** Template-local utility: the selected Vite backend supplies its resolved public base. */
export const publicAssetModule = String.raw`/** Public files belong to this application's deployment prefix, not the domain root. */
export function publicAsset(path: string): string {
  const base = import.meta.env.BASE_URL;
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new TypeError('Unsupported application base');
  if (!/^\/assets\/[A-Za-z0-9_./-]+$/.test(path) || path.slice(1).split('/').some(part => !part || part === '.' || part === '..')) {
    throw new TypeError('Expected a local public asset path');
  }
  return base + path.slice(1);
}
`;

export interface AssetEdit { readonly line: number; readonly kind: 'literal' | 'template' | 'css-url'; readonly original: string }
/** Only reviewed TS/TSX literal nodes are rewritten; not imports, comments, URLs or arbitrary source text. */
export function adaptAssetReferences(filename: string, source: string): { code: string; edits: readonly AssetEdit[] } {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const patches: Array<{ start: number; end: number; text: string; edit: AssetEdit }> = [];
  const helperPath = 'src/utils/public-asset';
  let helperImports = 0, conflictingBinding = false;
  function namesHelper(name: ts.Node | undefined): boolean {
    if (!name) return false;
    if (ts.isIdentifier(name)) return name.text === 'publicAsset';
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      return name.elements.some(element => ts.isBindingElement(element) && namesHelper(element.name));
    }
    return false;
  }
  // A conservative file-level binding check also rejects nested shadowing. Never infer bindings from comments.
  function inspectBindings(node: ts.Node): void {
    if (ts.isImportSpecifier(node) && node.name.text === 'publicAsset') {
      const clause = node.parent.parent, declaration = clause.parent;
      if (!node.isTypeOnly && !clause.isTypeOnly && (!node.propertyName || node.propertyName.text === 'publicAsset')
        && ts.isImportDeclaration(declaration) && ts.isStringLiteral(declaration.moduleSpecifier)
        && declaration.moduleSpecifier.text === helperPath) helperImports++;
      else conflictingBinding = true;
    } else if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)
      || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)
      || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)
      || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) || ts.isTypeAliasDeclaration(node)
      || ts.isInterfaceDeclaration(node) || ts.isTypeParameterDeclaration(node)) {
      if (namesHelper(node.name)) conflictingBinding = true;
    }
    ts.forEachChild(node, inspectBindings);
  }
  inspectBindings(file);
  function isModuleReference(node: ts.Node): boolean {
    const parent = node.parent;
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
    if (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) return true;
    if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) return false;
    const callee = parent.expression;
    return callee.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(callee) && callee.text === 'require'
      || ts.isPropertyAccessExpression(callee) && callee.name.text === 'resolve'
        && (ts.isIdentifier(callee.expression) && callee.expression.text === 'require'
          || ts.isMetaProperty(callee.expression) && callee.expression.keywordToken === ts.SyntaxKind.ImportKeyword);
  }
  function visit(node: ts.Node): void {
    let value: string | undefined, expression: string | undefined, kind: AssetEdit['kind'] = 'literal';
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      value = node.text;
      if (value.startsWith('/assets/')) expression = `publicAsset(${JSON.stringify(value)})`;
      else {
        const css = /^url\((\/assets\/[^()]+)\)$/.exec(value);
        if (css) { expression = `'url("' + publicAsset(${JSON.stringify(css[1])}) + '")'`; kind = 'css-url'; }
      }
    } else if (ts.isTemplateExpression(node) && node.head.text.startsWith('/assets/')) {
      expression = `publicAsset(${node.getText(file)})`; kind = 'template';
    }
    if (expression) {
      assert.ok(!isModuleReference(node), 'Asset module imports require a separate migration decision');
      // Literal types describe types rather than runtime resource addresses.
      if (ts.isLiteralTypeNode(node.parent)) return;
      if (ts.isCallExpression(node.parent) && node.parent.expression.getText(file) === 'publicAsset') {
        assert.ok(helperImports === 1 && !conflictingBinding, 'Conflicting or unverified asset helper binding');
        return;
      }
      const start = node.getStart(file);
      patches.push({ start, end: node.end, text: ts.isJsxAttribute(node.parent) ? `{${expression}}` : expression,
        edit: { line: file.getLineAndCharacterOfPosition(start).line + 1, kind, original: node.getText(file) } });
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!patches.length) return { code: source, edits: [] };
  assert.ok(!conflictingBinding && helperImports <= 1, 'Conflicting asset helper binding');
  let code = source;
  for (const patch of [...patches].sort((a, b) => b.start - a.start)) code = code.slice(0, patch.start) + patch.text + code.slice(patch.end);
  if (!helperImports) code = "import { publicAsset } from 'src/utils/public-asset';\n" + code;
  const syntax = ts.transpileModule(code, { fileName: filename, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  assert.equal(syntax.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error).length ?? 0, 0, 'Invalid adapted asset expression');
  return { code, edits: patches.map(patch => patch.edit) };
}
