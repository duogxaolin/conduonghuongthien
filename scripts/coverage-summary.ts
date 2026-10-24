/**
 * Độ phủ test tính trên MỌI tệp nguồn, kể cả tệp không test nào nạp.
 *
 * `node --test --experimental-test-coverage` chỉ đo những tệp mà lúc chạy có module
 * nào import. Một tệp không ai nạp thì vắng khỏi mẫu số, chứ không được tính là 0 %.
 * Cờ `--test-coverage-include-all` sửa chuyện đó nhưng chỉ có trên Node 26 (Node 24.21
 * và 22.23 báo `bad option`). Script này làm cùng việc trên mọi phiên bản, từ báo cáo
 * lcov:
 *
 *   1. **Gộp bản ghi trùng.** Test chạy với `--experimental-test-module-mocks`, và lcov
 *      có thể có nhiều bản ghi cùng `SF:`. Đo 2026-10-24: lượt thường trên Node 24 có 2
 *      tệp như vậy. Thêm `--test-coverage-include-all` (Node 26) thì có 69 tệp, gồm cả
 *      bản ghi toàn-0. Cộng thẳng là đếm tệp đó hai lần; lấy một bản ghi là có khi lấy
 *      nhầm bản 0. Ở đây: một dòng/hàm/nhánh được tính là đã chạy nếu **bất kỳ** bản ghi
 *      nào chạy nó (lấy số lần lớn nhất).
 *   2. **Thêm tệp chưa nạp, ở 0 %.** Tập nguồn là mọi tệp `.ts` git theo dõi dưới
 *      `server/`, `shared/`, `app/utils/`, `app/composables/`. Trừ ra:
 *      `server/db/schema-tables/` (DDL chỉ chạy trong suite integration), `*.d.ts` và
 *      `*.test.ts`/`*.spec.ts`. Tệp nào không có trong lcov được thêm với số **dòng có
 *      mã** của nó (không trống, không chỉ là chú thích — `codeLineCount`, một bộ quét
 *      gần đúng), toàn bộ chưa chạy.
 *      Đây là phép gần đúng, và nó không đối xứng với tệp đã nạp. Với tệp đã nạp, Node
 *      đếm **mọi** dòng vật lý (đã kiểm trên 22.23, 24.21 và 26.11), và dòng trống hay
 *      chú thích được tính là đã chạy khi khối mã chứa nó chạy. Nên chú thích giúp tỉ lệ
 *      của tệp đã nạp, nhưng không kéo tệp chưa nạp xuống. `--test-coverage-include-all`
 *      của Node 26 lại dùng một quy tắc thứ ba: bỏ dòng chỉ có kiểu, giữ dòng trống. Vậy
 *      không có quy tắc nào của Node để chép theo. Tệp chỉ khai báo kiểu vẫn bị tính 0 %.
 *      Hàm và nhánh của tệp chưa nạp thì không biết được (Node không phân tích tệp đó),
 *      nên hai cột này chỉ nói về tệp đã nạp.
 *   3. **In** tổng chung và theo thư mục, cho cả "mọi tệp" lẫn "chỉ tệp đã nạp", kèm
 *      danh sách tệp chưa nạp và các tệp đã nạp ít được phủ nhất. Có
 *      `$GITHUB_STEP_SUMMARY` thì ghi thêm vào đó.
 *
 * CHỈ báo cáo, không chặn: chưa có ngưỡng nào. Wave 3 đặt ngưỡng trên các số này.
 *
 *   node --experimental-strip-types scripts/coverage-summary.ts <lcov> [--root <thư mục repo>]
 *
 * Hàm và nhánh được ghép giữa các bản ghi theo dòng (cộng tên, với hàm có tên). Lý do:
 * tên `anonymous_N` và mã khối của `BRDA` là bộ đếm riêng của từng bản ghi, có thể lệch
 * nhau giữa hai lần nạp cùng một tệp. Dòng (`DA`) thì ghép chính xác.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type FileCoverage = {
  path: string
  loaded: boolean
  /** line → highest hit count across the file's records */
  lines: Map<number, number>
  functions: Map<string, number>
  branches: Map<string, number>
}

