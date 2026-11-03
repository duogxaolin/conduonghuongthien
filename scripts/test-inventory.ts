/**
 * Kiểm kê các test đọc văn bản mã nguồn (Wave 3 · 7.2, docs/decisions/test-strategy.md).
 *
 * Liệt kê mọi `tests/*.test.ts` đọc tệp dưới `app/`, `server/`, `scripts/` hoặc `shared/`
 * — trực tiếp (`readFileSync`, `fs.readFile`, `readdirSync`, `git show`) hay qua helper
 * `tests/_*.ts` (`_render-sfc-template`, `_layout-parts`, `_service-split-*`…) — và với
 * mỗi tệp: đọc những gì, bao nhiêu khối `it`/`test` phụ thuộc văn bản đó, và lớp:
 *
 *   - `behavioural` (ứng viên hành vi): khẳng định một bất biến an ninh/dữ liệu chạy được;
 *   - `structural` (cấu trúc): ratchet, giới hạn bố cục, hình dạng CI, kiểm kê guard,
 *     luật ranh giới AST;
 *   - `brittle` (giòn): ghim định dạng, chú thích, chuỗi nguyên văn không mang bất biến.
 *
 * Lớp tự động là lượt đầu (heuristic dưới đây); lớp cuối lấy từ bản duyệt tay
 * `scripts/test-inventory-review.ts`. Đọc tệp ngoài bốn gốc (CI, Dockerfile, compose,
 * `production/`…) chỉ ghi vào `otherReads`, không đưa tệp vào bảng.
 *
 *   node --experimental-strip-types scripts/test-inventory.ts [--markdown] [--root <thư mục>] [--no-review]
 *
 * JSON ra stdout, sắp xếp ổn định (không mốc thời gian, không đường dẫn tuyệt đối).
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { analyzeModule, type Block, type Class, type FileFacts, type HelperInfo } from './test-inventory-analyze.ts'
import { REVIEW, type Review } from './test-inventory-review.ts'

export const CLASSES: readonly Class[] = ['behavioural', 'brittle', 'structural']
const LABEL: Record<Class, string> = { behavioural: 'hành vi', brittle: 'giòn', structural: 'cấu trúc' }

const STRUCTURAL_NAME = /(boundar|ratchet|split|imports?\b|registry|inventory|matrix|layout|-ui\b|-ui-|a11y|focus-ring|contrast|skeleton|tailwind|asset-pipeline|^ci-|docker|dependabot|drift|timers|structure|single-h1|diacritics|-docs$)/
const SECURITY = /\b(security|auth\w*|permission\w*|rbac|sanitiz\w*|xss|sql\w*|secrets?|password\w*|mfa|rate.?limit\w*|client.?ip|privacy|credentials?|mask\w*|sessions?|cookies?|tokens?|oauth|moderat\w*|quota|ssrf|safe.?path|escalat\w*|super.?admin|honeypot|csrf|inject\w*|redact\w*|bcrypt|encrypt\w*|envelope|forbidden|leak\w*)\b/i
const DATA = /\b(audit\w*|atomic\w*|transactions?|retention|integrity|upsert|migrat\w*|backups?|restore\w*|rollback|idempot\w*|concurren\w*|race|locks?|tdz|insertid|affectedrows|cascade|unique|dedup\w*|purge\w*)\b/i
const INVENTORY_TITLE = /\b(every|no other|nowhere|no (handler|file|page|route|endpoint|caller|component|server|module)s?\b|only [\w./`[\]-]+ (writes|reads|calls|imports|uses))|\bmọi\b|không (tệp|handler|trang|nơi|file)/i

/** Lượt tự động cho một khối: tín hiệu cấu trúc trước, rồi chú thích, rồi từ khoá an ninh/dữ liệu. */
export function classifyBlock(block: Block, facts: FileFacts): { cls: Class, signal: string } {
  const name = path.basename(facts.file, '.test.ts')
  const text = `${name.replace(/-/g, ' ')} ${block.title}`
  if (facts.ast) return { cls: 'structural', signal: 'ast' }
  if (block.lineCount) return { cls: 'structural', signal: 'line-count' }
  if (STRUCTURAL_NAME.test(name)) return { cls: 'structural', signal: 'name' }
  if (facts.scansDirs && INVENTORY_TITLE.test(block.title)) return { cls: 'structural', signal: 'inventory' }
  if (block.commentPins > 0) return { cls: 'brittle', signal: 'comment-pin' }
  if (SECURITY.test(text)) return { cls: 'behavioural', signal: 'security' }
  if (DATA.test(text)) return { cls: 'behavioural', signal: 'data' }
  return { cls: 'structural', signal: 'default' }
}

