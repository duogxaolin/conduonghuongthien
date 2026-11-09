import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { articles, articleTranslations, pageBlocks } from '../db/schema'
import { bumpAnswerCacheVersion } from './chatbot-answer-cache'
import { sanitizeBlockData, sanitizeHtml } from '../utils/sanitize-html'
import type { BlockData } from '../../shared/blocks/types'

/**
 * Dọn một lần HTML đã lưu trong DB trước khi có lớp lọc lúc ghi.
 *
 * Bản vá XSS bản dịch lọc HTML ở mọi đường ghi mới và lọc lại lúc đọc, nên người
 * đọc không còn nhận script từ hàng cũ. Nhưng hàng cũ vẫn nằm nguyên trong DB —
 * trong bản sao lưu, trong CSV xuất ra, trong ô soạn thảo của admin. Lượt dọn này
 * đưa chính dữ liệu lưu về dạng đã lọc.
 *
 * Phần "cần sửa hàng nào" là hàm thuần (`planTranslationFixes`/`planBlockFixes`)
 * để kiểm được không cần DB; phần đọc/ghi ở `runStoredHtmlSanitize`, mặc định chỉ
 * xem trước (`apply: false`) và duyệt theo `id` từng lô để không nạp cả bảng
 * `longtext` vào bộ nhớ.
 */

export type TranslationRow = { id: number, content: string | null }
export type ArticleRow = { id: number, content: string | null }
export type BlockRow = { id: number, data: BlockData | null }

export function planTranslationFixes(rows: TranslationRow[]): Array<{ id: number, content: string }> {
  const fixes: Array<{ id: number, content: string }> = []
  for (const row of rows) {
    if (typeof row.content !== 'string' || row.content === '') continue
    const clean = sanitizeHtml(row.content)
    if (clean !== row.content) fixes.push({ id: row.id, content: clean })
  }
  return fixes
}

/**
 * `alt=""` is written back by the sanitizer as the bare `alt` — the same thing in HTML (an image with an empty
 * alternative text) — so a row that differs ONLY by that is not rewritten: on the data this was measured on
 * (CHANGELOG § 103) that was 900 of 1042 differing article bodies, and rewriting them would only churn the table.
 */
const equivalentToSanitized = (original: string, clean: string) => original.replace(/\salt=""/g, ' alt') === clean

/** `from` is the stored value the fix was planned from: the write is guarded by its bytes (see `runStoredHtmlSanitize`). */
export type ArticleFix = { id: number, from: string, content: string, textChanged: boolean }

/**
 * The words a reader sees, with markup and the bodies of `script`/`style` removed. A body whose words differ before and after
 * is the one the operator has to LOOK at (a bare `<` in running text makes the sanitizer drop what follows it): the preview
 * counts and names those rows. A removed script body is not a word anyone reads, so it does not count.
 */
const visibleText = (html: string) => html
  .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
  // A tag is `<` + a letter or `/` — NOT any `<…>`: a bare `<` in running text ("x < y") is text, and treating it as a tag
  // would hide exactly the loss this exists to show.
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<\/?[a-zA-Z][^>]*>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export function planArticleFixes(rows: ArticleRow[]): ArticleFix[] {
  const fixes: ArticleFix[] = []
  for (const row of rows) {
    if (typeof row.content !== 'string' || row.content === '') continue
    const clean = sanitizeHtml(row.content)
    if (clean !== row.content && !equivalentToSanitized(row.content, clean)) fixes.push({ id: row.id, from: row.content, content: clean, textChanged: visibleText(row.content) !== visibleText(clean) })
  }
  return fixes
}

export function planBlockFixes(rows: BlockRow[]): Array<{ id: number, data: BlockData }> {
  const fixes: Array<{ id: number, data: BlockData }> = []
  for (const row of rows) {
    if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data)) continue
    // `sanitizeBlockData` edits the object it is given: work on a copy so the
    // comparison below sees the original.
    const before = JSON.stringify(row.data)
    const clean = sanitizeBlockData(JSON.parse(before) as BlockData)
    if (JSON.stringify(clean) !== before) fixes.push({ id: row.id, data: clean })
  }
  return fixes
}

export type StoredHtmlSanitizeReport = {
  applied: boolean
  translations: { scanned: number, changed: number }
  /** `written`/`skipped` only under `--apply`: `skipped` = edited by someone between the read and the write, kept as theirs. */
  articles: {
    scanned: number
    changed: number
    written: number
    skipped: number
    /** Rows among `changed` whose visible words differ (see `visibleText`); `textChangedIds` lists the first ones. */
    textChanged: number
    textChangedIds: number[]
  }
  blocks: { scanned: number, changed: number }
}

