/**
 * Luật 4 của `tests/service-split-boundaries.test.ts`: **trạng thái cấp module của
 * một nhóm service đã tách có đúng MỘT chủ.**
 *
 * Tách một tệp lớn làm lộ ra hai cách hỏng mà không test hành vi nào bắt kịp lúc viết:
 *
 *   a. **Hai bản.** Một `Map`/`let`/đối tượng cấp module được dùng ở hai đường nối,
 *      và lúc tách nó bị chép sang cả hai tệp con thay vì import — hai sổ độc lập,
 *      mỗi nửa mã thấy một nửa sự thật (một lượt hủy không tìm thấy lượt chạy,
 *      một giới hạn chỉ áp nửa số lượt gọi).
 *   b. **Ghi từ tệp khác.** Tệp con (hay endpoint) import trạng thái của tệp anh em
 *      rồi ghi vào nó: `X.p = …`, `X[k] = …`, `X.set(…)`, `delete X[k]`,
 *      `Object.assign(X, …)`. Chủ của trạng thái không còn là nơi duy nhất quyết
 *      định giá trị của nó.
 *
 * "Trạng thái" = khai báo cấp đỉnh của một tệp thuộc nhóm: mọi `let`/`var`, mọi `const`
 * mà giá trị khởi tạo KHÔNG chứng minh được là không ghi được (`isStateInitializer` — đóng
 * khi nghi ngờ), và mọi lớp (khai báo hay biểu thức) có thành viên `static`. Không tính:
 * nguyên thuỷ (literal, template, phép toán số/so sánh, `typeof`), hàm, lớp KHÔNG có thành
 * viên `static`, `Symbol()`, và `Object.freeze` của một literal mà mọi giá trị cũng không
 * ghi được. Mọi thứ khác là trạng thái: object/array literal, `new …` (Map, Set,
 * AbortController…), regex literal (`lastIndex` ghi được), lời gọi — kể cả IIFE dựng bảng
 * một lần lúc nạp (`SAMPLE_CHARS` của `moderation-regex-parser.ts` từng lọt vì danh sách cũ
 * chỉ biết ba dạng literal/`new`, nên tệp khác `.push()` vào nó mà luật xanh) —, bí danh
 * (`const X = Y`: cùng một đối tượng), và lớp có trường/phương thức/khối `static`
 * (`class { static table = [] }`: chính constructor mang dữ liệu; một phương thức static
 * cũng cất được dữ liệu lên `this` — đóng khi nghi ngờ).
 *
 * Lượt ghi được dò trên AST của MỌI tệp chạy thật (không chỉ tệp trong nhóm: endpoint
 * import trạng thái qua barrel). Gốc của đích ghi được lần qua `.p`, `[k]` (kể cả
 * khoá tính toán), `!`, `( )`, `as`/`satisfies` — không qua lời gọi, nên
 * `RENDITIONS.slice().sort()` không bị tính. Gốc là một tên đã nhập (named, default,
 * namespace `ns.X`/`ns['X']`, `import x = require()`, `const m = await import()`,
 * `.then((m) => …)`, kể cả destructure), được giải qua barrel (`export { a as b }
 * from`) tới tệp khai báo thật — hoặc một BÍ DANH của tên đã nhập: biến cục bộ hay cấp
 * module khai báo kèm giá trị (`const a = X as T`, `const t = ns.X`, `const { X: s } = ns`,
 * mỗi nhánh của `?:`/`??`/`||`/`&&`), lần tiếp nếu giá trị đó lại là bí danh. Gán thẳng vào
 * chính tên bí danh (`a = …`, `a++`) chỉ đổi biến cục bộ, không ghi vào đối tượng — không
 * tính. Tên cục bộ che tên đã nhập (tham số, biến cùng tên) không bị tính. Ghi qua khoá
 * tính toán trên namespace của một module có xuất trạng thái (`ns[k] = …`) không biết được
 * tên nên bị coi là vi phạm.
 *
 * Ngoại lệ nêu tên (`SharedStateWriters`): trạng thái mà nhiều tệp ghi CÓ CHỦ ĐÍCH từ
 * trước khi tách — hôm nay chỉ `moderation-stats.ts#workerStats` (bộ đếm của worker kiểm
 * duyệt). Chỉ đúng các tệp nêu tên được ghi; mục chết thì đỏ.
 *
 * Giới hạn đã biết (phân tích tĩnh): một hàm của chủ trả về chính đối tượng trạng
 * thái (`getClaims().set(…)`), module object hay trạng thái được truyền đi qua tham số,
 * biến khai báo trước rồi mới gán (`let a; a = X`), và thuộc tính ghi lên một HÀM đã nhập
 * (`fn.cache = …` — hàm không phải trạng thái) thì không lần được. Vì thế trạng thái thật
 * (`activeClaims`, `cpulimitAvailable`) cố ý không được `export`, và chỉ đổi qua hàm của
 * chủ; bảng chỉ-đọc được xuất ra (`SAMPLE_CHARS`) thì đóng băng lúc chạy.
 */
