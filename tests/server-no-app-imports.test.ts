/**
 * `server/` và `shared/` không bao giờ import từ `app/` — giá trị hay kiểu, tĩnh
 * hay động (wave2-hardening, design D-SHARED).
 *
 * Tới a7be585, 14 tệp máy chủ (17 dòng import) với tay sang `app/utils/` để lấy
 * registry block, kiểu cây block và trạng thái đơn. `app/` là mã phía trình duyệt:
 * nó được phép dùng auto-import của Nuxt, `useState`, `window`… — một ngày nào đó
 * một tệp `app/utils` dùng tới một thứ như vậy và máy chủ hỏng mà không trang nào
 * báo trước. Mã dùng chung hai phía nay ở `shared/`; `app/utils/...` cũ chỉ còn là
 * dòng re-export cho phía app.
 *
 * `shared/` cũng là tầng đáy: nó không import `app/` (chỉ là dời vấn đề đi một
 * bậc), không import `server/` (kéo mã máy chủ vào gói trình duyệt), và không dùng
 * alias `#…` nào chỉ có ở một phía (`#server`, `#imports`, `#build`, `#internal`…).
 *
 * Đọc bằng TypeScript AST, không regex trên chữ thô: chú thích và chuỗi thường
 * nhắc tới `app/...` (vd. `/app/public/uploads` trong một thông báo lỗi) không bị
 * tính, còn import nhiều dòng, `import type`, `export … from`, `import()` (kể cả ở
 * vị trí kiểu: `typeof import('…')`), `require()`, hàm require từ `createRequire`,
 * `declare module '…'` và `/// <reference path>` đều bị bắt. Đường tương đối và
 * alias của Nuxt 4 (`~`/`@`, `~~`/`@@`, `#shared`, `#server`) được **giải** ra thư
 * mục rồi so với `<repo>/app/` / `server/` — không đếm `../`, nên `../application/x`
 * không bị nhầm là `app/`. Alias phía app không có thư mục đứng sau (`#app`,
 * `#components`, `#build`, `#app-manifest`) bị cấm theo tên.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP_DIR = path.join(ROOT, 'app')
const SERVER_DIR = path.join(ROOT, 'server')
const SHARED_DIR = path.join(ROOT, 'shared')

const SOURCE_FILE = /\.[cm]?[jt]s$/

interface ModuleReference {
  specifier: string | null
  line: number
  form: string
}

/** Every module this source refers to. `specifier: null` = an `import()` whose
 *  argument is not a literal, so it cannot be checked (and is reported). */
