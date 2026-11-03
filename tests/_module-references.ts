/**
 * Đọc MỌI tham chiếu module trong một tệp mã nguồn, bằng TypeScript AST (không
 * regex): chú thích và chuỗi thường không bị tính; import nhiều dòng, `import type`,
 * `export … from`, `import()` (kể cả `typeof import('…')`), `require()`, hàm require
 * từ `createRequire`, `declare module '…'` và `/// <reference path>` đều được đọc.
 *
 * Dùng chung cho các guard ranh giới thư mục: `server-no-app-imports.test.ts`
 * (server/ + shared/ ↛ app/) và `app-shared-imports.test.ts` (app/ → shared/ chỉ
 * qua alias). Tệp `.vue`: đọc từng khối `<script>` / `<script setup>`.
 */
import { parse as parseSfc } from '@vue/compiler-sfc'
import ts from 'typescript'

export interface ModuleReference {
  /** null = một `import()`/`require()` có đối số không phải chuỗi cố định — không kiểm được. */
  specifier: string | null
  line: number
  form: string
}

export function moduleReferences(fileName: string, source: string): ModuleReference[] {
  if (fileName.endsWith('.vue')) {
    const { descriptor } = parseSfc(source, { filename: fileName })
    return [descriptor.script, descriptor.scriptSetup].flatMap((block) => {
      if (!block) return []
      const lang = block.lang === 'tsx' || block.lang === 'jsx' ? block.lang : block.lang === 'ts' ? 'ts' : 'js'
      return moduleReferences(`${fileName}.${lang}`, block.content)
        .map((ref) => ({ ...ref, line: ref.line + block.loc.start.line - 1 }))
    })
  }
  const kind = /\.[cm]?jsx?$/.test(fileName) ? (fileName.endsWith('x') ? ts.ScriptKind.JSX : ts.ScriptKind.JS)
    : fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const out: ModuleReference[] = []
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1
  const literal = (node: ts.Node | undefined): string | null =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
  const push = (node: ts.Node, specifier: string | null, form: string) =>
    out.push({ specifier, line: lineOf(node.getStart(sf)), form })

  for (const ref of sf.referencedFiles) {
    out.push({ specifier: ref.fileName, line: lineOf(ref.pos), form: '/// <reference path>' })
  }

  // `createRequire(import.meta.url)` cho ra một hàm require thật: gọi thẳng
  // (`createRequire(…)('x')`) hoặc qua biến (`const req = createRequire(…)`).
  const isCreateRequire = (node: ts.Expression) =>
    ts.isCallExpression(node)
    && ((ts.isIdentifier(node.expression) && node.expression.text === 'createRequire')
      || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'createRequire'))
  const requireAliases = new Set<string>()
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isCreateRequire(node.initializer)) {
      requireAliases.add(node.name.text)
    }
    ts.forEachChild(node, collect)
  }
  collect(sf)

  const visit = (node: ts.Node): void => {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      // `declare module '…' { … }` — khai/augment kiểu cho đúng module đó.
      push(node, node.name.text, 'declare module')
    } else if (ts.isImportDeclaration(node)) {
      push(node, literal(node.moduleSpecifier), 'import')
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      push(node, literal(node.moduleSpecifier), 'export … from')
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      push(node, literal(node.moduleReference.expression), 'import = require()')
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument
      push(node, ts.isLiteralTypeNode(arg) ? literal(arg.literal) : null, 'import() type')
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        push(node, literal(node.arguments[0]), 'import()')
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        push(node, literal(node.arguments[0]), 'require()')
      } else if (isCreateRequire(node.expression)) {
        push(node, literal(node.arguments[0]), 'createRequire(…)()')
      } else if (ts.isIdentifier(node.expression) && requireAliases.has(node.expression.text)) {
        push(node, literal(node.arguments[0]), `${node.expression.text}() từ createRequire`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}
