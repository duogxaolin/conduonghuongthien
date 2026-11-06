/**
 * Mọi lượt ghi `article_translations` / `articles` trong `server/**` có CHỨNG MINH được rằng `content`
 * (render bằng `v-html`) đã qua `sanitizeHtml` không? Dùng bởi `tests/security-translation-html.test.ts`.
 *
 * Vì sao AST, không theo dòng: bản cũ đòi mỗi DÒNG `content: …` có chữ `sanitizeHtml(` — `.set(body)`,
 * `.set({ ...body })` hay `content` ghi qua biến không có dòng `content:` nào, nên lọt mà cổng vẫn xanh
 * (cùng điểm yếu đã để lọt 3 đường ghi ở cổng cache câu trả lời, 2026-11-06).
 *
 * Luật cho đối số của `.set(x)` / `.values(x)` / `onDuplicateKeyUpdate({ set: x })` trên chuỗi
 * `insert|update(<bảng>)` (kể cả `insert|update(schema.<bảng>)`):
 *   - `sanitizeTranslationFields(…)` → đạt;
 *   - object literal → khoá `content` (viết thế nào cũng vậy: `content`, `'content'`, `['content']`) phải là
 *     `sanitizeHtml(…)` hoặc `null`; khoá tính toán không phải chuỗi cố định, getter/setter/method tên content,
 *     và spread không chứng minh được đều không đạt; shorthand `content` lần tới khai báo của nó;
 *   - mảng → từng phần tử;
 *   - định danh → khai báo gần nhất theo PHẠM VI KHỐI, khởi tạo bằng object literal đạt luật; mọi tham chiếu
 *     khác chỉ được là `x.prop = …` (content thì phải lọc), đọc `x.prop`, `Object.keys/values/entries(x)`,
 *     `JSON.stringify(x)`, hoặc chính lượt ghi. Gán lại, bí danh, truyền cho hàm khác, phép gán gộp → không đạt;
 *   - `sanitizeHtml` / `sanitizeTranslationFields` phải là hàm IMPORT từ `…/sanitize-html` / `…/translation-html`
 *     và không bị khai lại trong tệp (một hàm cùng tên tự viết không chứng minh gì);
 *   - còn lại → không chứng minh được.
 * Giới hạn (nói rõ): chỉ bắt lượt ghi qua Drizzle; SQL thô có kiểm vắng mặt riêng trong test.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const ROOT = path.resolve(import.meta.dirname, '..')

export interface TranslationWrite {
  /** `server/…/file.ts:line` */
  site: string
  ok: boolean
  reason: string
}

const COMPOUND_ASSIGNMENTS = new Set([
  ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
])
const READ_ONLY_CALLS = new Set(['Object.keys', 'Object.values', 'Object.entries', 'JSON.stringify'])

const unwrap = (node: ts.Expression): ts.Expression => {
  let current = node
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression
  }
  return current
}

/** Tên khoá như chuỗi (`content`, `'content'`, `['content']`); `null` khi khoá tính toán không cố định. */
function keyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name)) {
    const expression = unwrap(name.expression)
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text
    return null
  }
  return null
}

/** Tên được import từ đúng module lọc và không bị khai lại ở đâu trong tệp. */
function trustedImports(source: ts.SourceFile): Set<string> {
  const trusted = new Set<string>()
  const required: Record<string, RegExp> = { sanitizeHtml: /\/sanitize-html(\.ts)?$/, sanitizeTranslationFields: /\/translation-html(\.ts)?$/ }
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text
      if (required[imported]?.test(statement.moduleSpecifier.text) && element.name.text === imported) trusted.add(imported)
    }
  }
  // Khai lại ở bất kỳ đâu trong tệp (hàm, biến, tham số) ⇒ tên đó không còn đáng tin.
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.name && ts.isIdentifier(node.name)) {
      trusted.delete(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  for (const statement of source.statements) if (!ts.isImportDeclaration(statement)) visit(statement)
  return trusted
}

type Resolved =
  | { kind: 'variable', declaration: ts.VariableDeclaration, scope: ts.Node }
  | { kind: 'parameter', declaration: ts.ParameterDeclaration, scope: ts.Node }

/** Khai báo gần nhất của `name` nhìn thấy từ `use`, theo phạm vi KHỐI (block, hàm, tệp) — tham số cũng tính. */
function resolveDeclaration(use: ts.Node, name: string): Resolved | null {
  let scope: ts.Node | undefined = use.parent
  while (scope) {
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) {
        if (ts.isIdentifier(parameter.name) && parameter.name.text === name) return { kind: 'parameter', declaration: parameter, scope }
      }
    }
    if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return { kind: 'variable', declaration, scope }
        }
      }
    }
    if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope))
      && scope.initializer && ts.isVariableDeclarationList(scope.initializer)) {
      for (const declaration of scope.initializer.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return { kind: 'variable', declaration, scope }
      }
    }
    scope = scope.parent
  }
  return null
}

