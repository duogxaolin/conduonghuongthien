/**
 * Bộ phân tích phía sau `reader-name-resolver-guard.test.ts`: một hàm đọc tên người
 * đọc có đưa tên đó qua `effectiveDisplayName` cùng cờ `display_name_reserved` không?
 *
 * Dùng TypeScript compiler API (không regex trên cả tệp): bình luận không tính, và
 * đơn vị là TỪNG HÀM CẤP CAO NHẤT của tệp (khai báo `function`, `const x = () => …`,
 * `export default defineEventHandler(…)`), không phải cả tệp — bản trước kiểm theo
 * tệp nên "chọn cờ rồi không dùng" lọt, và chỉ thấy khối `.select({ … })` viết
 * nguyên văn (kiểm chứng lại 2A: 5/8 biến thể lọt).
 *
 * Một hàm ĐỌC TÊN khi trong thân nó (hoặc trong một hằng cấp module mà nó nhắc tới):
 *  - có tham chiếu cột Drizzle `readerAccounts.displayName` / `readerAccounts.customDisplayName`
 *    (ở bất kỳ đâu — trong `select`, trong `sql\`${…}\``, trong một hằng projection);
 *  - có chuỗi / template chứa `display_name` hoặc `custom_display_name` như một định
 *    danh SQL (có hay không dấu backtick: `ra.display_name`, `\`ra\`.\`display_name\``,
 *    `'SELECT display_name FROM …'`);
 *  - chọn NGUYÊN HÀNG `reader_accounts` (`.select().from(readerAccounts)`).
 * Hàm đó ĐẠT khi:
 *  - đọc cờ (`readerAccounts.displayNameReserved`, chuỗi `display_name_reserved`,
 *    hoặc nguyên hàng — có cột cờ), VÀ
 *  - gọi `effectiveDisplayName(arg)` — `arg` là object literal thì phải có khoá
 *    `displayNameReserved` (khoá bắt buộc của kiểu chỉ chặn được object có kiểu; ở
 *    đây kiểm luôn); hoặc gọi (một bước) một hàm cùng tệp ĐẠT điều đó (mẫu
 *    `loadCommentThread` → `serializePublicComment`).
 */
import ts from 'typescript'

/** `display_name` / `custom_display_name` as an SQL identifier — not `display_name_reserved`, not `profile_display_name_ph`. */
const NAME_IDENTIFIER = /(?<![A-Za-z0-9_])(?:custom_)?display_name(?![A-Za-z0-9_])/
const FLAG_IDENTIFIER = /(?<![A-Za-z0-9_])display_name_reserved(?![A-Za-z0-9_])/
const NAME_COLUMNS = new Set(['displayName', 'customDisplayName'])

export interface FunctionVerdict {
  name: string
  readsName: boolean
  readsFlag: boolean
  /** Calls effectiveDisplayName with the flag itself (no hop). */
  resolvesDirectly: boolean
  /** Same-file functions it calls by name. */
  calls: string[]
  /** Final verdict after one hop. */
  ok: boolean
}

interface Signals { readsName: boolean, readsFlag: boolean, resolvesDirectly: boolean, calls: Set<string>, identifiers: Set<string> }

function emptySignals(): Signals {
  return { readsName: false, readsFlag: false, resolvesDirectly: false, calls: new Set(), identifiers: new Set() }
}

function textOfLiteral(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text
  return null
}

/** `….select()` with no projection, whose result is `.from(readerAccounts)`. */
function isWholeRowReaderSelect(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false
  if (node.expression.name.text !== 'from') return false
  const [table] = node.arguments
  if (!table || !ts.isIdentifier(table) || table.text !== 'readerAccounts') return false
  const receiver = node.expression.expression
  return ts.isCallExpression(receiver)
    && ts.isPropertyAccessExpression(receiver.expression)
    && receiver.expression.name.text === 'select'
    && receiver.arguments.length === 0
}

function collect(root: ts.Node, into: Signals): void {
  const visit = (node: ts.Node) => {
    const text = textOfLiteral(node)
    if (text !== null) {
      if (NAME_IDENTIFIER.test(text)) into.readsName = true
      if (FLAG_IDENTIFIER.test(text)) into.readsFlag = true
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'readerAccounts') {
      if (NAME_COLUMNS.has(node.name.text)) into.readsName = true
      if (node.name.text === 'displayNameReserved') into.readsFlag = true
    }
    if (isWholeRowReaderSelect(node)) { into.readsName = true; into.readsFlag = true }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text
      if (callee === 'effectiveDisplayName') {
        const [arg] = node.arguments
        if (arg && ts.isObjectLiteralExpression(arg)) {
          if (arg.properties.some(p => p.name && ts.isIdentifier(p.name) && p.name.text === 'displayNameReserved')) into.resolvesDirectly = true
        } else if (arg) {
          into.resolvesDirectly = true
        }
      } else {
        into.calls.add(callee)
      }
    }
    if (ts.isIdentifier(node)) into.identifiers.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(root)
}

/** Top-level units: name → node. Module-level non-function declarations come back separately. */
function topLevelUnits(sourceFile: ts.SourceFile): { functions: Map<string, ts.Node>, moduleConsts: Map<string, ts.Node> } {
  const functions = new Map<string, ts.Node>()
  const moduleConsts = new Map<string, ts.Node>()
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement)
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const init = decl.initializer
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) functions.set(decl.name.text, init)
        else moduleConsts.set(decl.name.text, init)
      }
    } else if (ts.isExportAssignment(statement)) {
      functions.set('default', statement.expression)
    }
  }
  return { functions, moduleConsts }
}

export function analyzeReaderNameReads(fileName: string, source: string): FunctionVerdict[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const { functions, moduleConsts } = topLevelUnits(sourceFile)

  // Module-level constants that themselves read a name / the flag (a projection
  // object held in a const and passed to `.select(columns)`).
  const constSignals = new Map<string, Signals>()
  for (const [name, node] of moduleConsts) {
    const signals = emptySignals()
    collect(node, signals)
    constSignals.set(name, signals)
  }

  const raw = new Map<string, Signals>()
  for (const [name, node] of functions) {
    const signals = emptySignals()
    collect(node, signals)
    for (const identifier of signals.identifiers) {
      const tainted = constSignals.get(identifier)
      if (!tainted) continue
      if (tainted.readsName) signals.readsName = true
      if (tainted.readsFlag) signals.readsFlag = true
    }
    raw.set(name, signals)
  }

  return [...raw].map(([name, signals]) => {
    const calls = [...signals.calls].filter(callee => functions.has(callee) && callee !== name)
    const resolves = signals.resolvesDirectly || calls.some(callee => raw.get(callee)?.resolvesDirectly === true)
    return {
      name,
      readsName: signals.readsName,
      readsFlag: signals.readsFlag,
      resolvesDirectly: signals.resolvesDirectly,
      calls,
      ok: !signals.readsName || (signals.readsFlag && resolves),
    }
  })
}

/** Functions that read a reader's name without resolving it, as `file#function`. */
export function readerNameViolations(fileName: string, source: string): string[] {
  return analyzeReaderNameReads(fileName, source).filter(verdict => !verdict.ok).map(verdict => `${fileName}#${verdict.name}`)
}