export type Ratio = { hit: number, total: number }
export type Totals = { files: number, neverLoaded: number, lines: Ratio, loadedLines: Ratio, functions: Ratio, branches: Ratio }

const SCOPE_ROOTS = ['server/', 'shared/', 'app/utils/', 'app/composables/']
const SCOPE_EXCLUDED = ['server/db/schema-tables/']

/** Whether a repo-relative path belongs to the measured source set. */
export function inCoverageScope(file: string): boolean {
  return file.endsWith('.ts')
    && !file.endsWith('.d.ts')
    && !/\.(?:test|spec)\.ts$/.test(file)
    && SCOPE_ROOTS.some(root => file.startsWith(root))
    && !SCOPE_EXCLUDED.some(excluded => file.startsWith(excluded))
}

/** Repo-relative with forward slashes; Node writes `SF:` relative to its cwd, absolute on some setups. */
export function normalizeSourcePath(file: string, root: string): string {
  let value = file.replace(/^file:\/\//, '').replaceAll('\\', '/')
  const base = root.replaceAll('\\', '/').replace(/\/?$/, '/')
  if (root && value.startsWith(base)) value = value.slice(base.length)
  return value.replace(/^\.\//, '')
}

/** A `/` after one of these (or at the start) opens a regex literal, not a division. */
const REGEX_PREFIX = '(,=:[!&|?{};+-*%<>~^'

/**
 * Lines with code: at least one character outside whitespace and comments. A small
 * scanner, not a parser. It tracks `'…'`/`"…"` strings (which end at the line end,
 * like TypeScript's), template literals (which may span lines), regex literals (by the
 * usual "what precedes the slash" rule), and `//` and block comments. A type-only line
 * counts as code. An odd construct can misclassify a line or two.
 */
export function codeLineCount(text: string): number {
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex'
  let state: State = 'code'
  let inClass = false
  let lineHasCode = false
  let previous = ''
  let count = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!
    const next = text[i + 1]
    if (c === '\n') {
      if (lineHasCode) count += 1
      lineHasCode = false
      if (state === 'line' || state === 'single' || state === 'double' || state === 'regex') state = 'code'
      continue
    }
    if (state === 'line') continue
    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; i += 1 }
      continue
    }
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; i += 1; continue }
      if (c === '/' && next === '*') { state = 'block'; i += 1; continue }
      if (/\s/.test(c)) continue
      lineHasCode = true
      if (c === "'") state = 'single'
      else if (c === '"') state = 'double'
      else if (c === '`') state = 'template'
      else if (c === '/' && (previous === '' || REGEX_PREFIX.includes(previous))) { state = 'regex'; inClass = false }
      previous = c
      continue
    }
    // Inside a string, template or regex literal.
    if (!/\s/.test(c)) lineHasCode = true
    if (c === '\\' && next !== '\n') { i += 1; continue }
    const closes = (state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')
      || (state === 'regex' && c === '/' && !inClass)
    if (state === 'regex' && c === '[') inClass = true
    if (state === 'regex' && c === ']') inClass = false
    if (closes) { state = 'code'; previous = 'value' }
  }
  if (lineHasCode) count += 1
  return count
}

function keepMax<K>(map: Map<K, number>, key: K, hits: number) {
  map.set(key, Math.max(map.get(key) ?? 0, hits))
}

/**
 * Parses an lcov report and merges every record of the same source file. Records
 * outside the source set (tests, helpers, node_modules, DDL) are dropped.
 */