/** Lớp của tệp: có ứng viên hành vi → hành vi; giòn chiếm ít nhất nửa → giòn; còn lại cấu trúc. */
function fileClass(classes: Class[]): Class {
  if (classes.includes('behavioural')) return 'behavioural'
  const brittle = classes.filter(c => c === 'brittle').length
  return brittle > 0 && brittle * 2 >= classes.length ? 'brittle' : 'structural'
}

/**
 * Một dòng của bảng. Bản duyệt có thể đánh dấu khối (hay cả tệp) là `executed`: khối đó chạy
 * mã thật và chỉ dùng văn bản nguồn để dựng sandbox — giới hạn của phân tích nhiễm — nên
 * không tính vào khối đọc nguồn.
 */
function row(facts: FileFacts, review: Review | undefined) {
  const detected = facts.blocks.filter(b => b.source).map((block) => {
    const auto = classifyBlock(block, facts)
    const cls: Class | 'executed' = review?.blocks?.[block.title] ?? review?.class ?? auto.cls
    return { title: block.title, autoClass: auto.cls, signal: auto.signal, class: cls }
  })
  const sourceBlocks = detected.filter((b): b is typeof b & { class: Class } => b.class !== 'executed')
  const autoClass = fileClass(detected.map(b => b.autoClass))
  const finalClass: Class = review && review.class !== 'executed' ? review.class : autoClass
  const byClass = Object.fromEntries(CLASSES.map(c => [c, sourceBlocks.filter(b => b.class === c).length])) as Record<Class, number>
  return {
    file: facts.file,
    reads: facts.reads,
    otherReads: facts.otherReads,
    unresolvedReads: facts.unresolvedReads,
    helpers: facts.helpers,
    tests: facts.blocks.length,
    sourceTests: sourceBlocks.length,
    executedTests: facts.blocks.filter(b => b.executed).length + detected.length - sourceBlocks.length,
    byClass,
    sourceBlocks,
    autoClass,
    class: finalClass,
    overridden: !!review && finalClass !== autoClass,
    blockOverrides: detected.filter(b => b.class !== b.autoClass).length,
    reviewed: !!review,
    note: review?.note ?? '',
  }
}
export type Row = ReturnType<typeof row>