import ts from 'typescript'
import {
  type ImportedName,
  type Resolved,
  ast,
  bindingIdentifiers,
  exportedNames,
  lineOf,
  literalText,
  moduleFile,
  moduleTable,
  resolveExport,
  unwrap,
} from './_service-split-modules.ts'
import { type Family, type Sources, familyMembers } from './_service-split-sources.ts'

const COMPUTED = Symbol('khoá tính toán')
type Step = string | typeof COMPUTED

const MUTATING_METHODS = new Set([
  'set',
  'add',
  'delete',
  'clear',
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
])
const MUTATING_FUNCTIONS = new Set([
  'Object.assign',
  'Object.defineProperty',
  'Object.defineProperties',
  'Object.setPrototypeOf',
  'Reflect.set',
  'Reflect.defineProperty',
  'Reflect.deleteProperty',
  'Reflect.setPrototypeOf',
])

// ─── Kho trạng thái của một tệp ──────────────────────────────────────────────

export interface StateBinding {
  file: string
  name: string
  line: number
  /** Khai báo mang `export` — `exportedFamilyState` của nhóm moderation-regex đọc cờ này. */
  exported: boolean
}

const BINARY_PASSING_AN_OPERAND = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
])

/** `Symbol`, `Object.freeze`… — tên gọi của một callee dạng `a` hoặc `a.b`, hoặc null. */
function calleeName(callee: ts.Expression): string | null {
  const inner = unwrap(callee)
  if (ts.isIdentifier(inner)) return inner.text
  return ts.isPropertyAccessExpression(inner) && ts.isIdentifier(inner.expression)
    ? `${inner.expression.text}.${inner.name.text}`
    : null
}

/**
 * Lớp mà chính đối tượng constructor mang dữ liệu: có thành viên `static` (trường, phương
 * thức, accessor) hay khối `static { }`. Đóng khi nghi ngờ: một phương thức static cũng cất
 * được dữ liệu lên `this`, nên mọi thành viên static đều tính.
 */
function hasStaticMembers(node: ts.ClassLikeDeclaration): boolean {
  return node.members.some(
    (member) =>
      ts.isClassStaticBlockDeclaration(member) ||
      (ts.canHaveModifiers(member) &&
        (ts.getModifiers(member) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)),
  )
}

/** Literal mà `Object.freeze` khoá được trọn: mọi phần tử/giá trị cũng không ghi được. */
function isFrozenLiteral(node: ts.Expression): boolean {
  const inner = unwrap(node)
  if (ts.isArrayLiteralExpression(inner))
    return inner.elements.every((element) => !ts.isSpreadElement(element) && isImmutableValue(element))
  if (ts.isObjectLiteralExpression(inner))
    return inner.properties.every(
      (property) =>
        (ts.isPropertyAssignment(property) && isImmutableValue(property.initializer)) ||
        ts.isMethodDeclaration(property) ||
        ts.isGetAccessorDeclaration(property),
    )
  return false
}

/**
 * Giá trị mà không ai ghi vào được. Đóng khi nghi ngờ: dạng nào không có ở đây là
 * trạng thái. `Object.freeze` chỉ khoá một tầng, nên chỉ được tính khi đối số là literal
 * mà mọi giá trị bên trong cũng không ghi được (`CHAT_LIMITS`, `MODERATION_RESCAN_LIMITS`).
 */
