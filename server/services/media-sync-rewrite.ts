/**
 * Thay URL ảnh ở MỌI chỗ nội dung nhúng nó, khi một hàng `media` đổi chỗ lưu
 * (local ↔ R2). Ba việc:
 *
 *   1. `applyUrlRewrite(exec, rewrite)` — chạy trên transaction của CHÍNH hàng
 *      `media` vừa đổi chỗ (`media-sync-files.ts`). Hàng + mọi tham chiếu + audit
 *      commit cùng lúc; bản cũ (file local / object R2) chỉ bị xoá SAU commit đó.
 *
 *      Trước đây URL được gom vào một mảng trong RAM và chỉ thay MỘT lần ở cuối
 *      lượt, trong khi file local đã bị xoá ngay từng hàng. Huỷ giữa chừng, worker
 *      ném lỗi, hay container khởi động lại (CI tự deploy mỗi lần merge) → bài viết
 *      trỏ `/uploads/...` đã mất → 404 vĩnh viễn, vì chạy lại chỉ chọn hàng còn
 *      `provider='local'`.
 *
 *   2. `findRemainingReferences(exec, oldUrl)` — LƯỚI AN TOÀN trước khi xoá bản cũ:
 *      còn cột nào (trong cùng danh sách) chứa URL cũ không. Còn → GIỮ bản cũ. Danh
 *      sách bảng thiếu một chỗ (như `settings` từng thiếu: logo đầu trang 404 sau
 *      một lượt đồng bộ) thì hậu quả chỉ là một tệp thừa, không phải ảnh vỡ.
 *
 *   3. `repairInterruptedSyncRewrites(db, …)` — vá trạng thái dở dang mà mã CŨ đã
 *      để lại (và bất cứ đường nào khác lỡ để lại): hàng `media` đã đổi chỗ, nhưng
 *      nội dung còn trỏ URL cũ. Nguồn sự thật là dòng audit `{ sync, oldUrl, newUrl }`
 *      mà lượt đồng bộ ghi CÙNG transaction với lượt đổi hàng. Giới hạn: data
 *      retention có thể đã xoá dòng audit cũ (scope `activity_logs`), khi đó lượt vá
 *      này không còn biết URL cũ.
 *
 * Phạm vi bảng: xem `URL_REFERENCE_TARGETS` ở `media-sync-url-match.ts` (kèm lý do
 * từng bảng có / không có).
 *
 * Ranh giới URL (`a.jpg` KHÔNG được khớp bên trong `a.jpg.webp`): xem
 * `rewriteForms`. Trước đây `REPLACE(col, oldUrl, newUrl)` thay cả chuỗi con —
 * hàng `a.jpg.webp` còn ở local (tải lên R2 hỏng) mà bài viết đã trỏ URL R2 của
 * nó → ảnh vỡ, và lượt vá không sửa được vì không có audit nào cho hàng đó.
 *
 * Bất biến lọc HTML: chỉ thay một CHUỖI URL bằng một chuỗi URL khác trên nội dung
 * đã qua `sanitizeHtml` lúc ghi — không thẻ/thuộc tính nào được thêm/bớt. URL mới
 * được kiểm (`assertRewritable`) không chứa ký tự có thể phá thuộc tính HTML.
 */
import { and, asc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'

import type { Database } from '../utils/db'
import { activityLogs, media } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { clearFaviconSettingCache } from '../utils/favicon-setting'
import { logInfo, logWarn } from '../utils/logger'
import { clearOgImageSettingCache } from '../utils/og-image-setting'
import {
  SETTINGS_TARGET_LABEL,
  URL_REFERENCE_TARGETS,
  assertRewritable,
  detectionForms,
  findPresentOldUrls,
  rewriteForms,
  urlPairs,
  type ReferenceTarget,
  type RewriteForm,
  type UrlRewrite,
} from './media-sync-url-match'

// Nơi gọi cũ (và test) nhập các tên này từ đây.
export {
  SETTINGS_TARGET_LABEL,
  URL_REFERENCE_TARGETS,
  assertRewritable,
  findPresentOldUrls,
  rewriteForms,
  urlPairs,
  type RewriteForm,
  type UrlRewrite,
}

/** Khoá MySQL của mọi lượt ghi dời chỗ ảnh + thay URL. Dùng chung với `media-repair.ts`. */
export const MEDIA_SYNC_LOCK_NAME = 'cdkt:media:sync-storage'

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

/** Văn bản của cột để so mẫu — cột JSON đổi sang chuỗi trước. */
function columnText(target: ReferenceTarget): SQL {
  return target.kind === 'json' ? sql`CAST(${target.column} AS CHAR)` : sql`${target.column}`
}

/** Lọc thô "có thể chứa" — OR các dạng LIKE. */
function anyLike(target: ReferenceTarget, forms: RewriteForm[]): SQL {
  return or(...forms.map(f => sql`${target.column} LIKE ${f.like}`))!
}

/** Số id mỗi câu UPDATE `… WHERE id IN (…)`. */
const ID_CHUNK = 500

/**
 * Các câu thay cho MỘT cột trên tập id đã chọn: một câu UPDATE cho mỗi dạng URL,
 * `REGEXP_REPLACE` với mẫu có ranh giới. Tên bảng/cột do drizzle dựng từ schema,
 * URL đi qua tham số — không có chuỗi nào ghép vào SQL.
 */
export function buildRewriteUpdates(
  target: ReferenceTarget,
  rewrite: UrlRewrite,
  ids: readonly (number | string)[],
): SQL[] {
  const out: SQL[] = []
  for (const form of rewriteForms(target.kind, rewrite)) {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK)
      out.push(sql`UPDATE ${target.table} SET ${target.column} = REGEXP_REPLACE(${target.column}, ${form.pattern}, ${form.replacement}) WHERE ${inArray(target.id, [...chunk])} AND ${target.column} LIKE ${form.like}`)
    }
  }
  return out
}

