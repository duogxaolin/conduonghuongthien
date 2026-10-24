/**
 * Báo cáo hàng `media` trùng lặp (wave2 D-SCAN) — CHỈ ĐỌC, không xoá gì.
 *
 * Lượt quét thư mục cũ không ghi tệp nguồn, nên mỗi lượt quét lại một tệp đã nhập
 * lên R2 tạo thêm một hàng; hai tệp cùng tên ở hai thư mục có thể đã ghi đè cùng một
 * object. Những hàng đó không suy ngược được chắc chắn (`scanned_source_path` trống),
 * nên thay vì đoán và xoá, báo cáo liệt kê hai loại nhóm:
 *
 *   - `filename_size`: cùng tên tệp + cùng kích thước — gần như chắc là cùng một ảnh;
 *   - `storage_path`: cùng provider + cùng chỗ lưu — hai hàng một object (xoá một
 *     hàng qua thư viện là xoá ảnh của hàng kia).
 *
 * Mỗi hàng kèm số nơi đang dùng URL của nó trên 27 cột tham chiếu
 * (`URL_REFERENCE_TARGETS`), đếm theo HÀNG nội dung (hai thẻ `<img>` trong một bài là
 * một), với cùng ranh giới URL và bộ dò của lượt đồng bộ (`findPresentOldUrls`):
 * `a.jpg` không được tính cho `a.jpg.webp`. Cán bộ dùng số đó để chọn hàng giữ lại.
 *
 * Một lượt đọc bảng `media` (thư viện ảnh — vài nghìn hàng) và một lượt đọc phân trang
 * mỗi cột tham chiếu — không chạy REGEXP cho từng hàng × từng cột.
 */
import { asc } from 'drizzle-orm'

import type { Database } from '../utils/db'
import { media } from '../db/schema'
import { findPresentOldUrls, forEachReferenceText } from './media-sync-rewrite'

/** Trần số nhóm mỗi báo cáo — đủ cho một màn hình, không để một thư viện bệnh lý làm treo request. */
export const MAX_DUPLICATE_GROUPS = 200

export interface MediaUsage {
  /** Số hàng nội dung (trên 27 cột) đang chứa URL của hàng này. */
  total: number
  byTarget: Record<string, number>
}

export interface DuplicateMediaRow {
  id: number
  filename: string
  originalName: string
  provider: string
  url: string
  storagePath: string
  sizeBytes: number
  scannedSourcePath: string | null
  createdAt: Date | null
  usage: MediaUsage
}

export type DuplicateGroup =
  | { kind: 'filename_size'; key: { filename: string; sizeBytes: number }; rows: DuplicateMediaRow[] }
  | { kind: 'storage_path'; key: { provider: string; storagePath: string }; rows: DuplicateMediaRow[] }

export interface MediaDuplicateReport {
  groups: DuplicateGroup[]
  /** Còn nhóm ngoài trần `maxGroups`. */
  truncated: boolean
}

type MediaRow = Omit<DuplicateMediaRow, 'usage'>

function safeEncodeUri(s: string): string | null {
  try { return encodeURI(s) } catch { return null }
}

/** Nhóm có ≥ 2 hàng, theo khoá; thứ tự: nhóm đông trước, rồi theo id nhỏ nhất. */
function groupsOf<K>(rows: MediaRow[], keyOf: (row: MediaRow) => string, describe: (row: MediaRow) => K): Array<{ key: K; rows: MediaRow[] }> {
  const byKey = new Map<string, MediaRow[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const list = byKey.get(key) ?? []
    list.push(row)
    byKey.set(key, list)
  }
  return [...byKey.values()]
    .filter(list => list.length > 1)
    .map(list => ({ key: describe(list[0]!), rows: list }))
}

/**
 * Số hàng nội dung đang chứa từng URL — một lượt đọc qua 27 cột. URL dạng thô và
 * dạng mã hoá phần trăm (trình soạn thảo có thể lưu `%20`) đều tính cho URL gốc.
 */
export async function countUrlUsage(db: Database, urls: readonly string[]): Promise<Map<string, MediaUsage>> {
  const usage = new Map<string, MediaUsage>()
  const variantToUrl = new Map<string, string>()
  for (const url of urls) {
    usage.set(url, { total: 0, byTarget: {} })
    variantToUrl.set(url, url)
    const encoded = safeEncodeUri(url)
    if (encoded && encoded !== url && !variantToUrl.has(encoded)) variantToUrl.set(encoded, url)
  }
  if (urls.length === 0) return usage
  const candidates = new Set(variantToUrl.keys())
  await forEachReferenceText(db, (target, text) => {
    const found = new Set<string>()
    findPresentOldUrls(text, candidates, found)
    const inRow = new Set([...found].map(variant => variantToUrl.get(variant)!))
    for (const url of inRow) {
      const entry = usage.get(url)!
      entry.total += 1
      entry.byTarget[target.label] = (entry.byTarget[target.label] ?? 0) + 1
    }
  })
  return usage
}

export async function findMediaDuplicates(
  db: Database,
  opts: { maxGroups?: number } = {},
): Promise<MediaDuplicateReport> {
  const maxGroups = Math.max(1, Math.trunc(opts.maxGroups ?? MAX_DUPLICATE_GROUPS))
  const rows: MediaRow[] = await db
    .select({
      id: media.id,
      filename: media.filename,
      originalName: media.originalName,
      provider: media.provider,
      url: media.url,
      storagePath: media.storagePath,
      sizeBytes: media.sizeBytes,
      scannedSourcePath: media.scannedSourcePath,
      createdAt: media.createdAt,
    })
    .from(media)
    .orderBy(asc(media.id))

  type Pending =
    | { kind: 'filename_size'; key: { filename: string; sizeBytes: number }; rows: MediaRow[] }
    | { kind: 'storage_path'; key: { provider: string; storagePath: string }; rows: MediaRow[] }
  const all: Pending[] = [
    ...groupsOf(rows, r => JSON.stringify([r.filename, r.sizeBytes]), r => ({ filename: r.filename, sizeBytes: r.sizeBytes }))
      .map(g => ({ kind: 'filename_size' as const, ...g })),
    ...groupsOf(rows, r => JSON.stringify([r.provider, r.storagePath]), r => ({ provider: r.provider, storagePath: r.storagePath }))
      .map(g => ({ kind: 'storage_path' as const, ...g })),
  ]
  all.sort((a, b) => b.rows.length - a.rows.length || a.rows[0]!.id - b.rows[0]!.id)

  const kept = all.slice(0, maxGroups)
  if (kept.length === 0) return { groups: [], truncated: false }

  const usage = await countUrlUsage(db, [...new Set(kept.flatMap(g => g.rows.map(r => r.url)))])
  const withUsage = (list: MediaRow[]): DuplicateMediaRow[] =>
    list.map(r => ({ ...r, usage: usage.get(r.url) ?? { total: 0, byTarget: {} } }))
  const groups: DuplicateGroup[] = kept.map(g => (g.kind === 'filename_size'
    ? { kind: g.kind, key: g.key, rows: withUsage(g.rows) }
    : { kind: g.kind, key: g.key, rows: withUsage(g.rows) }))
  return { groups, truncated: all.length > kept.length }
}