function isImmutableValue(node: ts.Expression): boolean {
  const inner = unwrap(node)
  if (
    ts.isStringLiteralLike(inner) ||
    ts.isNumericLiteral(inner) ||
    ts.isBigIntLiteral(inner) ||
    ts.isTemplateExpression(inner) ||
    ts.isPrefixUnaryExpression(inner) ||
    ts.isTypeOfExpression(inner) ||
    ts.isVoidExpression(inner) ||
    ts.isArrowFunction(inner) ||
    ts.isFunctionExpression(inner)
  )
    return true
  if (ts.isClassExpression(inner)) return !hasStaticMembers(inner)
  if (
    inner.kind === ts.SyntaxKind.TrueKeyword ||
    inner.kind === ts.SyntaxKind.FalseKeyword ||
    inner.kind === ts.SyntaxKind.NullKeyword
  )
    return true
  if (ts.isIdentifier(inner)) return ['undefined', 'NaN', 'Infinity'].includes(inner.text)
  if (ts.isConditionalExpression(inner))
    return isImmutableValue(inner.whenTrue) && isImmutableValue(inner.whenFalse)
  if (ts.isBinaryExpression(inner)) {
    const operator = inner.operatorToken.kind
    if (BINARY_PASSING_AN_OPERAND.has(operator))
      return isImmutableValue(inner.left) && isImmutableValue(inner.right)
    if (operator === ts.SyntaxKind.CommaToken) return isImmutableValue(inner.right)
    // `x = y` / `x ??= y` trả một toán hạng — không đoán; mọi phép khác cho số/chuỗi/boolean.
    return operator < ts.SyntaxKind.FirstAssignment || operator > ts.SyntaxKind.LastAssignment
  }
  if (ts.isCallExpression(inner)) {
    const callee = calleeName(inner.expression)
    if (callee === 'Symbol' || callee === 'Symbol.for') return true
    if (callee === 'Object.freeze') return inner.arguments.length === 1 && isFrozenLiteral(inner.arguments[0]!)
  }
  return false
}

/** `const` với giá trị khởi tạo này có phải trạng thái không (xem "Trạng thái" ở đầu tệp). */
export function isStateInitializer(initializer: ts.Expression | undefined): boolean {
  return initializer !== undefined && !isImmutableValue(initializer)
}

export function moduleStateBindings(file: string, source: string): StateBinding[] {
  const sf = ast(file, source)
  const out: StateBinding[] = []
  for (const statement of sf.statements) {
    const exported = (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [])
      .some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    // `class X { static … }`: chính lớp là trạng thái (xem "Trạng thái" ở đầu tệp).
    if (ts.isClassDeclaration(statement)) {
      if (!hasStaticMembers(statement)) continue
      const isDefault = (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
      if (statement.name) out.push({ file, name: statement.name.text, line: lineOf(sf, statement.name), exported })
      else if (isDefault) out.push({ file, name: 'default', line: lineOf(sf, statement), exported })
      continue
    }
    if (!ts.isVariableStatement(statement)) continue
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
    for (const declaration of statement.declarationList.declarations) {
      if (isConst && !isStateInitializer(declaration.initializer)) continue
      for (const id of bindingIdentifiers(declaration.name))
        out.push({ file, name: id.text, line: lineOf(sf, id), exported })
    }
  }
  return out
}

// ─── Lượt ghi có gốc là một tên đã nhập ──────────────────────────────────────

interface WriteSite {
  line: number
  form: string
  /** Có khoá tính toán `[k]` ở đâu đó trên đường từ gốc tới đích. */
  computed: boolean
  origin: ImportedName
  /** Bước đầu tiên sau gốc (để giải `ns.X` / `ns['X']`), hoặc null khi ghi thẳng vào gốc. */
  member: Step | null
}

/** `import('X')` / `await import('X')` / `require('X')` → 'X'. */
function dynamicImportSpecifier(node: ts.Expression | undefined): string | null {
  if (!node) return null
  let inner = unwrap(node)
  if (ts.isAwaitExpression(inner)) inner = unwrap(inner.expression)
  if (!ts.isCallExpression(inner)) return null
  const isImport = inner.expression.kind === ts.SyntaxKind.ImportKeyword
  const isRequire = ts.isIdentifier(inner.expression) && inner.expression.text === 'require'
  return isImport || isRequire ? literalText(inner.arguments[0]) : null
}

/** Tham số đầu của `import('X').then((m) => …)` → 'X'. */
function thenImportSpecifier(parameter: ts.ParameterDeclaration): string | null {
  const fn = parameter.parent
  const call = fn.parent
  if (!call || !ts.isCallExpression(call) || call.arguments[0] !== fn) return null
  if (fn.parameters[0] !== parameter) return null
  const callee = unwrap(call.expression)
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'then') return null
  return dynamicImportSpecifier(callee.expression)
}

