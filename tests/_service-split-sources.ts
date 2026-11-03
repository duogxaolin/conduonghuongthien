/**
 * Hạ tầng dùng chung của guard ranh giới các nhóm service đã tách
 * (`tests/service-split-boundaries.test.ts`): tập mã nguồn quét, đột biến trên
 * bản sao, giải đích import, và thành viên của một nhóm.
 *
 * Tiền tố `_`: glob của runner (`tests/*.test.ts`) không nhặt tệp này.
 *
 * Tập tệp quét là mã chạy thật: `server/`, `scripts/`, `shared/`. `tests/` cố ý
 * không quét — test import thẳng tệp con để ghim hành vi nội bộ (vd. điểm tiêm
 * `setCpulimitAvailableForTests` ở `video-process-runner.ts`).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { moduleReferences } from './_module-references.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
export const PRODUCTION_DIRS = ['server', 'scripts', 'shared']
const SOURCE_FILE = /\.[cm]?[jt]s$/
export const SERVICES = 'server/services'

/** Đường dẫn tương đối (dấu `/`) → mã nguồn. Bằng chứng đột biến thay một mục. */
export type Sources = ReadonlyMap<string, string>

function loadProductionSources(): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (entry.isFile() && SOURCE_FILE.test(entry.name))
        out.set(rel, readFileSync(path.join(ROOT, rel), 'utf8'))
    }
  }
  for (const dir of PRODUCTION_DIRS) walk(dir)
  return out
}

export const REPO: Sources = loadProductionSources()

export function withOverrides(overrides: Record<string, string>): Sources {
  const copy = new Map(REPO)
  for (const [file, source] of Object.entries(overrides)) copy.set(file, source)
  return copy
}

/** Chèn một dòng ngay sau khối import cuối cùng — đột biến vẫn là mã hợp lệ. */
export function inject(file: string, line: string): Record<string, string> {
  const source = REPO.get(file)
  assert.ok(
    source,
    `${file} không có trong tập quét — bằng chứng đột biến đang trỏ vào tệp không tồn tại`,
  )
  return { [file]: `${line}\n${source}` }
}

/** Module đích (không đuôi, không `/index`) của một specifier, hoặc null cho package. */
export function resolveTarget(fromFile: string, specifier: string): string | null {
  let target: string
  if (specifier.startsWith('.'))
    target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  else if (specifier.startsWith('~~/') || specifier.startsWith('@@/')) target = specifier.slice(3)
  else if (specifier.startsWith('#server/')) target = `server/${specifier.slice('#server/'.length)}`
  else if (specifier.startsWith('#shared/')) target = `shared/${specifier.slice('#shared/'.length)}`
  else return null
  return target.replace(/\.[cm]?[jt]s$/, '').replace(/\/index$/, '')
}

export const moduleOf = (file: string) => file.replace(/\.[cm]?[jt]s$/, '')

export interface ImportSite {
  file: string
  line: number
  form: string
  /** Specifier nguyên văn; null = `import()`/`require()` có đối số không cố định — không kiểm được. */
  specifier: string | null
  /** Module đích đã giải, hoặc null (package / đối số không cố định). */
  target: string | null
  /** Tên được nhập/xuất lại; `'*'` = cả module (namespace, `export *`, `import()`, `require()`). */
  names: string[] | '*'
}

/** Bộ đệm theo tệp: mỗi bằng chứng đột biến quét lại cả repo, chỉ một tệp đổi. */
const siteCache = new Map<string, { source: string; sites: ImportSite[] }>()

/** Mọi lượt nhập/xuất-lại của một tệp, kèm tên. Đường dẫn: `_module-references.ts`. */
export function importSites(file: string, source: string): ImportSite[] {
  const cached = siteCache.get(file)
  if (cached && cached.source === source) return cached.sites
  const sites = parseImportSites(file, source)
  siteCache.set(file, { source, sites })
  return sites
}

function parseImportSites(file: string, source: string): ImportSite[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const named = new Map<number, string[] | '*'>()
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const record = (node: ts.Node, names: string[] | '*') => {
    const line = lineOf(node)
    const prior = named.get(line)
    named.set(line, prior === '*' || names === '*' ? '*' : [...(prior ?? []), ...names])
  }
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      const names: string[] = []
      let whole = false
      if (clause?.name) names.push('default')
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) whole = true
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements)
          names.push((element.propertyName ?? element.name).text)
      }
      record(statement, whole ? '*' : names)
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const clause = statement.exportClause
      if (!clause || ts.isNamespaceExport(clause)) record(statement, '*')
      else
        record(
          statement,
          clause.elements.map((element) => (element.propertyName ?? element.name).text),
        )
    }
  }
  return moduleReferences(file, source).map((ref) => ({
    file,
    line: ref.line,
    form: ref.form,
    specifier: ref.specifier,
    target: ref.specifier === null ? null : resolveTarget(file, ref.specifier),
    // `import()` / `require()` / `import()` kiểu không có danh sách tên → cả module.
    names:
      ref.form === 'import' || ref.form === 'export … from' ? (named.get(ref.line) ?? '*') : '*',
  }))
}

export const where = (site: { file: string; line: number; form: string }) =>
  `${site.file}:${site.line} (${site.form})`

/**
 * Tệp nguồn (khoá của `Sources`) mang module đích đã giải, hoặc null khi đích
 * không phải mã chạy thật trong tập quét (package, `app/`, tệp không tồn tại).
 */
export function sourceFileOf(sources: Sources, target: string): string | null {
  for (const candidate of [`${target}.ts`, `${target}.mts`, `${target}.js`, `${target}/index.ts`])
    if (sources.has(candidate)) return candidate
  return null
}

// ─── Nhóm: barrel/cửa vào + tệp con ──────────────────────────────────────────

export interface Family {
  barrel: string
  /** Tên tệp thuộc nhóm theo tiền tố, trong thư mục `familyHome(family)`. */
  prefix: RegExp
  /**
   * Thư mục chứa tệp con, khi khác thư mục của barrel. `chat-policy`: barrel ở
   * `server/utils/chatbot/` (đường cũ), tệp con ở `server/services/` — Nitro tự import mọi
   * export của `server/utils/**`, nên tệp con ở đó xuất tên của API lần thứ hai.
   */
  dir?: string
}

/** Thư mục chứa tệp con của nhóm: `family.dir`, mặc định thư mục của barrel. */
export const familyHome = (family: Family): string => family.dir ?? path.posix.dirname(family.barrel)

/**
 * Thành viên của nhóm = tệp theo tiền tố trong `familyHome(family)` ∪ đích mà barrel xuất
 * lại (suy ra, không chép tay). Tệp cùng tiền tố ở thư mục khác không thuộc nhóm.
 */
export function familyMembers(sources: Sources, family: Family): string[] {
  const members = new Set<string>()
  const home = familyHome(family)
  for (const file of sources.keys()) {
    if (
      path.posix.dirname(file) === home &&
      family.prefix.test(path.posix.basename(file)) &&
      file !== family.barrel
    ) {
      members.add(file)
    }
  }
  const barrelSource = sources.get(family.barrel)
  assert.ok(barrelSource, `${family.barrel} không tồn tại`)
  for (const site of importSites(family.barrel, barrelSource)) {
    if (site.form !== 'export … from' || !site.target) continue
    const file = `${site.target}.ts`
    if (sources.has(file)) members.add(file)
  }
  return [...members].sort()
}