export function parseLcov(text: string, root = ''): Map<string, FileCoverage> {
  const files = new Map<string, FileCoverage>()
  let current: FileCoverage | null = null
  // Per record: FN lines in order (FNDA follows in the same order, by name), and
  // occurrence counters so per-record ids do not have to match across records.
  let fnKeys: string[] = []
  let fnSeen = new Map<string, number>()
  let fnHits: number[] = []
  let branchSeen = new Map<number, number>()

  const flush = () => {
    if (!current) return
    fnKeys.forEach((key, index) => keepMax(current!.functions, key, fnHits[index] ?? 0))
    current = null
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('SF:')) {
      flush()
      const file = normalizeSourcePath(line.slice(3), root)
      fnKeys = []
      fnSeen = new Map()
      fnHits = []
      branchSeen = new Map()
      if (!inCoverageScope(file)) continue
      if (!files.has(file)) files.set(file, { path: file, loaded: true, lines: new Map(), functions: new Map(), branches: new Map() })
      current = files.get(file)!
    } else if (line === 'end_of_record') {
      flush()
    } else if (!current) {
      continue
    } else if (line.startsWith('DA:')) {
      const [lineNo, hits] = line.slice(3).split(',')
      keepMax(current.lines, Number(lineNo), Number(hits) || 0)
    } else if (line.startsWith('FN:')) {
      const comma = line.indexOf(',')
      const lineNo = line.slice(3, comma)
      const name = line.slice(comma + 1)
      const label = /^anonymous_\d+$/.test(name) || name === '' ? 'anonymous' : name
      const base = `${lineNo}:${label}`
      const nth = (fnSeen.get(base) ?? 0) + 1
      fnSeen.set(base, nth)
      fnKeys.push(`${base}#${nth}`)
    } else if (line.startsWith('FNDA:')) {
      const hits = Number(line.slice(5, line.indexOf(','))) || 0
      fnHits.push(hits)
    } else if (line.startsWith('BRDA:')) {
      const [lineNo, , , taken] = line.slice(5).split(',')
      const at = Number(lineNo)
      const nth = (branchSeen.get(at) ?? 0) + 1
      branchSeen.set(at, nth)
      keepMax(current.branches, `${at}#${nth}`, taken === '-' ? 0 : Number(taken) || 0)
    }
  }
  flush()
  // A loaded module always runs its top level. A record where no line ran is the
  // all-zero stub Node 26's `--test-coverage-include-all` adds — not a loaded file.
  for (const file of files.values()) file.loaded = [...file.lines.values()].some(hits => hits > 0)
  return files
}