const scopeCache = new WeakMap<ts.Node, Map<string, ts.Identifier>>()

/** Tên khai báo TRỰC TIẾP trong một phạm vi → định danh tại chỗ khai báo. */
function declaredIn(scope: ts.Node): Map<string, ts.Identifier> {
  const cached = scopeCache.get(scope)
  if (cached) return cached
  const names = new Map<string, ts.Identifier>()
  const add = (id: ts.Identifier | undefined) => {
    if (id && !names.has(id.text)) names.set(id.text, id)
  }
  if (
    ts.isSourceFile(scope) ||
    ts.isBlock(scope) ||
    ts.isModuleBlock(scope) ||
    ts.isCaseClause(scope) ||
    ts.isDefaultClause(scope)
  ) {
    for (const statement of scope.statements) {
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          bindingIdentifiers(declaration.name).forEach(add)
      else if (
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)
      )
        add(statement.name)
      else if (ts.isImportEqualsDeclaration(statement)) add(statement.name)
      else if (ts.isImportDeclaration(statement) && statement.importClause) {
        const clause = statement.importClause
        add(clause.name)
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
          add(clause.namedBindings.name)
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
          for (const element of clause.namedBindings.elements) add(element.name)
      }
    }
  } else if (ts.isFunctionLike(scope)) {
    for (const parameter of scope.parameters) bindingIdentifiers(parameter.name).forEach(add)
    if (ts.isFunctionExpression(scope)) add(scope.name)
  } else if (
    (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
    scope.initializer &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    for (const declaration of scope.initializer.declarations)
      bindingIdentifiers(declaration.name).forEach(add)
  } else if (ts.isCatchClause(scope) && scope.variableDeclaration) {
    bindingIdentifiers(scope.variableDeclaration.name).forEach(add)
  }
  scopeCache.set(scope, names)
  return names
}

function nearestDeclaration(id: ts.Identifier): ts.Identifier | null {
  for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
    const hit = declaredIn(node).get(id.text)
    if (hit) return hit
  }
  return null
}

/** Định danh tại chỗ khai báo → lượt nhập mà nó là bí danh, hoặc null (tên cục bộ). */
function importOriginOf(declaration: ts.Identifier): ImportedName | null {
  const parent = declaration.parent
  if (ts.isImportSpecifier(parent)) {
    const importDeclaration = parent.parent.parent.parent
    const specifier = literalText(importDeclaration.moduleSpecifier)
    if (!specifier || parent.isTypeOnly || parent.parent.parent.isTypeOnly) return null
    return { specifier, imported: (parent.propertyName ?? parent.name).text }
  }
  if (ts.isImportClause(parent)) {
    const specifier = literalText(parent.parent.moduleSpecifier)
    return specifier && !parent.isTypeOnly ? { specifier, imported: 'default' } : null
  }
  if (ts.isNamespaceImport(parent)) {
    const specifier = literalText(parent.parent.parent.moduleSpecifier)
    return specifier && !parent.parent.isTypeOnly ? { specifier, imported: '*' } : null
  }
  if (
    ts.isImportEqualsDeclaration(parent) &&
    ts.isExternalModuleReference(parent.moduleReference)
  ) {
    const specifier = literalText(parent.moduleReference.expression)
    return specifier ? { specifier, imported: '*' } : null
  }
  if (ts.isVariableDeclaration(parent) && parent.name === declaration) {
    const specifier = dynamicImportSpecifier(parent.initializer)
    return specifier ? { specifier, imported: '*' } : null
  }
  if (ts.isParameter(parent) && parent.name === declaration) {
    const specifier = thenImportSpecifier(parent)
    return specifier ? { specifier, imported: '*' } : null
  }
  if (ts.isBindingElement(parent) && parent.name === declaration) {
    const pattern = parent.parent
    if (!ts.isObjectBindingPattern(pattern)) return null
    const holder = pattern.parent
    const specifier = ts.isVariableDeclaration(holder)
      ? dynamicImportSpecifier(holder.initializer)
      : ts.isParameter(holder)
        ? thenImportSpecifier(holder)
        : null
    const key = parent.propertyName ?? parent.name
    const imported = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null
    return specifier && imported ? { specifier, imported } : null
  }
  return null
}