function moduleReferences(fileName: string, source: string): ModuleReference[] {
  const kind = /\.[cm]?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS
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

const inside = (target: string, dir: string) => {
  const rel = path.relative(dir, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Where a specifier lands on disk, or null for a package / virtual module.
 *  Alias theo `.nuxt/tsconfig.{server,shared}.json` của Nuxt 4. */
function resolveOnDisk(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return path.resolve(path.dirname(fromFile), specifier)
  // `~` / `@` = srcDir (app/), `~~` / `@@` = rootDir.
  if (specifier === '~' || specifier === '@') return APP_DIR
  if (specifier.startsWith('~/') || specifier.startsWith('@/')) return path.join(APP_DIR, specifier.slice(2))
  if (specifier === '~~' || specifier === '@@') return ROOT
  if (specifier.startsWith('~~/') || specifier.startsWith('@@/')) return path.join(ROOT, specifier.slice(3))
  // `#shared` → shared/, `#server` → server/.
  for (const [alias, dir] of [['#shared', SHARED_DIR], ['#server', SERVER_DIR]] as const) {
    if (specifier === alias) return dir
    if (specifier.startsWith(`${alias}/`)) return path.join(dir, specifier.slice(alias.length + 1))
  }
  return null
}

/**
 * Module ảo / đầu ra sinh ra của PHÍA APP Nuxt — không có tệp app/ nào đứng sau,
 * nhưng chỉ tồn tại cho gói app: `#app` (+ `#app/…`), `#components`, `#build`
 * (+ `#build/…`: thư mục `.nuxt`, gồm barrel auto-import của app `#build/imports`,
 * components…), `#app-manifest`.
 */
const NUXT_APP_SIDE_ALIAS = /^#(?:app|components|build|app-manifest)(?:\/|$)/
const SHARED_ALIAS = /^#shared(?:\/|$)/

type Side = 'server' | 'shared'

/**
 * Vì sao `specifier` (trong `fromFile`, ở phía `side`) bị cấm — hoặc null.
 *  - server/: không vào app/ (đường, `~`/`@`, `~~/app`), không alias phía app.
 *    `#imports` ở đây là barrel auto-import của **Nitro** → được; `#server`,
 *    `#shared`, `#internal/…` cũng được.
 *  - shared/: như trên, thêm không vào server/, và không alias `#…` nào ngoài
 *    `#shared` — mọi alias khác chỉ có ở MỘT phía (`#imports` của shared trỏ barrel
 *    auto-import của app, `#internal` là của Nitro) và test Node trần không giải
 *    được chúng.
 */
function violation(side: Side, fromFile: string, specifier: string): string | null {
  const target = resolveOnDisk(fromFile, specifier)
  if (target !== null && inside(target, APP_DIR)) return 'trỏ vào app/'
  if (NUXT_APP_SIDE_ALIAS.test(specifier)) return 'alias phía app của Nuxt'
  if (side === 'shared') {
    if (target !== null && inside(target, SERVER_DIR)) return 'trỏ vào server/'
    if (specifier.startsWith('#') && !SHARED_ALIAS.test(specifier)) {
      return 'alias chỉ có ở một phía — shared/ chỉ dùng đường tương đối, #shared/~~/shared hoặc gói npm'
    }
  }
  return null
}

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (SOURCE_FILE.test(entry.name)) files.push(full)
  }
  return files
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

function offendersIn(side: Side, file: string, source: string): string[] {
  const found: string[] = []
  for (const ref of moduleReferences(file, source)) {
    if (ref.specifier === null) {
      found.push(`${rel(file)}:${ref.line} ${ref.form} với đối số không phải chuỗi cố định — không kiểm được`)
      continue
    }
    const why = violation(side, file, ref.specifier)
    if (why) found.push(`${rel(file)}:${ref.line} ${ref.form} '${ref.specifier}' — ${why}`)
  }
  return found
}

const offenders = (side: Side, files: string[]) =>
  files.flatMap((file) => offendersIn(side, file, readFileSync(file, 'utf8')))

const serverFiles = walk(SERVER_DIR)
const sharedFiles = walk(SHARED_DIR)

describe('server/ không import từ app/', () => {
  test('quét đủ cây server/ (không phải danh sách rỗng)', () => {
    assert.ok(serverFiles.length > 300, `chỉ thấy ${serverFiles.length} tệp`)
    assert.ok(serverFiles.map(rel).includes('server/utils/page-versions.ts'))
    assert.ok(serverFiles.map(rel).includes('server/db/schema.ts'))
  })

  test('không tệp nào dưới server/ import app/ — giá trị hay kiểu', () => {
    assert.deepEqual(
      offenders('server', serverFiles),
      [],
      'chuyển module dùng chung sang shared/ (như shared/blocks/registry.ts) và để app/ re-export nó',
    )
  })
})

describe('shared/ là tầng đáy: không import app/ hay server/', () => {
  test('quét đủ cây shared/', () => {
    const names = sharedFiles.map(rel)
    for (const expected of ['shared/blocks/registry.ts', 'shared/blocks/types.ts', 'shared/submission-status.ts', 'shared/link-policy.ts']) {
      assert.ok(names.includes(expected), `thiếu ${expected}`)
    }
  })

  test('không tệp nào dưới shared/ import app/, server/ hay alias riêng của một phía', () => {
    assert.deepEqual(offenders('shared', sharedFiles), [])
  })
})

// ─── Bản re-export ở app/ ────────────────────────────────────────────────────
// Ba đường cũ ở app/ còn lại để import `~/utils/...` và auto-import của Nuxt
// (`app/utils/submission-status.ts` nằm ở tầng đầu `utils/`) không đổi. Chúng trỏ
// tới `~~/shared/…` (Nuxt để shared/ là external trong bản build SSR; re-export
// tương đối của external đó được rolldown in thành đường hỏng, Nitro build đỏ) và
// liệt kê tên thay vì `export *` (unimport không giải alias khi quét `export *`).
// Danh sách tên thì có thể lệch khỏi module gốc — một tên mới ở shared/ thiếu ở
// đây là một auto-import lặng lẽ không có. Nên kiểm khớp đủ, từng tên.

const parseRel = (relPath: string) =>
  ts.createSourceFile(relPath, readFileSync(path.join(ROOT, relPath), 'utf8'), ts.ScriptTarget.Latest, true)

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

/** Tên mà module gốc khai `export` — giá trị và kiểu tách riêng. Dạng export nào
 *  chưa được xử lý thì rơi vào `unhandled` để test đỏ thay vì bỏ sót. */
function declaredExports(relPath: string) {
  const sf = parseRel(relPath)
  const values: string[] = []
  const types: string[] = []
  const unhandled: string[] = []
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) || ts.isExportAssignment(st)) { unhandled.push(st.getText(sf)); continue }
    if (!isExported(st)) continue
    if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) values.push(decl.name.text)
        else unhandled.push(decl.getText(sf))
      }
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) {
      values.push(st.name.text)
    } else if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) {
      types.push(st.name.text)
    } else {
      unhandled.push(st.getText(sf).slice(0, 80))
    }
  }
  return { values: values.sort(), types: types.sort(), unhandled }
}