/** Câu chọn id các hàng CÓ THỂ chứa URL cũ (lọc thô bằng LIKE). */
export function buildCandidateQuery(target: ReferenceTarget, rewrite: UrlRewrite): SQL {
  return sql`SELECT ${target.id} AS id FROM ${target.table} WHERE ${anyLike(target, rewriteForms(target.kind, rewrite))}`
}

/** Câu dò "còn hàng nào chứa URL cũ (đúng ranh giới) không" — tối đa một hàng. */
export function buildRemainingReferenceQuery(target: ReferenceTarget, oldUrl: string): SQL {
  const forms = detectionForms(target.kind, oldUrl)
  const text = columnText(target)
  const clauses = forms.map(f => sql`(${target.column} LIKE ${f.like} AND ${text} REGEXP ${f.pattern})`)
  return sql`SELECT ${target.id} AS id FROM ${target.table} WHERE ${or(...clauses)!} LIMIT 1`
}

export interface RewriteOutcome {
  /** Tổng số hàng khớp (cộng qua mọi bảng/dạng). */
  rows: number
  byTarget: Record<string, number>
}

function readRows(result: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(result) ? result[0] : result
  return Array.isArray(rows) ? rows.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object') : []
}

function readId(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'bigint') return Number(value)
  return null
}

/**
 * Thay `oldUrl` → `newUrl` ở mọi bảng tham chiếu. Gọi TRONG transaction của hàng
 * `media` — một câu lỗi (vd. REGEXP quá thời hạn trên một hàng bệnh lý, hay URL
 * mới dài quá cột VARCHAR) ném ra và rollback cả hàng: file cũ còn nguyên, lượt sau
 * thử lại. Không nuốt lỗi ở đây — nuốt lỗi là đúng cái đã để lại bài viết trỏ file
 * đã xoá.
 *
 * Hai bước mỗi bảng: chọn id bằng một lượt đọc KHÔNG khoá (đọc nhất quán của
 * InnoDB), rồi UPDATE theo id. Một câu `UPDATE … WHERE col LIKE '%…%'` thẳng (không
 * chỉ mục dùng được) khoá mọi hàng + khe nó quét tới hết transaction — trên
 * `chat_messages` là chặn mọi lượt chatbot ghi tin nhắn trong lúc đồng bộ. Hàng
 * ghi chen vào sau lượt đọc thì lưới an toàn (`findRemainingReferences`, sau
 * commit) thấy và giữ bản cũ.
 */
export async function applyUrlRewrite(exec: Executor, rewrite: UrlRewrite): Promise<RewriteOutcome> {
  assertRewritable(rewrite)
  const byTarget: Record<string, number> = {}
  let rows = 0
  for (const target of URL_REFERENCE_TARGETS) {
    const ids = readRows(await exec.execute(buildCandidateQuery(target, rewrite)))
      .map(r => readId(r.id))
      .filter((id): id is number | string => id !== null)
    if (ids.length === 0) continue
    for (const query of buildRewriteUpdates(target, rewrite, ids)) {
      const [result] = await exec.execute(query)
      const n = affectedRowsOrZero(result)
      if (n > 0) {
        byTarget[target.label] = (byTarget[target.label] ?? 0) + n
        rows += n
      }
    }
  }
  return { rows, byTarget }
}

