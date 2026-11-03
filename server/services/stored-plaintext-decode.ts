import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm'
import type { MySqlColumn } from 'drizzle-orm/mysql-core'
import { getDb } from '../utils/db'
import { articles, articleTranslations } from '../db/schema'
import { decodeHtmlEntities, dropTruncatedEntity, plainTextField } from '../utils/decode-html-entities'
import { affectedRowsOrZero } from '../utils/affected-rows'

/**
 * Sửa một lần `title`/`excerpt` đã lưu ở dạng HTML entity (`Ng&agrave;y 26/8` nhập
 * từ CMS cũ) trong `articles` và `article_translations` về đúng chữ thuần mà đường
 * đọc công khai đang hiện (`plainTextField`: giải mã + sửa entity bị cắt cuối chuỗi
 * khi chuỗi ở dạng mã hoá) — để tìm kiếm SQL `LIKE '%Ngày%'` khớp chữ người đọc thấy,
 * và để wave2 bỏ được phép đoán lúc đọc.
 *
 * Cùng khuôn `stored-html-sanitize.ts`: phần "sửa hàng nào" là hàm thuần
 * (`planPlainTextFixes`); `runPlainTextFix` mặc định chỉ xem trước, duyệt theo `id`
 * từng lô 200. Mỗi UPDATE gán `updated_at = updated_at` (không thì `ON UPDATE
 * CURRENT_TIMESTAMP` đổi mốc sửa của mọi bài), và chỉ ghi khi giá trị trong CSDL vẫn
 * là giá trị đã lập kế hoạch (biên tập viên vừa lưu thì không đè). Không bao giờ đọc
 * hay ghi `content` (HTML render bằng `v-html` — giải mã ở đó biến chữ thành thẻ).
 *
 * Báo cáo liệt kê mọi trường mà kết quả BỎ một đoạn cuối (entity cụt → `…`): phép
 * đoán không phân biệt được `nh&ac` (entity bị cắt) với `AT&T` thật ở cuối một chuỗi
 * có entity khác (`C&ocirc;ng ty AT&T` → `Công ty AT…`), nên người vận hành xem danh
 * sách đó trước khi `--apply`. Giá trị mà kết quả còn giải mã thêm được nữa (chữ
 * entity viết nguyên văn: `&amp;agrave;` → `&agrave;` → lúc đọc lại thành `à`) không
 * được ghi — chỉ liệt kê.
 */

export type PlainTextRow = { id: number, title: string | null, excerpt: string | null }
export type PlainTextField = 'title' | 'excerpt'
export type PlainTextFix = { id: number, title?: string, excerpt?: string }
/** Một trường cần người xem: phần cuối của giá trị trước và sau. */
export type PlainTextNote = { id: number, field: PlainTextField, before: string, after: string }
export type PlainTextPlan = { fixes: PlainTextFix[], fragments: PlainTextNote[], unstable: PlainTextNote[] }

const FIELDS: readonly PlainTextField[] = ['title', 'excerpt']
const TAIL = 40

function tail(value: string): string {
  return value.length > TAIL ? `…${value.slice(-TAIL)}` : value
}

type FieldPlan = { kind: 'write', value: string, dropsFragment: boolean } | { kind: 'unstable', value: string }

/** Giá trị đường đọc công khai hiện cho `raw`, khi nó khác do entity; `null` = để nguyên. */
function planField(raw: string | null): FieldPlan | null {
  // Không có `&` thì không có entity, cũng không có entity cụt. Khác biệt chỉ do
  // khoảng trắng hai đầu (`plainTextField` cắt) không phải việc của lượt sửa này.
  if (typeof raw !== 'string' || !raw.includes('&')) return null
  const repaired = dropTruncatedEntity(raw)
  if (decodeHtmlEntities(repaired) === raw) return null
  const value = plainTextField(raw) ?? ''
  if (plainTextField(value) !== value) return { kind: 'unstable', value }
  return { kind: 'write', value, dropsFragment: repaired !== raw }
}

/** Thuần: không đọc CSDL, không sửa `rows`. */
export function planPlainTextFixes(rows: readonly PlainTextRow[]): PlainTextPlan {
  const plan: PlainTextPlan = { fixes: [], fragments: [], unstable: [] }
  for (const row of rows) {
    const fix: PlainTextFix = { id: row.id }
    for (const field of FIELDS) {
      const raw = row[field]
      const planned = planField(raw)
      if (!planned || raw === null) continue
      if (planned.kind === 'unstable') {
        plan.unstable.push({ id: row.id, field, before: tail(raw), after: tail(planned.value) })
        continue
      }
      fix[field] = planned.value
      if (planned.dropsFragment) plan.fragments.push({ id: row.id, field, before: tail(raw), after: tail(planned.value) })
    }
    if (fix.title !== undefined || fix.excerpt !== undefined) plan.fixes.push(fix)
  }
  return plan
}