/** Tên mà bản re-export đưa ra, và module nó trỏ tới. Mọi câu lệnh khác (kể cả
 *  `export *`, đổi tên `a as b`, `type` nội tuyến trong danh sách giá trị) bị báo. */
function shimReExports(relPath: string) {
  const sf = parseRel(relPath)
  const values: string[] = []
  const types: string[] = []
  const targets = new Set<string>()
  const other: string[] = []
  for (const st of sf.statements) {
    if (
      ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
      && st.exportClause && ts.isNamedExports(st.exportClause)
    ) {
      const target = resolveOnDisk(path.join(ROOT, relPath), st.moduleSpecifier.text)
      targets.add(target === null ? st.moduleSpecifier.text : rel(target))
      for (const el of st.exportClause.elements) {
        if (el.isTypeOnly || el.propertyName) other.push(el.getText(sf))
        else (st.isTypeOnly ? types : values).push(el.name.text)
      }
    } else {
      other.push(st.getText(sf).slice(0, 80))
    }
  }
  return { values: values.sort(), types: types.sort(), targets: [...targets], other }
}

describe('bản re-export ở app/ khớp đủ module ở shared/', () => {
  const SHIMS: Array<[shim: string, source: string]> = [
    ['app/utils/blocks/registry.ts', 'shared/blocks/registry'],
    ['app/utils/blocks/types.ts', 'shared/blocks/types'],
    ['app/utils/submission-status.ts', 'shared/submission-status'],
  ]
  for (const [shim, source] of SHIMS) {
    test(`${shim} → ${source}.ts`, () => {
      const declared = declaredExports(`${source}.ts`)
      const shimmed = shimReExports(shim)
      assert.deepEqual(declared.unhandled, [], `${source}.ts có dạng export guard chưa đọc được`)
      assert.ok(declared.values.length > 0, `${source}.ts không có export giá trị nào?`)
      assert.deepEqual(shimmed.other, [], `${shim} chỉ được chứa \`export { … } from\` / \`export type { … } from\``)
      assert.deepEqual(shimmed.targets, [source], `${shim} phải trỏ thẳng tới ${source}`)
      assert.deepEqual(shimmed.values, declared.values, `${shim}: danh sách giá trị lệch ${source}.ts`)
      assert.deepEqual(shimmed.types, declared.types, `${shim}: danh sách kiểu lệch ${source}.ts`)
    })
  }
})