/**
 * Lưới an toàn: nhãn những cột còn chứa `oldUrl` (đúng ranh giới, mọi dạng). Chạy
 * SAU commit, trên pool (không trong transaction) để thấy cả hàng người khác vừa
 * commit. Rỗng → xoá bản cũ được. Ném lỗi → nơi gọi phải GIỮ bản cũ.
 */
export async function findRemainingReferences(exec: Executor, oldUrl: string): Promise<string[]> {
  const found: string[] = []
  for (const target of URL_REFERENCE_TARGETS) {
    const rows = readRows(await exec.execute(buildRemainingReferenceQuery(target, oldUrl)))
    if (rows.length > 0) found.push(target.label)
  }
  return found
}

// ─── Vá lượt đồng bộ dở dang ─────────────────────────────────────────────────

const SCAN_PAGE_SIZE = 100

interface SyncAuditMeta {
  sync: 'to-r2' | 'to-local'
  oldUrl: string
  newUrl: string
}

function readSyncMeta(raw: unknown): SyncAuditMeta | null {
  // MySQL trả cột JSON đã giải mã; MariaDB (JSON = LONGTEXT) trả chuỗi.
  let meta = raw
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta) } catch { return null }
  }
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  if (m.sync !== 'to-r2' && m.sync !== 'to-local') return null
  if (typeof m.oldUrl !== 'string' || typeof m.newUrl !== 'string') return null
  return { sync: m.sync, oldUrl: m.oldUrl, newUrl: m.newUrl }
}

/**
 * Từ audit trail + trạng thái hiện tại của bảng `media`, dựng bản đồ
 * `URL cũ → URL hiện tại của hàng`. Thuần (không I/O) để kiểm bằng test.
 *
 * Một URL cũ chỉ được ánh xạ khi:
 *   - hàng còn tồn tại và `provider` khớp hướng của lượt sync GẦN NHẤT của nó
 *     (hàng bị đổi theo cách khác sau đó → không đoán);
 *   - KHÔNG hàng `media` nào hiện sở hữu URL đó (URL được dùng lại cho ảnh khác
 *     thì tham chiếu thuộc về ảnh kia — không cướp);
 *   - không mơ hồ (hai hàng khác nhau cùng từng có URL cũ đó → bỏ);
 *   - cặp URL thay an toàn được (`assertRewritable`).
 * Đích luôn là URL HIỆN TẠI của hàng, nên chuỗi A→B→C vá thẳng A→C.
 */
export function buildRepairMap(
  audits: { resourceId: number; meta: unknown }[],
  mediaRows: { id: number; url: string; provider: string }[],
): Map<string, { mediaId: number; newUrl: string }> {
  const byId = new Map(mediaRows.map(r => [r.id, r]))
  const owned = new Set(mediaRows.map(r => r.url))
  const lastDirection = new Map<number, SyncAuditMeta['sync']>()
  const oldUrlsById = new Map<number, Set<string>>()
  for (const audit of audits) {
    const meta = readSyncMeta(audit.meta)
    if (!meta) continue
    lastDirection.set(audit.resourceId, meta.sync)
    const set = oldUrlsById.get(audit.resourceId) ?? new Set<string>()
    set.add(meta.oldUrl)
    oldUrlsById.set(audit.resourceId, set)
  }
  const map = new Map<string, { mediaId: number; newUrl: string }>()
  const ambiguous = new Set<string>()
  for (const [mediaId, oldUrls] of oldUrlsById) {
    const row = byId.get(mediaId)
    if (!row) continue
    const expected = lastDirection.get(mediaId) === 'to-r2' ? 'r2' : 'local'
    if (row.provider !== expected) continue
    for (const oldUrl of oldUrls) {
      if (oldUrl === row.url || owned.has(oldUrl) || ambiguous.has(oldUrl)) continue
      try { assertRewritable({ oldUrl, newUrl: row.url }) } catch { continue }
      const prev = map.get(oldUrl)
      if (prev && prev.mediaId !== mediaId) {
        map.delete(oldUrl)
        ambiguous.add(oldUrl)
        continue
      }
      map.set(oldUrl, { mediaId, newUrl: row.url })
    }
  }
  return map
}

export interface RepairOutcome {
  /** Số URL cũ còn bị tham chiếu và đã được thay. */
  urlsRepaired: number
  /** Tổng số hàng nội dung đã khớp/sửa. */
  rowsRewritten: number
}

/**
 * Sau khi một lượt thay đã COMMIT và đụng `settings.value`: xoá bộ đệm 30 giây của
 * favicon và og:image. Không có nó, thẻ `<link rel=icon>`/`og:image` tiếp tục trỏ URL
 * cũ tới 30 giây — đúng lúc bản cũ vừa bị xoá.
 */