const BATCH = 200
const TEXT_CHANGED_LISTED = 50

export async function runStoredHtmlSanitize(options: { apply?: boolean } = {}): Promise<StoredHtmlSanitizeReport> {
  const apply = options.apply === true
  const db = getDb()
  const report: StoredHtmlSanitizeReport = {
    applied: apply,
    translations: { scanned: 0, changed: 0 },
    articles: { scanned: 0, changed: 0, written: 0, skipped: 0, textChanged: 0, textChangedIds: [] },
    blocks: { scanned: 0, changed: 0 },
  }

  let cursor = 0
  while (true) {
    const rows = await db
      .select({ id: articleTranslations.id, content: articleTranslations.content })
      .from(articleTranslations)
      .where(gt(articleTranslations.id, cursor))
      .orderBy(asc(articleTranslations.id))
      .limit(BATCH)
    if (rows.length === 0) break
    cursor = rows[rows.length - 1]!.id
    report.translations.scanned += rows.length
    const fixes = planTranslationFixes(rows)
    report.translations.changed += fixes.length
    if (apply) {
      for (const fix of fixes) {
        await db.update(articleTranslations).set({ content: fix.content }).where(eq(articleTranslations.id, fix.id))
      }
    }
  }

  // Article bodies (`articles.content`): the public page serves them through `v-html` and, since § 103, filters them on
  // read; this makes the stored rows match. Only `content` is written, and `updated_at` is pinned (`ON UPDATE
  // CURRENT_TIMESTAMP` would stamp hundreds of published articles as edited today); the view totals are never touched.
  // The UPDATE is guarded by the BYTES it planned from (`HEX(content) = HEX(?)`, as `translation-null-repair.ts`): an
  // officer's edit between the read and the write is kept (`skipped`), and the table is `utf8mb4_unicode_ci`, so a plain
  // `content = ?` would also match a value that merely compares equal. One row per statement, no transaction, no lock scope
  // beyond the row — the same footprint as an officer saving the article (R6).
  cursor = 0
  try {
  while (true) {
    const rows = await db
      .select({ id: articles.id, content: articles.content })
      .from(articles)
      .where(gt(articles.id, cursor))
      .orderBy(asc(articles.id))
      .limit(BATCH)
    if (rows.length === 0) break
    cursor = rows[rows.length - 1]!.id
    report.articles.scanned += rows.length
    const fixes = planArticleFixes(rows)
    report.articles.changed += fixes.length
    for (const fix of fixes) {
      if (!fix.textChanged) continue
      report.articles.textChanged += 1
      if (report.articles.textChangedIds.length < TEXT_CHANGED_LISTED) report.articles.textChangedIds.push(fix.id)
    }
    if (apply) {
      for (const fix of fixes) {
        const result = await db.update(articles)
          // Sanitized AT the write (not read back from the plan): the guard on article writes
          // (tests/security-translation-html.test.ts) can then prove, from this statement alone, what is stored.
          .set({ content: sanitizeHtml(fix.from), updatedAt: sql`${articles.updatedAt}` })
          .where(and(eq(articles.id, fix.id), sql`HEX(${articles.content}) = HEX(${fix.from})`))
        if (affectedRowsOrZero(result) > 0) report.articles.written += 1
        else report.articles.skipped += 1
      }
    }
  }
  } finally {
    // The chatbot's article search reads this column and its cached answers were built on the old text: bump once, after the
    // writes — also when a later statement threw, since the rows already written have changed.
    if (apply && report.articles.written > 0) await bumpAnswerCacheVersion()
  }

  cursor = 0
  while (true) {
    const rows = await db
      .select({ id: pageBlocks.id, data: pageBlocks.data })
      .from(pageBlocks)
      .where(gt(pageBlocks.id, cursor))
      .orderBy(asc(pageBlocks.id))
      .limit(BATCH)
    if (rows.length === 0) break
    cursor = rows[rows.length - 1]!.id
    report.blocks.scanned += rows.length
    const fixes = planBlockFixes(rows)
    report.blocks.changed += fixes.length
    if (apply) {
      for (const fix of fixes) {
        await db.update(pageBlocks).set({ data: fix.data }).where(eq(pageBlocks.id, fix.id))
      }
    }
  }

  return report
}