// ─── Bộ dò không mù ──────────────────────────────────────────────────────────
// Guard đọc mã nguồn chỉ có giá trị khi chứng minh được nó bắt đúng thứ cần bắt.

const hits = (side: Side, fakeFile: string, source: string) => offendersIn(side, path.join(ROOT, fakeFile), source)
const appHits = (fakeFile: string, source: string) => hits('server', fakeFile, source)

describe('bộ dò bắt mọi dạng import trỏ vào app/', () => {
  const FAKE = 'server/api/admin/demo/x.ts'
  const cases: Record<string, string> = {
    'createRequire(…)(…)': `import { createRequire } from 'node:module'\nconst x = createRequire(import.meta.url)('../../../../app/utils/x')`,
    'hàm require từ createRequire': `import { createRequire } from 'node:module'\nconst req = createRequire(import.meta.url)\nconst x = req('../../../../app/utils/x')`,
    'declare module (augment module của app)': `declare module '~/utils/x' {\n  export const y: number\n}\nexport {}`,
    '#build/… (thư mục .nuxt: barrel auto-import của app, components…)': `import { useState } from '#build/imports'`,
    '#build': `import x from '#build'`,
    '#app-manifest': `import meta from '#app-manifest'`,
    'import giá trị': `import { a } from '../../../../app/utils/x'`,
    'import type': `import type { T } from '../../../../app/utils/x'`,
    'import với type nội tuyến': `import { a, type T } from '../../../../app/utils/x'`,
    'import chỉ để chạy': `import '../../../../app/utils/x'`,
    'import namespace': `import * as ns from '../../../../app/utils/x'`,
    'import mặc định': `import def from '../../../../app/utils/x.ts'`,
    'import nhiều dòng': `import {\n  a,\n  b,\n} from '../../../../app/utils/x'`,
    'export * from': `export * from '../../../../app/utils/x'`,
    'export { } from': `export { a } from '../../../../app/utils/x'`,
    'export type { } from': `export type { T } from '../../../../app/utils/x'`,
    'import() động': `const m = await import('../../../../app/utils/x')`,
    'import() động nhiều dòng': `const m = await import(\n  '../../../../app/utils/x'\n)`,
    'import() với template không nội suy': 'const m = await import(`../../../../app/utils/x`)',
    'typeof import() ở vị trí kiểu': `type M = typeof import('../../../../app/utils/x')`,
    'import().T ở vị trí kiểu': `let t: import('../../../../app/utils/x').T`,
    'import = require()': `import x = require('../../../../app/utils/x')`,
    'require()': `const x = require('../../../../app/utils/x')`,
    '/// <reference path>': `/// <reference path="../../../../app/types/x.d.ts" />\nexport {}`,
    'alias ~/': `import { a } from '~/utils/x'`,
    'alias @/': `import { a } from '@/utils/x'`,
    'alias ~~/app': `import { a } from '~~/app/utils/x'`,
    'alias @@/app': `import { a } from '@@/app/utils/x'`,
    '#app': `import { useNuxtApp } from '#app'`,
    '#app/…': `import { x } from '#app/composables/x'`,
    '#components': `import { Foo } from '#components'`,
    'import() không phải chuỗi cố định': 'const m = await import(target)',
  }
  for (const [name, source] of Object.entries(cases)) {
    test(name, () => {
      assert.equal(appHits(FAKE, source).length, 1, `không bắt được: ${source}`)
    })
  }
})