export function afterSettingsRewritten(byTarget: Record<string, number>): void {
  if (!byTarget[SETTINGS_TARGET_LABEL]) return
  clearFaviconSettingCache()
  clearOgImageSettingCache()
}

/**
 * Vá tham chiếu còn trỏ URL cũ của những hàng `media` đã đổi chỗ. Idempotent.
 * Người gọi phải giữ khoá `MEDIA_SYNC_LOCK_NAME` (không chạy song song với sync).
 *
 * Mỗi URL được vá trong MỘT transaction cùng dòng audit của nó.
 */
export async function repairInterruptedSyncRewrites(
  db: Database,
  adminUserId: number | null,
  opts: { shouldStop?: () => boolean } = {},
): Promise<RepairOutcome> {
  const empty: RepairOutcome = { urlsRepaired: 0, rowsRewritten: 0 }
  const audits = await db.select({ resourceId: activityLogs.resourceId, meta: activityLogs.meta })
    .from(activityLogs)
    .where(and(eq(activityLogs.resource, 'media'), eq(activityLogs.action, 'update'), isNotNull(activityLogs.resourceId)))
    .orderBy(asc(activityLogs.id))
  const mediaRows = await db.select({ id: media.id, url: media.url, provider: media.provider }).from(media)
  const map = buildRepairMap(
    audits.flatMap(a => (a.resourceId === null ? [] : [{ resourceId: a.resourceId, meta: a.meta }])),
    mediaRows,
  )
  if (map.size === 0) return empty

  // Ứng viên gồm cả dạng mã hoá phần trăm của URL cũ, ánh xạ ngược về URL gốc.
  const variantToOld = new Map<string, string>()
  for (const oldUrl of map.keys()) {
    for (const pair of urlPairs({ oldUrl, newUrl: map.get(oldUrl)!.newUrl })) variantToOld.set(pair.old, oldUrl)
  }
  const candidates = new Set(variantToOld.keys())
  const foundVariants = new Set<string>()

  // Quét mỗi cột tham chiếu một lượt, phân trang theo khoá chính (số, hoặc chuỗi
  // với `settings.key`) — không nạp cả bảng vào RAM.
  for (const { table, id, column } of URL_REFERENCE_TARGETS) {
    let after: number | string | null = null
    for (;;) {
      if (opts.shouldStop?.()) return empty
      // Truy vấn MỘT bảng, không phải subquery tương quan: cột trần hay cột có tiền
      // tố bảng đều chỉ có thể trỏ vào chính `table`.
      const page = after === null ? sql`1 = 1` : sql`${id} > ${after}`
      const list = readRows(await db.execute(
        sql`SELECT ${id} AS id, CAST(${column} AS CHAR) AS v FROM ${table} WHERE ${page} AND ${column} IS NOT NULL ORDER BY ${id} LIMIT ${SCAN_PAGE_SIZE}`,
      ))
      for (const row of list) {
        const rowId = readId(row.id)
        if (rowId !== null) after = rowId
        if (typeof row.v === 'string') findPresentOldUrls(row.v, candidates, foundVariants)
      }
      if (list.length < SCAN_PAGE_SIZE || after === null) break
    }
  }
  const found = new Set([...foundVariants].map(v => variantToOld.get(v) ?? v))

  let urlsRepaired = 0
  let rowsRewritten = 0
  for (const oldUrl of found) {
    if (opts.shouldStop?.()) break
    const entry = map.get(oldUrl)
    if (!entry) continue
    try {
      const outcome = await db.transaction(async (tx) => {
        const res = await applyUrlRewrite(tx, { oldUrl, newUrl: entry.newUrl })
        if (res.rows > 0) {
          await tx.insert(activityLogs).values({
            userId: adminUserId,
            action: 'update',
            resource: 'media',
            resourceId: entry.mediaId,
            meta: { syncRepair: true, oldUrl, newUrl: entry.newUrl, rows: res.rows, byTarget: res.byTarget },
          })
        }
        return res
      })
      if (outcome.rows > 0) {
        urlsRepaired += 1
        rowsRewritten += outcome.rows
        afterSettingsRewritten(outcome.byTarget)
      }
    } catch (err: unknown) {
      logWarn({
        event: 'media.sync_repair_failed',
        mediaId: entry.mediaId,
        oldUrl,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (urlsRepaired > 0) logInfo({ event: 'media.sync_repair_done', urlsRepaired, rowsRewritten })
  return { urlsRepaired, rowsRewritten }
}
