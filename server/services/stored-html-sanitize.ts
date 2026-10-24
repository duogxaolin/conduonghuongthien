import { asc, eq, gt } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleTranslations, pageBlocks } from '../db/schema'
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
  blocks: { scanned: number, changed: number }
}

const BATCH = 200

export async function runStoredHtmlSanitize(options: { apply?: boolean } = {}): Promise<StoredHtmlSanitizeReport> {
  const apply = options.apply === true
  const db = getDb()
  const report: StoredHtmlSanitizeReport = {
    applied: apply,
    translations: { scanned: 0, changed: 0 },
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