describe('bộ dò không báo nhầm', () => {
  const FAKE = 'server/api/admin/demo/x.ts'
  const cases: Record<string, string> = {
    'import shared/': `import { a } from '../../../../shared/blocks/registry'`,
    'import trong server/': `import { b } from '../../../utils/db'`,
    'alias ~~/shared': `import { a } from '~~/shared/link-policy'`,
    'thư mục tên bắt đầu bằng app': `import { a } from '../../../../application/x'`,
    'chú thích nhắc app/': `// import { c } from '../../../../app/utils/x'\n/* from '~/utils/x' */\nexport {}`,
    'chuỗi chứa /app/': `const msg = 'chown node:node /app/public/uploads'`,
    'chuỗi trông như import': `const s = "import x from '../../../../app/utils/x'"`,
    '#imports của Nitro': `import { useRuntimeConfig } from '#imports'`,
    '#shared/…': `import { a } from '#shared/link-policy'`,
    '#server/…': `import { getDb } from '#server/utils/db'`,
    '#internal/… của Nitro': `import { x } from '#internal/nitro'`,
    'declare module của gói npm': `declare module 'h3' {\n  interface H3EventContext { actor?: number }\n}\nexport {}`,
    'createRequire với gói npm': `import { createRequire } from 'node:module'\nconst sharp = createRequire(import.meta.url)('sharp')`,
    'gói npm có scope': `import x from '@scope/app'`,
    'gói npm': `import { ref } from 'vue'`,
  }
  for (const [name, source] of Object.entries(cases)) {
    test(name, () => {
      assert.deepEqual(appHits(FAKE, source), [], `báo nhầm: ${source}`)
    })
  }
})

// shared/ chạy ở cả hai phía và dưới test Node trần, nên nó không được đụng alias
// nào chỉ tồn tại ở MỘT phía. Trong `.nuxt/tsconfig.shared.json`: `#server/*` →
// `../server/*`, `#imports` → `.nuxt/imports` (barrel auto-import của APP — khác
// `#imports` của Nitro ở phía server), `#build/*` → thư mục `.nuxt`.
describe('shared/: bộ dò bắt app/, server/ và alias riêng của một phía', () => {
  const FAKE = 'shared/blocks/x.ts'
  const cases: Record<string, string> = {
    '#server/…': `import { getDb } from '#server/utils/db'`,
    '#server': `import x from '#server'`,
    '#imports (barrel auto-import của app)': `import { useState } from '#imports'`,
    '#build/…': `import { x } from '#build/imports'`,
    '#build': `import x from '#build'`,
    '#internal/… (Nitro)': `import { x } from '#internal/nitro'`,
    '#app': `import { useNuxtApp } from '#app'`,
    '#app-manifest': `import meta from '#app-manifest'`,
    '#components': `import { Foo } from '#components'`,
    'đường tương đối vào app/': `import { a } from '../../app/utils/x'`,
    'đường tương đối vào server/': `import { getDb } from '../../server/utils/db'`,
    'alias ~/': `import { a } from '~/utils/x'`,
    'alias @@/app': `import { a } from '@@/app/utils/x'`,
    'alias ~~/server': `import { getDb } from '~~/server/utils/db'`,
    'import type từ server/': `import type { ActorLike } from '../../server/utils/permissions'`,
    'createRequire vào server/': `import { createRequire } from 'node:module'\nconst x = createRequire(import.meta.url)('../../server/utils/db')`,
    'declare module #imports': `declare module '#imports' {\n  export const y: number\n}\nexport {}`,
  }
  for (const [name, source] of Object.entries(cases)) {
    test(name, () => {
      assert.equal(hits('shared', FAKE, source).length, 1, `không bắt được: ${source}`)
    })
  }
})

describe('shared/: bộ dò không báo nhầm', () => {
  const FAKE = 'shared/blocks/x.ts'
  const cases: Record<string, string> = {
    'tương đối trong shared/blocks': `import type { BlockData } from './types'`,
    'tương đối sang shared/': `import { safeLinkOrNull } from '../link-policy'`,
    '#shared/…': `import { a } from '#shared/link-policy'`,
    '#shared': `import x from '#shared'`,
    'alias ~~/shared': `import { a } from '~~/shared/link-policy'`,
    'kiểu từ gói npm': `import type { Ref } from 'vue'`,
    'gói npm có scope': `import x from '@scope/server'`,
    'chuỗi nhắc #imports': `const note = "đừng import '#imports' ở đây"`,
  }
  for (const [name, source] of Object.entries(cases)) {
    test(name, () => {
      assert.deepEqual(hits('shared', FAKE, source), [], `báo nhầm: ${source}`)
    })
  }
})

