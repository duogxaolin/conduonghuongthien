/**
 * Đọc bảng export/import của một tệp bằng TypeScript AST và giải một tên xuất ra
 * về tệp khai báo thật — đi qua barrel (`export { a as b } from`), `export { x }`
 * của tên đã nhập, và `export *`. Dùng chung cho luật 4 (`_service-split-state.ts`)
 * và luật 5 (`exportedApi`) của `tests/service-split-boundaries.test.ts`.
 *
 * Tiền tố `_`: glob của runner (`tests/*.test.ts`) không nhặt tệp này.
 */
import ts from 'typescript'
import { type Sources, resolveTarget, sourceFileOf } from './_service-split-sources.ts'

// ─── AST dùng chung, đệm theo (tệp, mã nguồn) ───────────────────────────────

const astCache = new Map<string, { source: string; sf: ts.SourceFile }>()

/** Mỗi bằng chứng đột biến quét lại cả repo, chỉ một tệp đổi — nên đệm theo mã nguồn. */
export function ast(file: string, source: string): ts.SourceFile {
  const cached = astCache.get(file)
  if (cached && cached.source === source) return cached.sf
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  astCache.set(file, { source, sf })
  return sf
}

export const lineOf = (sf: ts.SourceFile, node: ts.Node) =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

/** Bỏ lớp vỏ không đổi giá trị: `( )`, `as`, `satisfies`, `!`, `<T>x`. */
export function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )
    current = current.expression
  return current
}

export function bindingIdentifiers(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name]
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingIdentifiers(element.name),
  )
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind)

export function literalText(node: ts.Node | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null
}

// ─── Bảng export/import của một tệp ──────────────────────────────────────────

export interface ImportedName {
  specifier: string
  /** Tên ở module nguồn; `'*'` = cả module. */
  imported: string
}

interface ModuleTable {
  /** Tên giá trị khai báo ở cấp đỉnh. */
  declared: Set<string>
  /** Tên xuất ra → tên cục bộ (khai báo hoặc nhập trong tệp). */
  local: Map<string, string>
  /** Tên xuất ra → `export { a as b } from 'X'`. */
  reexports: Map<string, ImportedName>
  /** `export * from 'X'`. */
  stars: string[]
  /** Tên cục bộ → lượt nhập tĩnh (không tính `import type`). */
  imports: Map<string, ImportedName & { line: number }>
}

const tableCache = new Map<string, { source: string; table: ModuleTable }>()

export function moduleTable(file: string, source: string): ModuleTable {
  const cached = tableCache.get(file)
  if (cached && cached.source === source) return cached.table
  const sf = ast(file, source)
  const table: ModuleTable = {
    declared: new Set(),
    local: new Map(),
    reexports: new Map(),
    stars: [],
    imports: new Map(),
  }
  for (const statement of sf.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        for (const id of bindingIdentifiers(declaration.name)) {
          table.declared.add(id.text)
          if (exported) table.local.set(id.text, id.text)
        }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      table.declared.add(statement.name.text)
      if (exported)
        table.local.set(isDefault ? 'default' : statement.name.text, statement.name.text)
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (ts.isIdentifier(statement.expression))
        table.local.set('default', statement.expression.text)
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const specifier = literalText(statement.moduleSpecifier)
      const clause = statement.exportClause
      if (!clause) {
        if (specifier) table.stars.push(specifier)
      } else if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue
          const origin = (element.propertyName ?? element.name).text
          if (specifier) table.reexports.set(element.name.text, { specifier, imported: origin })
          else table.local.set(element.name.text, origin)
        }
      }
    } else if (ts.isImportDeclaration(statement)) {
      const specifier = literalText(statement.moduleSpecifier)
      const clause = statement.importClause
      if (!specifier || !clause || clause.isTypeOnly) continue
      const line = lineOf(sf, statement)
      if (clause.name) table.imports.set(clause.name.text, { specifier, imported: 'default', line })
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings))
        table.imports.set(bindings.name.text, { specifier, imported: '*', line })
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          if (!element.isTypeOnly)
            table.imports.set(element.name.text, {
              specifier,
              imported: (element.propertyName ?? element.name).text,
              line,
            })
    }
  }
  tableCache.set(file, { source, table })
  return table
}