export type PlainTextTableReport = {
  scanned: number
  /** Hàng có ít nhất một trường sẽ đổi (xem trước) / cần đổi (apply). */
  changed: number
  /** Hàng đã ghi (chỉ khi apply). */
  written: number
  /** Hàng không ghi vì giá trị trong CSDL đã đổi sau khi lập kế hoạch. */
  skipped: number
  fragments: PlainTextNote[]
  unstable: PlainTextNote[]
}
export type PlainTextFixReport = {
  applied: boolean
  articles: PlainTextTableReport
  translations: PlainTextTableReport
}

const BATCH = 200

type Database = ReturnType<typeof getDb>

/** Một bảng: đọc từng lô theo khoá, lập kế hoạch, ghi khi `apply`. */
async function scanTable(
  page: (cursor: number) => Promise<PlainTextRow[]>,
  write: (fix: PlainTextFix, original: PlainTextRow) => Promise<unknown>,
  apply: boolean,
): Promise<PlainTextTableReport> {
  const report: PlainTextTableReport = { scanned: 0, changed: 0, written: 0, skipped: 0, fragments: [], unstable: [] }
  let cursor = 0
  while (true) {
    const rows = await page(cursor)
    if (rows.length === 0) break
    cursor = rows[rows.length - 1]!.id
    report.scanned += rows.length
    const plan = planPlainTextFixes(rows)
    report.changed += plan.fixes.length
    report.fragments.push(...plan.fragments)
    report.unstable.push(...plan.unstable)
    if (!apply) continue
    const byId = new Map(rows.map(row => [row.id, row]))
    for (const fix of plan.fixes) {
      const affected = affectedRowsOrZero(await write(fix, byId.get(fix.id)!))
      if (affected > 0) report.written += 1
      else report.skipped += 1
    }
  }
  return report
}

/** Mỗi trường sắp ghi vẫn đúng giá trị lúc đọc ra — biên tập viên vừa lưu thì không đè. */
function guards(fix: PlainTextFix, original: PlainTextRow, columns: { title: MySqlColumn, excerpt: MySqlColumn }): SQL[] {
  const conditions: SQL[] = []
  for (const field of FIELDS) {
    const before = original[field]
    if (fix[field] !== undefined && before !== null) conditions.push(eq(columns[field], before))
  }
  return conditions
}

function changedValues(fix: PlainTextFix): { title?: string, excerpt?: string } {
  const values: { title?: string, excerpt?: string } = {}
  if (fix.title !== undefined) values.title = fix.title
  if (fix.excerpt !== undefined) values.excerpt = fix.excerpt
  return values
}

function scanArticles(db: Database, apply: boolean) {
  return scanTable(
    cursor => db.select({ id: articles.id, title: articles.title, excerpt: articles.excerpt })
      .from(articles).where(gt(articles.id, cursor)).orderBy(asc(articles.id)).limit(BATCH),
    (fix, original) => db.update(articles)
      // `updated_at = updated_at`: gán tường minh để `ON UPDATE CURRENT_TIMESTAMP` không chạy.
      .set({ ...changedValues(fix), updatedAt: sql`${articles.updatedAt}` })
      .where(and(eq(articles.id, fix.id), ...guards(fix, original, articles))),
    apply,
  )
}

function scanTranslations(db: Database, apply: boolean) {
  return scanTable(
    cursor => db.select({ id: articleTranslations.id, title: articleTranslations.title, excerpt: articleTranslations.excerpt })
      .from(articleTranslations).where(gt(articleTranslations.id, cursor)).orderBy(asc(articleTranslations.id)).limit(BATCH),
    (fix, original) => db.update(articleTranslations)
      .set({ ...changedValues(fix), updatedAt: sql`${articleTranslations.updatedAt}` })
      .where(and(eq(articleTranslations.id, fix.id), ...guards(fix, original, articleTranslations))),
    apply,
  )
}

export async function runPlainTextFix(options: { apply?: boolean } = {}): Promise<PlainTextFixReport> {
  const apply = options.apply === true
  const db = getDb()
  return {
    applied: apply,
    articles: await scanArticles(db, apply),
    translations: await scanTranslations(db, apply),
  }
}
