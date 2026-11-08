/**
 * Mọi lời gọi TRỰC TIẾP tới một hàm cấp cao nhất, trên một tập tệp nguồn đã parse — cho các phép chứng
 * minh AST cần đi từ tham số của một hàm service ngược về giá trị mà nơi gọi trao cho nó
 * (`tests/_translation-writes.ts`: payload của lượt ghi `articles` là tham số của hàm service, giá trị
 * thật được dựng — và lọc — trong handler).
 *
 * Bảo thủ có chủ đích: bất cứ thứ gì làm tập lời gọi không còn liệt kê được đều trả về một LÝ DO thay
 * vì một danh sách — tên hàm dùng như giá trị (truyền đi, gán, `export { f }`, `typeof f`), import cả module
 * dạng namespace, import động / `require(…)`, re-export từ tệp khác, import qua alias không tương đối, hàm `export default`,
 * và hàm nằm trong `server/utils/**` (Nitro tự import, nơi gọi không cần dòng import). Một danh sách rỗng
 * là "không ai gọi" — nơi dùng quyết định đó có phải là lỗi không.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const ROOT = path.resolve(import.meta.dirname, '..')
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

/** Tệp tuyệt đối → nguồn đã parse. */
export type SourceIndex = ReadonlyMap<string, ts.SourceFile>

export interface CallSite {
  file: string
  source: ts.SourceFile
  call: ts.CallExpression
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

export const parse = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

/**
 * Mã có thể gọi một hàm service lúc chạy thật: `server/**` và `scripts/**`. `tests/**` không tính — test gọi
 * service bằng giá trị giả, không phải một đường ghi của cổng.
 */
export function repoSourceIndex(): Map<string, ts.SourceFile> {
  const index = new Map<string, ts.SourceFile>()
  for (const dir of ['server', 'scripts']) {
    for (const file of sourceFiles(path.join(ROOT, dir))) index.set(file, parse(file, readFileSync(file, 'utf8')))
  }
  return index
}

/**
 * `specifier` (viết trong `importer`) trỏ tới `target`? Đuôi `.ts`/`.js`/`.mjs` bỏ trước khi so (Node và
 * TypeScript nhận cả hai cách viết). Không tương đối mà kết thúc bằng tên tệp (alias `~~/…`) → không theo được.
 */
function importTarget(importer: string, specifier: string, target: string): 'yes' | 'no' | 'unfollowable' {
  const bare = path.basename(target).replace(/\.ts$/, '')
  const stripped = specifier.replace(/\.(?:ts|js|mjs)$/, '')
  if (!specifier.startsWith('.')) return stripped === bare || stripped.endsWith(`/${bare}`) ? 'unfollowable' : 'no'
  const resolved = path.resolve(path.dirname(importer), stripped)
  return [resolved, `${resolved}.ts`, path.join(resolved, 'index.ts')].includes(target) ? 'yes' : 'no'
}

const line = (source: ts.SourceFile, node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1

/** Mọi lời gọi trực tiếp tới hàm `fn` (khai cấp cao nhất trong `declaringFile`), hoặc lý do không liệt kê được. */
export function directCallSites(index: SourceIndex, declaringFile: string, fn: ts.FunctionDeclaration): CallSite[] | string {
  const name = fn.name?.text
  if (!name || !ts.isSourceFile(fn.parent)) return 'not a named top-level function declaration'
  if (fn.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return `${name} is a default export — its importers name it freely`
  if (rel(declaringFile).startsWith('server/utils/')) return `${rel(declaringFile)} is auto-imported by Nitro — calls to ${name} need no import line`
  const sites: CallSite[] = []
  for (const [file, source] of index) {
    const bindings = new Set<string>(file === declaringFile ? [name] : [])
    for (const statement of source.statements) {
      const specifier = (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier
        && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null
      if (specifier === null) continue
      const target = importTarget(file, specifier, declaringFile)
      if (target === 'no') continue
      if (target === 'unfollowable') return `${rel(file)} imports '${specifier}' — not a relative path, its calls cannot be followed`
      if (ts.isExportDeclaration(statement)) {
        const names = statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map(element => (element.propertyName ?? element.name).text)
          : null
        if (names === null || names.includes(name)) return `${rel(file)}:${line(source, statement)} re-exports ${name} — its callers are not listed here`
        continue
      }
      const clause = (statement as ts.ImportDeclaration).importClause
      if (!clause || clause.isTypeOnly) continue
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        return `${rel(file)}:${line(source, statement)} imports ${rel(declaringFile)} as a namespace — calls to ${name} cannot be followed`
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (!element.isTypeOnly && (element.propertyName ?? element.name).text === name) bindings.add(element.name.text)
        }
      }
    }
    let problem: string | null = null
    const visit = (node: ts.Node) => {
      if (problem) return
      // `import(x)` / `require(x)` whose module is not a fixed string could be this one.
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const [argument] = node.arguments
        if (!argument || !ts.isStringLiteralLike(argument)) {
          problem = `${rel(file)}:${line(source, node)} loads a module it does not name — calls to ${name} cannot be ruled out`
          return
        }
      }
      // Any other string naming the module (`import('…')`, `require('…')`, `createRequire(…)('…')`): it can be
      // loaded around the import lines read above.
      const declaration = ts.isStringLiteralLike(node) ? node.parent : undefined
      const moduleSpecifier = declaration && (ts.isImportDeclaration(declaration) || ts.isExportDeclaration(declaration)) ? declaration.moduleSpecifier : null
      if (ts.isStringLiteralLike(node) && node !== moduleSpecifier && importTarget(file, node.text, declaringFile) !== 'no') {
        problem = `${rel(file)}:${line(source, node)} names ${rel(declaringFile)} in a string — it may be loaded around its imports`
        return
      }
      if (ts.isIdentifier(node) && bindings.has(node.text) && node !== fn.name) {
        const parent = node.parent
        const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node)
        if (ts.isImportSpecifier(parent) || isPropertyName) {
          // the import line itself, or `x.name` / `{ name: … }` — not this binding
        } else if (ts.isCallExpression(parent) && parent.expression === node) {
          sites.push({ file, source, call: parent })
        } else {
          problem = `${rel(file)}:${line(source, node)} uses ${name} other than as a direct call — what it is handed cannot be followed`
          return
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (problem) return problem
  }
  return sites
}