/** Gốc của một đích ghi + các bước từ gốc ra (không đi qua lời gọi). */
function chainOf(target: ts.Expression): { root: ts.Expression; steps: Step[] } {
  const steps: Step[] = []
  let current = target
  for (;;) {
    const inner = unwrap(current)
    if (ts.isPropertyAccessExpression(inner)) {
      steps.unshift(inner.name.text)
      current = inner.expression
    } else if (ts.isElementAccessExpression(inner)) {
      const key = unwrap(inner.argumentExpression)
      steps.unshift(ts.isStringLiteralLike(key) || ts.isNumericLiteral(key) ? key.text : COMPUTED)
      current = inner.expression
    } else return { root: inner, steps }
  }
}

/** Đích của vế trái một phép gán — đi vào mẫu destructure `({ a: X.p } = …)`, `[X[k]] = …`. */
function assignmentTargets(left: ts.Expression): ts.Expression[] {
  const inner = unwrap(left)
  if (ts.isObjectLiteralExpression(inner))
    return inner.properties.flatMap((property) =>
      ts.isPropertyAssignment(property)
        ? assignmentTargets(property.initializer)
        : ts.isShorthandPropertyAssignment(property)
          ? [property.name]
          : ts.isSpreadAssignment(property)
            ? assignmentTargets(property.expression)
            : [],
    )
  if (ts.isArrayLiteralExpression(inner))
    return inner.elements.flatMap((element) =>
      ts.isOmittedExpression(element)
        ? []
        : assignmentTargets(ts.isSpreadElement(element) ? element.expression : element),
    )
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.EqualsToken)
    return assignmentTargets(inner.left)
  return [inner]
}

function qualifiedCallee(callee: ts.Expression): string | null {
  const inner = unwrap(callee)
  return ts.isPropertyAccessExpression(inner) && ts.isIdentifier(inner.expression)
    ? `${inner.expression.text}.${inner.name.text}`
    : null
}

/** Các toán hạng mà một biểu thức có thể trả về nguyên vẹn: `a ? b : c`, `a ?? b`, `a || b`, `a && b`, `(x, y)`. */
function passedOperands(node: ts.Expression): ts.Expression[] {
  const inner = unwrap(node)
  if (ts.isConditionalExpression(inner)) return [...passedOperands(inner.whenTrue), ...passedOperands(inner.whenFalse)]
  if (ts.isBinaryExpression(inner)) {
    if (BINARY_PASSING_AN_OPERAND.has(inner.operatorToken.kind))
      return [...passedOperands(inner.left), ...passedOperands(inner.right)]
    if (inner.operatorToken.kind === ts.SyntaxKind.CommaToken) return passedOperands(inner.right)
  }
  return [inner]
}

/**
 * Định danh tại chỗ khai báo của một BÍ DANH → các biểu thức nó trỏ tới, mỗi cái kèm bước thêm:
 * biến khai báo kèm giá trị (`const a = X as T`, `let t = ns.X`) → giá trị; tên destructure
 * một tầng từ một biến kèm giá trị (`const { X: s } = ns`) → giá trị + khoá. Phần `...rest`
 * là đối tượng mới, không phải bí danh. Không lần: tham số, biến gán sau khai báo.
 */
function aliasSources(declaration: ts.Identifier): Array<{ expression: ts.Expression; prefix: Step[] }> {
  const parent = declaration.parent
  if (ts.isVariableDeclaration(parent) && parent.name === declaration && parent.initializer)
    return passedOperands(parent.initializer).map((expression) => ({ expression, prefix: [] }))
  if (ts.isBindingElement(parent) && parent.name === declaration && !parent.dotDotDotToken) {
    const pattern = parent.parent
    const holder = pattern.parent
    if (!ts.isObjectBindingPattern(pattern) || !ts.isVariableDeclaration(holder) || !holder.initializer) return []
    const key = parent.propertyName ?? parent.name
    const step: Step = ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key) ? key.text : COMPUTED
    return passedOperands(holder.initializer).map((expression) => ({ expression, prefix: [step] }))
  }
  return []
}