/** Adds every in-scope source file the report does not mention, at 0 %. */
export function withUnloadedSources(coverage: Map<string, FileCoverage>, sources: Array<{ path: string, text: string }>): FileCoverage[] {
  const all = new Map(coverage)
  for (const source of sources) {
    if (!inCoverageScope(source.path) || all.has(source.path)) continue
    // Synthetic keys 1..n: only the count matters for a file that never ran.
    const lines = new Map<number, number>()
    for (let n = 1; n <= codeLineCount(source.text); n += 1) lines.set(n, 0)
    all.set(source.path, { path: source.path, loaded: false, lines, functions: new Map(), branches: new Map() })
  }
  return [...all.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** `server/<first level>` under server/, otherwise the scope root itself. */
export function directoryGroups(file: string): string[] {
  const root = SCOPE_ROOTS.find(candidate => file.startsWith(candidate))
  if (!root) return []
  const top = root.replace(/\/$/, '')
  if (top !== 'server') return [top]
  const rest = file.slice(root.length).split('/')
  return rest.length > 1 ? [top, `${top}/${rest[0]}`] : [top]
}

const count = (map: Map<unknown, number>): Ratio => ({ hit: [...map.values()].filter(hits => hits > 0).length, total: map.size })
const add = (a: Ratio, b: Ratio): Ratio => ({ hit: a.hit + b.hit, total: a.total + b.total })

export function summarize(files: FileCoverage[]): Map<string, Totals> {
  const groups = new Map<string, Totals>()
  const empty = (): Totals => ({ files: 0, neverLoaded: 0, lines: { hit: 0, total: 0 }, loadedLines: { hit: 0, total: 0 }, functions: { hit: 0, total: 0 }, branches: { hit: 0, total: 0 } })
  for (const file of files) {
    const lines = count(file.lines)
    for (const key of ['all', ...directoryGroups(file.path)]) {
      if (!groups.has(key)) groups.set(key, empty())
      const totals = groups.get(key)!
      totals.files += 1
      if (!file.loaded) totals.neverLoaded += 1
      totals.lines = add(totals.lines, lines)
      if (file.loaded) totals.loadedLines = add(totals.loadedLines, lines)
      totals.functions = add(totals.functions, count(file.functions))
      totals.branches = add(totals.branches, count(file.branches))
    }
  }
  return groups
}

export const percent = (ratio: Ratio) => (ratio.total === 0 ? '—' : `${(100 * ratio.hit / ratio.total).toFixed(2)}%`)

export function renderCoverageSummary(files: FileCoverage[], options: { limit?: number } = {}): string {
  if (files.length === 0) return '### Test coverage\n\nNo coverage data (report only — nothing is enforced).\n'
  const groups = summarize(files)
  const all = groups.get('all')!
  const order = ['all', ...[...groups.keys()].filter(key => key !== 'all').sort()]
  const rows = order.map((key) => {
    const t = groups.get(key)!
    const name = key === 'all' ? '**all files**' : `\`${key}/\``
    return `| ${name} | ${t.files} | ${t.neverLoaded} | ${percent(t.lines)} (${t.lines.hit}/${t.lines.total}) | ${percent(t.loadedLines)} | ${percent(t.functions)} | ${percent(t.branches)} |`
  })
  const loaded = files.filter(file => file.loaded)
  const lowest = loaded
    .map(file => ({ file, ratio: count(file.lines) }))
    .sort((a, b) => a.ratio.hit / (a.ratio.total || 1) - b.ratio.hit / (b.ratio.total || 1) || a.file.path.localeCompare(b.file.path))
    .slice(0, options.limit ?? 15)
    .map(({ file, ratio }) => `| \`${file.path}\` | ${percent(ratio)} | ${percent(count(file.functions))} | ${percent(count(file.branches))} |`)
  const never = files.filter(file => !file.loaded).map(file => `- \`${file.path}\` (${file.lines.size} code lines)`)
  return [
    '### Test coverage',
    '',
    `**${percent(all.lines)} of lines across all ${all.files} source files** (${all.neverLoaded} never loaded by a test count as 0 %) · ${percent(all.loadedLines)} of lines in loaded files · ${percent(all.functions)} functions · ${percent(all.branches)} branches (functions and branches: loaded files only).`,
    '',
    '_Report only — no threshold is enforced. Sources: `server/`, `shared/`, `app/utils/`, `app/composables/` (not `server/db/schema-tables/`). Duplicate lcov records of one file are merged; a file no test loads counts its non-blank, non-comment lines as uncovered._',
    '',
    '| directory | files | never loaded | lines, all files | lines, loaded files | functions | branches |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `<details><summary>${lowest.length} least-covered loaded files</summary>`,
    '',
    '| file | lines | functions | branches |',
    '|---|---|---|---|',
    ...lowest,
    '',
    '</details>',
    '',
    `<details><summary>${never.length} files no test loads</summary>`,
    '',
    ...never,
    '',
    '</details>',
    '',
  ].join('\n')
}

/** Tracked files under the scope roots; a plain directory walk when git is unavailable. */
export function listSourceFiles(root: string): string[] {
  try {
    const output = execFileSync('git', ['ls-files', '-z', '--', ...SCOPE_ROOTS], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return output.split('\0').filter(Boolean).filter(inCoverageScope).sort()
  } catch {
    return SCOPE_ROOTS
      .filter(dir => existsSync(path.join(root, dir)))
      .flatMap(dir => readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' }).map(entry => `${dir}${entry.replaceAll('\\', '/')}`))
      .filter(inCoverageScope)
      .sort()
  }
}

// CLI: report only — a missing report prints a note and exits 0.
if (import.meta.main) {
  const args = process.argv.slice(2)
  const rootIndex = args.indexOf('--root')
  const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] ?? '.' : process.cwd())
  const lcovPath = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--root')[0]
  if (!lcovPath) {
    console.error('usage: coverage-summary.ts <lcov file> [--root <repo dir>]')
    process.exit(2)
  }
  let markdown: string
  if (!existsSync(lcovPath)) {
    markdown = `### Test coverage\n\nNo lcov report at \`${lcovPath}\` (report only — nothing is enforced).\n`
  } else {
    const coverage = parseLcov(readFileSync(lcovPath, 'utf8'), root)
    const sources = listSourceFiles(root).map(file => ({ path: file, text: readFileSync(path.join(root, file), 'utf8') }))
    markdown = renderCoverageSummary(coverage.size === 0 ? [] : withUnloadedSources(coverage, sources))
  }
  process.stdout.write(markdown)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
}