class Prover {
  private readonly trusted: Set<string>

  constructor(trusted: Set<string>) {
    this.trusted = trusted
  }

  private isTrustedCall(node: ts.Node | undefined, name: string): boolean {
    return Boolean(node && ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === name && this.trusted.has(name))
  }

  private contentValueOk(value: ts.Expression): boolean {
    const inner = unwrap(value)
    return this.isTrustedCall(inner, 'sanitizeHtml') || inner.kind === ts.SyntaxKind.NullKeyword
  }

  private spreadOk(expression: ts.Expression): string | null {
    const inner = unwrap(expression)
    if (this.isTrustedCall(inner, 'sanitizeTranslationFields')) return null
    if (ts.isObjectLiteralExpression(inner)) return this.objectOk(inner)
    if (ts.isConditionalExpression(inner)) return this.spreadOk(inner.whenTrue) ?? this.spreadOk(inner.whenFalse)
    return `spread of ${expression.getText()} may carry content`
  }

  private objectOk(object: ts.ObjectLiteralExpression): string | null {
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        const problem = this.spreadOk(property.expression)
        if (problem) return problem
        continue
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        if (property.name.text === 'content') {
          const problem = this.shorthandContentOk(property.name)
          if (problem) return problem
        }
        continue
      }
      const name = property.name ? keyName(property.name) : null
      if (name === null) return `computed key ${property.name?.getText() ?? '?'} may be content`
      if (name !== 'content') continue
      if (!ts.isPropertyAssignment(property)) return `content defined as ${ts.SyntaxKind[property.kind]} cannot be proven sanitized`
      if (!this.contentValueOk(property.initializer)) return `content: ${property.initializer.getText()} is not sanitizeHtml(…)`
    }
    return null
  }

  /** `{ content }` viết tắt: biến `content` khởi tạo bằng `sanitizeHtml(…)`, mọi lần gán lại cũng vậy. */
  private shorthandContentOk(name: ts.Identifier): string | null {
    const resolved = resolveDeclaration(name, 'content')
    if (!resolved || resolved.kind !== 'variable' || !resolved.declaration.initializer || !this.contentValueOk(resolved.declaration.initializer)) {
      return 'shorthand `content` is not provably sanitized'
    }
    let problem: string | null = null
    const visit = (node: ts.Node) => {
      if (problem) return
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && node.left.text === 'content'
        && resolveDeclaration(node.left, 'content')?.declaration === resolved.declaration) {
        if (COMPOUND_ASSIGNMENTS.has(node.operatorToken.kind)) problem = `content ${node.operatorToken.getText()} …`
        else if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken && !this.contentValueOk(node.right)) problem = `content = ${node.right.getText()}`
      }
      ts.forEachChild(node, visit)
    }
    visit(resolved.scope)
    return problem
  }

  /** Biến chứa payload: khởi tạo đạt luật, và không thoát ra ngoài các cách dùng đã biết là vô hại. */
  private identifierOk(id: ts.Identifier, writeArgument: ts.Node): string | null {
    const resolved = resolveDeclaration(id, id.text)
    if (!resolved || resolved.kind !== 'variable') return `${id.text} is not a local variable`
    const { declaration, scope } = resolved
    if (!declaration.initializer) return `${id.text} is not declared with an initializer in an enclosing scope`
    const init = unwrap(declaration.initializer)
    if (!ts.isObjectLiteralExpression(init)) return `${id.text} is not initialised with an object literal`
    const fromInit = this.objectOk(init)
    if (fromInit) return fromInit

    let problem: string | null = null
    const visit = (node: ts.Node) => {
      if (problem) return
      if (ts.isIdentifier(node) && node.text === id.text && node !== declaration.name
        && resolveDeclaration(node, id.text)?.declaration === declaration) {
        problem = this.useOk(node, id.text, writeArgument)
      }
      ts.forEachChild(node, visit)
    }
    visit(scope)
    return problem
  }

  private useOk(use: ts.Identifier, name: string, writeArgument: ts.Node): string | null {
    let node: ts.Node = use
    while (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isNonNullExpression(node.parent) || ts.isSatisfiesExpression(node.parent)) node = node.parent
    if (node === writeArgument) return null
    const parent = node.parent
    // x.prop …
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      const assignment = parent.parent
      if (ts.isBinaryExpression(assignment) && assignment.left === parent) {
        if (assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          return parent.name.text === 'content' && !this.contentValueOk(assignment.right) ? `${name}.content = ${assignment.right.getText()}` : null
        }
        return parent.name.text === 'content' ? `${name}.content ${assignment.operatorToken.getText()} …` : null
      }
      return null // đọc x.prop
    }
    // x[…] = … : khoá không biết trước
    if (ts.isElementAccessExpression(parent) && parent.expression === node) {
      const assignment = parent.parent
      return ts.isBinaryExpression(assignment) && assignment.left === parent ? `${name}[…] = assignment` : null
    }
    // Object.keys(x), JSON.stringify(x)…
    if (ts.isCallExpression(parent) && parent.arguments.some(argument => argument === node)
      && READ_ONLY_CALLS.has(parent.expression.getText())) return null
    return `${name} escapes (${parent.getText().slice(0, 60)})`
  }

  argumentOk(argument: ts.Expression): string | null {
    const inner = unwrap(argument)
    if (this.isTrustedCall(inner, 'sanitizeTranslationFields')) return null
    if (ts.isObjectLiteralExpression(inner)) return this.objectOk(inner)
    if (ts.isArrayLiteralExpression(inner)) {
      for (const element of inner.elements) {
        const problem = this.argumentOk(element as ts.Expression)
        if (problem) return problem
      }
      return null
    }
    if (ts.isIdentifier(inner)) return this.identifierOk(inner, argument)
    return `${inner.getText()} cannot be proven sanitized`
  }
}