describe('bộ dò bắt đúng 17 dòng import có thật tới a7be585', () => {
  // Nguyên văn các dòng trước khi chuyển sang shared/ (14 tệp). Guard phải đỏ với
  // từng dòng, ở đúng tệp của nó — đây là bằng chứng nó đã đỏ với codebase cũ.
  const BASELINE: Array<[string, string]> = [
    ['server/api/admin/pages/[id].get.ts', `import type { BlockNode } from '../../../../app/utils/blocks/types'`],
    ['server/api/admin/pages/[id]/publish.post.ts', `import type { BlockNode } from '../../../../../app/utils/blocks/types'`],
    ['server/api/admin/pages/[id]/blocks/index.post.ts', `import { isValidBlockType, getDefaultData } from '../../../../../../app/utils/blocks/registry'`],
    ['server/api/admin/submissions/index.get.ts', `import { isSubmissionStatus, type SubmissionStatus } from '../../../../app/utils/submission-status'`],
    ['server/api/admin/submissions/bulk-status.post.ts', `import { isSubmissionStatus } from '../../../../app/utils/submission-status'`],
    ['server/db/seed.ts', `import type { BlockData } from '../../app/utils/blocks/types'`],
    ['server/api/public/pages/[slug].get.ts', `import type { BlockData, BlockFieldValue, BlockNode } from '../../../../app/utils/blocks/types'`],
    ['server/services/languages.ts', `import type { BlockData, BlockFieldValue } from '../../app/utils/blocks/types'`],
    ['server/db/schema.ts', `import type { BlockData, BlockNode } from '../../app/utils/blocks/types'`],
    ['server/db/schema.ts', `import type { ContactChannel, SubmissionEventType, SubmissionStatus } from '../../app/utils/submission-status'`],
    ['server/services/stored-html-sanitize.ts', `import type { BlockData } from '../../app/utils/blocks/types'`],
    ['server/services/universal-translation.ts', `import type { BlockData } from '../../app/utils/blocks/types'`],
    ['server/services/submission-workflow.ts', `import {\n  DEFAULT_SUBMISSION_STATUS,\n  SUBMISSION_NOTE_MAX,\n  canTransition,\n  isContactChannel,\n  isSubmissionStatus,\n  type ContactChannel,\n  type SubmissionStatus,\n} from '../../app/utils/submission-status'`],
    ['server/utils/page-versions.ts', `import { isValidBlockType, isContainerType, clampColSpan } from '../../app/utils/blocks/registry'`],
    ['server/utils/page-versions.ts', `import type { BlockData, BlockNode } from '../../app/utils/blocks/types'`],
    ['server/utils/sanitize-html.ts', `import type { BlockData, BlockFieldValue } from '../../app/utils/blocks/types'`],
    ['server/utils/sanitize-html.ts', `import { BLOCK_REGISTRY } from '../../app/utils/blocks/registry'`],
  ]

  test('đủ 17 dòng ở 14 tệp', () => {
    assert.equal(BASELINE.length, 17)
    assert.equal(new Set(BASELINE.map(([file]) => file)).size, 14)
  })

  for (const [file, line] of BASELINE) {
    test(`${file}: ${line.split('\n').at(-1)}`, () => {
      assert.equal(appHits(file, line).length, 1)
      // …và cùng dòng đó trỏ sang shared/ thì hợp lệ.
      assert.deepEqual(appHits(file, line.replace(/app\/utils\/(blocks\/|submission-status)/, 'shared/$1')), [])
    })
  }
})