// ─── Giải một tên xuất ra về tệp khai báo ───────────────────────────────────

export interface Resolved {
  file: string
  local: string
}

/** Tệp nguồn mà `specifier` (viết trong `fromFile`) trỏ tới, hoặc null (package, ngoài tập quét). */
export function moduleFile(sources: Sources, fromFile: string, specifier: string): string | null {
  const target = resolveTarget(fromFile, specifier)
  return target === null ? null : sourceFileOf(sources, target)
}

/** Tệp + tên cục bộ đang mang `name` mà `file` xuất ra — đi qua barrel và `export *`. */
export function resolveExport(
  sources: Sources,
  file: string,
  name: string,
  seen = new Set<string>(),
): Resolved | null {
  const key = `${file}#${name}`
  const source = sources.get(file)
  if (seen.has(key) || source === undefined) return null
  seen.add(key)
  const table = moduleTable(file, source)
  const local = table.local.get(name)
  if (local !== undefined) {
    if (table.declared.has(local)) return { file, local }
    const imported = table.imports.get(local)
    const from = imported && moduleFile(sources, file, imported.specifier)
    return from && imported.imported !== '*'
      ? resolveExport(sources, from, imported.imported, seen)
      : null
  }
  const reexport = table.reexports.get(name)
  if (reexport) {
    const from = moduleFile(sources, file, reexport.specifier)
    return from ? resolveExport(sources, from, reexport.imported, seen) : null
  }
  for (const star of table.stars) {
    const from = moduleFile(sources, file, star)
    const hit = from && resolveExport(sources, from, name, seen)
    if (hit) return hit
  }
  return null
}

/** Mọi tên giá trị mà `file` xuất ra (kể cả qua `export *`). */
export function exportedNames(sources: Sources, file: string, seen = new Set<string>()): string[] {
  const source = sources.get(file)
  if (seen.has(file) || source === undefined) return []
  seen.add(file)
  const table = moduleTable(file, source)
  const names = [...table.local.keys(), ...table.reexports.keys()]
  for (const star of table.stars) {
    const from = moduleFile(sources, file, star)
    if (from) names.push(...exportedNames(sources, from, seen))
  }
  return names
}

// ─── API công khai của một tệp, theo TÊN XUẤT (luật 5) ───────────────────────

/**
 * Tên giá trị và tên kiểu một tệp xuất ra, đọc theo TÊN XUẤT (`export { a as b }`
 * → `b`) và theo loại (`export type { … }` hay `type X` trong danh sách → kiểu).
 * `export *` hiện thành một mục `* from '…'`, nên so tập là đỏ thay vì nuốt im.
 */
export function exportedApi(file: string, source: string): { values: string[]; types: string[] } {
  const sf = ast(file, source)
  const values: string[] = []
  const types: string[] = []
  for (const statement of sf.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause
      if (!clause) values.push(`* from ${statement.moduleSpecifier?.getText(sf)}`)
      else if (ts.isNamespaceExport(clause)) values.push(clause.name.text)
      else
        for (const element of clause.elements)
          (statement.isTypeOnly || element.isTypeOnly ? types : values).push(element.name.text)
    } else if (ts.isExportAssignment(statement)) {
      values.push(statement.isExportEquals ? 'export =' : 'default')
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          values.push(declaration.name.getText(sf))
      else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
        types.push(statement.name.text)
      else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
        values.push(isDefault ? 'default' : (statement.name?.text ?? 'default'))
      else if (ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement))
        values.push(statement.name.getText(sf))
    }
  }
  return { values: values.sort(), types: types.sort() }
}
