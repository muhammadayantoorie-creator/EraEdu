// Static coverage of literal queries/writes, not a proof of dynamic SQL or
// business behavior. Used alongside the full migration replay and workflow tests.
import ts from 'typescript';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export async function collectRuntimeContracts(root) {
  async function list(dir) {
    return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry =>
      entry.isDirectory() ? list(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))).flat();
  }
  const files = (await list(path.join(root, 'src'))).filter(file => file.endsWith('.ts')
    && !file.includes(`${path.sep}__tests__${path.sep}`) && !file.includes(`${path.sep}scripts${path.sep}`));
  const program = ts.createProgram(files, { target: ts.ScriptTarget.ESNext, esModuleInterop: true });
  const checker = program.getTypeChecker();
  const columns = [], selects = [], unresolved = [];
  function initializer(node, seen = new Set()) {
    if (!node || seen.has(node)) return node;
    seen.add(node);
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return initializer(node.expression, seen);
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return initializer(declaration.initializer, seen);
    }
    return node;
  }
  function literal(node) {
    node = initializer(node);
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') {
      const items = initializer(node.expression.expression), separator = literal(node.arguments[0]);
      if (items && ts.isArrayLiteralExpression(items) && separator !== null) {
        const values = items.elements.map(item => literal(item));
        if (values.every(value => value !== null)) return values.join(separator);
      }
    }
    return null;
  }
  function table(node, seen = new Set()) {
    node = initializer(node);
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const property = node.expression;
      if (property.name.text === 'from' && property.expression.getText() === 'supabase') return literal(node.arguments[0]);
      return table(property.expression, seen);
    }
    return null;
  }
  function writeKeys(node) {
    node = initializer(node);
    if (!node) return [];
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(writeKeys);
    if (!ts.isObjectLiteralExpression(node)) return [];
    return node.properties.flatMap(property => ts.isSpreadAssignment(property) ? writeKeys(property.expression)
      : property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? [property.name.text] : []);
  }
  for (const file of files) {
    const source = program.getSourceFile(file);
    function walk(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text, name = table(node.expression.expression);
        if (method === 'from' && node.expression.expression.getText() === 'supabase' && literal(node.arguments[0]) === null) {
          unresolved.push({ file: path.relative(root, file).replaceAll('\\', '/'),
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, method: 'dynamic table' });
        }
        if (name) {
          const location = { table: name, file: path.relative(root, file).replaceAll('\\', '/'),
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, method };
          let keys = [];
          if (['insert', 'update', 'upsert'].includes(method)) keys = writeKeys(node.arguments[0]);
          if (['eq', 'neq', 'in', 'is', 'order', 'gt', 'gte', 'lt', 'lte', 'ilike', 'like'].includes(method)) {
            const key = literal(node.arguments[0]);
            if (key && /^[a-z_][a-z_0-9]*$/.test(key)) keys = [key];
          }
          if (method === 'select') {
            const value = literal(node.arguments[0]);
            if (value !== null) selects.push({ ...location, expression: value });
            else if (node.arguments.length) unresolved.push(location);
          } else {
            for (const column of keys) columns.push({ ...location, column });
            if (['insert', 'update', 'upsert'].includes(method) && !keys.length) unresolved.push(location);
          }
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  return { files: files.length, columns, selects, unresolved };
}

// Keep commas inside embedded relationship expressions with their parent.
export function splitSelection(expression) {
  const parts = []; let depth = 0, start = 0;
  for (let index = 0; index < expression.length; index++) {
    if (expression[index] === '(') depth++;
    if (expression[index] === ')') depth--;
    if (expression[index] === ',' && depth === 0) { parts.push(expression.slice(start, index).trim()); start = index + 1; }
  }
  parts.push(expression.slice(start).trim());
  return parts.filter(Boolean);
}