/**
 * Gốc đã nhập của `expression` + các bước từ gốc tới nó, lần qua bí danh (xem đầu tệp).
 * `throughAlias` = false ở đích của một phép gán thẳng vào tên (`a = …`): khi `a` là bí danh,
 * phép gán chỉ đổi biến cục bộ.
 */
function importedRoots(
  expression: ts.Expression,
  throughAlias: boolean,
  visiting: Set<ts.Node> = new Set(),
): Array<{ origin: ImportedName; steps: Step[] }> {
  const { root, steps } = chainOf(expression)
  const dynamic = dynamicImportSpecifier(root)
  if (dynamic) return [{ origin: { specifier: dynamic, imported: '*' }, steps }]
  if (!ts.isIdentifier(root)) return []
  const declaration = nearestDeclaration(root)
  if (!declaration) return []
  const origin = importOriginOf(declaration)
  if (origin) return [{ origin, steps }]
  if (!throughAlias || visiting.has(declaration)) return []
  visiting.add(declaration)
  return aliasSources(declaration).flatMap(({ expression: source, prefix }) =>
    importedRoots(source, true, visiting).map((found) => ({ origin: found.origin, steps: [...found.steps, ...prefix, ...steps] })),
  )
}

/** Dạng ghi vào CHÍNH tên đích khi đích không có bước nào (`x = …`, `x++`) — không phải ghi vào đối tượng. */
const REBINDING_FORMS = new Set(['gán', '++/--', 'gán (for)', 'delete'])

const writeCache = new Map<string, { source: string; sites: WriteSite[] }>()