export function inventory(root: string, review: Record<string, Review>) {
  const testsDir = path.join(root, 'tests')
  const names = readdirSync(testsDir).sort()
  const helperNames = names.filter(n => /^_.*\.ts$/.test(n))
  const testNames = names.filter(n => n.endsWith('.test.ts'))
  const program = ts.createProgram([...helperNames, ...testNames].map(n => path.join(testsDir, n)), {
    noResolve: true, noLib: true, types: [], noEmit: true, allowImportingTsExtensions: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
  })
  const checker = program.getTypeChecker()
  const analyze = (name: string, helpers: Map<string, HelperInfo>) =>
    analyzeModule(program.getSourceFile(path.join(testsDir, name))!, checker, `tests/${name}`, helpers)
  const helpers = new Map<string, HelperInfo>()
  // Helper có thể nhập helper khác: ba lượt đủ cho chuỗi sâu nhất hiện có (2 bậc).
  for (let pass = 0; pass < 3; pass++) for (const name of helperNames) helpers.set(`tests/${name}`, analyze(name, helpers).helper)

  const rows: Row[] = []
  const executedOnly: Array<{ file: string, reads: string[], executedTests: number, tests: number, note: string }> = []
  const otherOnly: Array<{ file: string, otherReads: string[] }> = []
  const unresolvedOnly: Array<{ file: string, unresolvedReads: number }> = []
  const analyzedBlocks = new Map<string, string[]>()
  for (const name of testNames) {
    const { facts } = analyze(name, helpers)
    analyzedBlocks.set(facts.file, facts.blocks.filter(b => b.source).map(b => b.title))
    const entry = row(facts, review[facts.file])
    if (entry.sourceTests > 0) rows.push(entry)
    else if (facts.reads.length > 0) {
      executedOnly.push({ file: facts.file, reads: facts.reads, executedTests: entry.executedTests, tests: facts.blocks.length, note: entry.note })
    } else if (facts.otherReads.length > 0) otherOnly.push({ file: facts.file, otherReads: facts.otherReads })
    else if (facts.unresolvedReads > 0) unresolvedOnly.push({ file: facts.file, unresolvedReads: facts.unresolvedReads })
  }
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
  const totals = {
    files: rows.length,
    tests: sum(rows.map(r => r.tests)),
    sourceTests: sum(rows.map(r => r.sourceTests)),
    byClass: Object.fromEntries(CLASSES.map(c => [c, {
      files: rows.filter(r => r.class === c).length,
      tests: sum(rows.map(r => r.byClass[c])),
    }])) as Record<Class, { files: number, tests: number }>,
    overridden: rows.filter(r => r.overridden).length,
    blockOverrides: sum(rows.map(r => r.blockOverrides)),
    unreviewed: rows.filter(r => !r.reviewed).length,
  }
  const listed = new Set([...rows, ...executedOnly].map(r => r.file))
  const titlesOf = (file: string) => new Set(analyzedBlocks.get(file) ?? [])
  // Một mục duyệt (tệp hay tiêu đề khối) không còn khớp gì: bản duyệt đã cũ, phải sửa tay.
  const staleReview = [
    ...Object.keys(review).filter(file => !listed.has(file)),
    ...Object.entries(review).flatMap(([file, entry]) => Object.keys(entry.blocks ?? {}).filter(title => !titlesOf(file).has(title)).map(title => `${file} :: ${title}`)),
  ].sort()
  return { totals, tests: rows, executedOnly, otherOnly, unresolvedOnly, staleReview }
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function renderMarkdown(report: ReturnType<typeof inventory>): string {
  const { totals } = report
  const out = [
    '<!-- Sinh bởi `node --experimental-strip-types scripts/test-inventory.ts --markdown`; lớp đã duyệt ở `scripts/test-inventory-review.ts`. -->',
    '',
    '| Lớp (đã duyệt) | Tệp | Khối đọc nguồn |',
    '|---|--:|--:|',
    ...CLASSES.map(c => `| ${LABEL[c]} | ${totals.byClass[c].files} | ${totals.byClass[c].tests} |`),
    `| **Tổng** | **${totals.files}** | **${totals.sourceTests}** (trên ${totals.tests} khối của các tệp này) |`,
    '',
    `Lớp tệp sửa tay so với lượt tự động: ${totals.overridden}; khối sửa tay: ${totals.blockOverrides}; tệp chưa duyệt: ${totals.unreviewed}.`,
    '',
    '| Tệp test | Đọc nguồn | Khối nguồn / tổng | H · C · G | Tự động | Đã duyệt | Sửa tay | Ghi chú |',
    '|---|---|--:|---|---|---|---|---|',
  ]
  for (const r of report.tests) {
    const reads = r.reads.slice(0, 3).map(p => `\`${p}\``).join(', ') + (r.reads.length > 3 ? ` +${r.reads.length - 3}` : '')
    const changed = [r.overridden ? 'có' : '', r.blockOverrides > 0 ? `${r.blockOverrides} khối` : ''].filter(Boolean).join(', ')
    const counts = `${r.sourceTests}/${r.tests}${r.executedTests > 0 ? ` (+${r.executedTests} chạy)` : ''}`
    out.push(`| \`${r.file}\` | ${reads} | ${counts} | ${r.byClass.behavioural} · ${r.byClass.structural} · ${r.byClass.brittle} | ${LABEL[r.autoClass]} | ${r.reviewed ? LABEL[r.class] : 'CHƯA DUYỆT'} | ${changed} | ${cell(r.note)} |`)
  }
  if (report.staleReview.length > 0) {
    out.push('', 'Mục duyệt không còn khớp (sửa `scripts/test-inventory-review.ts`):', '')
    for (const entry of report.staleReview) out.push(`- ${cell(entry)}`)
  }
  if (report.executedOnly.length > 0) {
    out.push('', 'Đọc mã nguồn chỉ để dựng/chạy nó (render template, eval, chép vào sandbox) — không khẳng định trên văn bản, không vào bảng:', '')
    for (const e of report.executedOnly) {
      const reads = e.reads.slice(0, 3).map(p => `\`${p}\``).join(', ') + (e.reads.length > 3 ? ` +${e.reads.length - 3}` : '')
      out.push(`- \`${e.file}\` — ${e.executedTests}/${e.tests} khối chạy; ${reads}${e.note ? `. ${cell(e.note)}` : ''}`)
    }
  }
  if (report.otherOnly.length > 0) {
    out.push('', 'Chỉ đọc tệp ngoài bốn gốc (không vào bảng):', '')
    for (const o of report.otherOnly) out.push(`- \`${o.file}\` — ${o.otherReads.map(p => `\`${p}\``).join(', ')}`)
  }
  if (report.unresolvedOnly.length > 0) {
    out.push('', 'Có lời gọi đọc không suy được đường dẫn (duyệt tay, không vào bảng):', '')
    for (const u of report.unresolvedOnly) out.push(`- \`${u.file}\` — ${u.unresolvedReads} lời gọi`)
  }
  return `${out.join('\n')}\n`
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const rootAt = args.indexOf('--root')
  const root = rootAt >= 0 ? path.resolve(args[rootAt + 1] ?? '.') : path.resolve(import.meta.dirname, '..')
  const report = inventory(root, args.includes('--no-review') ? {} : REVIEW)
  process.stdout.write(args.includes('--markdown') ? renderMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`)
}