/** Mọi lượt ghi bảng `table` (mặc định `articleTranslations`) trong một tệp nguồn. */
export function translationWritesIn(file: string, text: string, table = 'articleTranslations'): TranslationWrite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const prover = new Prover(trustedImports(source))
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const writes: TranslationWrite[] = []
  const isTable = (node: ts.Expression | undefined) => Boolean(node && (
    (ts.isIdentifier(node) && node.text === table)
    || (ts.isPropertyAccessExpression(node) && node.name.text === table)))
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['insert', 'update'].includes(node.expression.name.text) && isTable(node.arguments[0])) {
      // Đi lên chuỗi gọi: `.set(x)`, `.values(x)`, `.onDuplicateKeyUpdate({ set: x })`.
      const payloads: ts.Expression[] = []
      let link: ts.Node = node
      while (link.parent && ts.isPropertyAccessExpression(link.parent) && link.parent.parent && ts.isCallExpression(link.parent.parent)) {
        const method = link.parent.name.text
        const call = link.parent.parent
        if ((method === 'set' || method === 'values') && call.arguments[0]) payloads.push(call.arguments[0])
        if (method === 'onDuplicateKeyUpdate' && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) {
          for (const property of call.arguments[0].properties) {
            if (ts.isPropertyAssignment(property) && keyName(property.name) === 'set') payloads.push(property.initializer)
          }
        }
        link = call
      }
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      const problems = payloads.map(payload => prover.argumentOk(payload)).filter((problem): problem is string => problem !== null)
      writes.push({
        site: `${rel}:${line}`,
        ok: payloads.length > 0 && problems.length === 0,
        reason: payloads.length === 0 ? 'no .set()/.values() payload found on the chain' : (problems[0] ?? 'ok'),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return writes
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return files(full)
    return /\.(ts|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

/** Mọi lượt ghi bảng `table` (mặc định `articleTranslations`) trong `server/**`. */
export function allTranslationWrites(table = 'articleTranslations'): TranslationWrite[] {
  return files(path.join(ROOT, 'server')).flatMap(file => translationWritesIn(file, readFileSync(file, 'utf8'), table))
}