/** Mọi lượt ghi trong `file` có gốc là một tên đã nhập (tĩnh hoặc động). */
function writeSites(file: string, source: string): WriteSite[] {
  const cached = writeCache.get(file)
  if (cached && cached.source === source) return cached.sites
  const sf = ast(file, source)
  const sites: WriteSite[] = []
  const seen = new Set<number>()
  const add = (target: ts.Expression, form: string) => {
    if (seen.has(target.getStart(sf))) return
    const rebindsTheName = chainOf(target).steps.length === 0 && REBINDING_FORMS.has(form)
    const roots = importedRoots(target, !rebindsTheName)
    if (roots.length === 0) return
    seen.add(target.getStart(sf))
    for (const { origin, steps } of roots)
      sites.push({
        line: lineOf(sf, target),
        form,
        computed: steps.includes(COMPUTED),
        origin,
        member: steps[0] ?? null,
      })
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      for (const target of assignmentTargets(node.left)) add(target, 'gán')
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      add(node.operand, '++/--')
    } else if (ts.isDeleteExpression(node)) {
      add(node.expression, 'delete')
    } else if (
      (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    ) {
      for (const target of assignmentTargets(node.initializer)) add(target, 'gán (for)')
    } else if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      if (ts.isPropertyAccessExpression(callee) && MUTATING_METHODS.has(callee.name.text))
        add(callee.expression, `.${callee.name.text}()`)
      else if (ts.isElementAccessExpression(callee)) {
        const key = unwrap(callee.argumentExpression)
        if (ts.isStringLiteralLike(key) && MUTATING_METHODS.has(key.text))
          add(callee.expression, `.${key.text}()`)
      }
      const qualified = qualifiedCallee(node.expression)
      if (qualified && MUTATING_FUNCTIONS.has(qualified) && node.arguments[0])
        add(node.arguments[0], `${qualified}()`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  writeCache.set(file, { source, sites })
  return sites
}

// ─── Luật 4 ──────────────────────────────────────────────────────────────────

export interface StateOwnerResult {
  violations: string[]
  /** `tệp#tên` của mọi trạng thái trong kho — để khẳng định kho không rỗng. */
  inventory: string[]
  /** `tệp ← chủ#tên`: lượt nhập tĩnh giải tới trạng thái của tệp khác — luật không kiểm rỗng. */
  stateImports: string[]
  /** `chủ#tên ← tệp`: lượt ghi được `shared` cho phép — để khẳng định ngoại lệ còn sống. */
  sharedWrites: string[]
}

/**
 * Trạng thái mà nhiều tệp ghi CÓ CHỦ ĐÍCH, có từ trước khi tách: `chủ#tên` → đúng những
 * tệp (ngoài chủ) được ghi. Chỉ nới phần "chỉ chủ ghi" cho đúng các tệp nêu tên — tệp
 * khác ghi vẫn đỏ, bản khai thứ hai vẫn đỏ. Mục chết (tệp nêu tên thôi ghi, hay tên
 * không còn là trạng thái của nhóm nào) cũng đỏ: danh sách không mục được.
 */
export type SharedStateWriters = Readonly<Record<string, { writers: readonly string[], reason: string }>>

export function stateOwnerCheck(
  sources: Sources,
  families: Record<string, Family>,
  shared: SharedStateWriters = {},
): StateOwnerResult {
  const violations: string[] = []
  const owners = new Map<string, { family: string; binding: StateBinding }>()
  for (const [family, definition] of Object.entries(families)) {
    const declaredAt = new Map<string, string[]>()
    for (const file of [definition.barrel, ...familyMembers(sources, definition)]) {
      for (const binding of moduleStateBindings(file, sources.get(file)!)) {
        owners.set(`${file}#${binding.name}`, { family, binding })
        declaredAt.set(binding.name, [
          ...(declaredAt.get(binding.name) ?? []),
          `${file}:${binding.line}`,
        ])
      }
    }
    for (const [name, sites] of declaredAt) {
      if (sites.length > 1)
        violations.push(
          `[${family}] '${name}' khai ở ${sites.length} tệp (${sites.join(', ')}) — trạng thái cấp module chỉ có một chủ; tệp khác import nó từ chủ`,
        )
    }
  }

  const stateOf = (resolved: Resolved | null) =>
    resolved ? owners.get(`${resolved.file}#${resolved.local}`) : undefined
  const stateImports = new Set<string>()
  const sharedWrites = new Map<string, Set<string>>()
  for (const [file, source] of sources) {
    for (const imported of moduleTable(file, source).imports.values()) {
      const from = moduleFile(sources, file, imported.specifier)
      if (!from || imported.imported === '*') continue
      const owner = stateOf(resolveExport(sources, from, imported.imported))
      if (owner && owner.binding.file !== file)
        stateImports.add(`${file} ← ${owner.binding.file}#${owner.binding.name}`)
    }

    for (const site of writeSites(file, source)) {
      const from = moduleFile(sources, file, site.origin.specifier)
      if (!from) continue
      const at = `${file}:${site.line} (${site.form}${site.computed ? ', khoá tính toán' : ''})`
      let name = site.origin.imported
      if (name === '*') {
        if (site.member === null) continue
        if (site.member === COMPUTED) {
          const exposed = exportedNames(sources, from)
            .map((exportName) => stateOf(resolveExport(sources, from, exportName)))
            .find((owner) => owner !== undefined)
          if (exposed)
            violations.push(
              `[${exposed.family}] ${at} ghi qua khoá tính toán trên namespace của ${from}, module có xuất trạng thái cấp module — không xác định được tên, nên không kiểm được chủ`,
            )
          continue
        }
        name = site.member
      }
      const owner = stateOf(resolveExport(sources, from, name))
      if (!owner || owner.binding.file === file) continue
      const key = `${owner.binding.file}#${owner.binding.name}`
      if (shared[key]?.writers.includes(file)) {
        sharedWrites.set(key, (sharedWrites.get(key) ?? new Set()).add(file))
        continue
      }
      violations.push(
        `[${owner.family}] ${at} ghi vào '${owner.binding.name}' của ${owner.binding.file} — chỉ tệp khai báo được ghi trạng thái cấp module của nó`,
      )
    }
  }
  for (const [key, entry] of Object.entries(shared)) {
    if (!owners.has(key)) {
      violations.push(
        `ngoại lệ chết: ${key} không còn là trạng thái cấp module của nhóm nào — sửa hoặc bỏ mục trong danh sách người ghi chung`,
      )
      continue
    }
    const used = [...(sharedWrites.get(key) ?? [])].sort()
    const listed = [...entry.writers].sort()
    if (JSON.stringify(used) !== JSON.stringify(listed))
      violations.push(
        `ngoại lệ chết: ${key} khai người ghi ${JSON.stringify(listed)} nhưng thực tế ghi ${JSON.stringify(used)} — sửa mục trong danh sách người ghi chung`,
      )
  }
  return {
    violations,
    inventory: [...owners.keys()].sort(),
    stateImports: [...stateImports].sort(),
    sharedWrites: [...sharedWrites].flatMap(([key, files]) => [...files].map(file => `${key} ← ${file}`)).sort(),
  }
}
