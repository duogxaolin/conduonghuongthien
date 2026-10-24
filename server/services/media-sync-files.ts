/**
 * Đồng bộ MỘT hàng `media` giữa local và R2.
 *
 * Thứ tự là toàn bộ bảo đảm, và nó giống hệt cho hai chiều:
 *
 *   0. Chỗ đích (khoá R2 / tệp local `YYYY/MM/<filename>`) chưa thuộc hàng `media`
 *      KHÁC — nếu không, PUT/ghi sẽ đè ảnh của hàng kia, và lượt xoá sau đó xoá
 *      luôn tệp dùng chung.
 *   1. Chép sang bên mới (upload R2 + HeadObject xác nhận / ghi file local).
 *   2. MỘT transaction: đổi hàng `media` (có điều kiện: hàng vẫn đúng như lúc đọc)
 *      + thay URL ở mọi nội dung tham chiếu (`applyUrlRewrite`) + dòng audit.
 *   3. SAU commit, lưới an toàn: còn cột nào trỏ URL cũ, hay hàng `media` khác nào
 *      dùng chung bản cũ → GIỮ bản cũ (log `media.sync_old_copy_kept_referenced`).
 *      Chỉ khi sạch mới xoá bản cũ.
 *
 * Dừng ở bất kỳ đâu (huỷ, lỗi, container khởi động lại) đều để lại trạng thái
 * tham chiếu được: trước (2) → hàng + nội dung còn trỏ bản cũ, bản cũ còn nguyên;
 * sau (2) trước khi xoá → mọi thứ trỏ bản mới, bản cũ chỉ còn là tệp thừa. Không
 * có khoảnh khắc nào nội dung trỏ vào một tệp đã bị xoá.
 *
 * Bản cũ đã xoá thì rollback không lấy lại được — nên xoá luôn nằm ngoài, sau
 * transaction (cùng tiền lệ `deleteMediaById`).
 *
 * GIỚI HẠN đã biết: trang công khai chạy `swr: 60` (và CDN phía trước) có thể còn
 * phục vụ HTML cũ trỏ bản cũ tối đa ~60 giây sau khi bản cũ bị xoá — có từ trước,
 * áp cho mọi cột, không do tệp này giải.
 */
import { promises as fs } from 'node:fs'
import { and, eq, ne, or, sql } from 'drizzle-orm'

import type { getDb } from '../utils/db'
import { media, activityLogs } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { uploadLocalFile, deleteLocalFile, localUploadTargetFor } from '../utils/media-local'
import { uploadR2File, deleteR2File, getR2Object, headR2Object, r2ObjectKeyFor, type R2Config } from '../utils/media-r2'
import { logWarn } from '../utils/logger'
import {
  afterSettingsRewritten,
  applyUrlRewrite,
  assertRewritable,
  findRemainingReferences,
  type UrlRewrite,
} from './media-sync-rewrite'

type Db = ReturnType<typeof getDb>
type MediaRow = typeof media.$inferSelect

export function hasR2Config(config: R2Config): boolean {
  return Boolean(config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket)
}

export interface SyncOneResult {
  rewrite: UrlRewrite
  /** Số hàng nội dung đã khớp/thay URL trong transaction của hàng này. */
  rowsRewritten: number
  /** Bản cũ bị GIỮ vì lưới an toàn còn thấy tham chiếu / không kiểm được. */
  oldCopyKept: boolean
}

export interface SyncOneOptions {
  /**
   * Hỏi lại ngay trước khi mở transaction: worker đã bị buộc dừng/thay thế thì
   * KHÔNG được ghi nữa. Ném lỗi thay vì ghi — bản mới đã chép (object R2 / file
   * local) chỉ là tệp thừa, lượt sau PUT/ghi đè lên đúng chỗ đó.
   */
  stillOwner?: () => boolean
}

class SyncSuperseded extends Error {
  constructor() { super('Lượt đồng bộ đã bị buộc dừng — không ghi tiếp.') }
}

export function isSyncSuperseded(err: unknown): boolean {
  return err instanceof SyncSuperseded
}

function logOldCopyKept(item: MediaRow, err: unknown): void {
  logWarn({
    event: 'media.sync_old_copy_kept',
    mediaId: item.id,
    filename: item.filename,
    error: err instanceof Error ? err.message : String(err),
  })
}

function hasRows(result: unknown): boolean {
  const rows = Array.isArray(result) ? result[0] : null
  return Array.isArray(rows) && rows.length > 0
}

/**
 * Hàng `media` KHÁC (`id <> item.id`) đang sở hữu chỗ lưu này không. Khoá R2 và tệp
 * local đều là `YYYY/MM/<filename>`, nên hai hàng cùng tên tệp trong cùng tháng
 * trỏ CÙNG một đối tượng. KHÔNG dùng HeadObject/`fs.access`: một bản thừa do chính
 * hàng này để lại từ lượt trước bị cắt ngang không được chặn lượt thử lại.
 *
 * Lượt quét thư mục (`media-scan-import.ts`) cũng hỏi trước khi tải lên: hàng chưa
 * có nên truyền `itemId = 0` (id tự tăng bắt đầu từ 1 — mọi hàng đều là "khác").
 */
export async function otherRowOwns(
  db: Db,
  itemId: number,
  provider: 'local' | 'r2',
  storagePath: string,
  url: string | null,
): Promise<boolean> {
  const location = url === null
    ? eq(media.storagePath, storagePath)
    : or(eq(media.storagePath, storagePath), eq(media.url, url))
  return hasRows(await db.execute(
    sql`SELECT ${media.id} AS id FROM ${media} WHERE ${and(ne(media.id, itemId), eq(media.provider, provider), location)} LIMIT 1`,
  ))
}

class TargetTaken extends Error {
  constructor(target: string) {
    super(`Chỗ lưu đích ${target} đã thuộc một ảnh khác cùng tên tệp — bỏ qua để không ghi đè, giữ nguyên bản cũ.`)
  }
}

/**
 * Transaction (2): đổi hàng có điều kiện + thay URL + audit. Hàng đã đổi bởi
 * người/tiến trình khác kể từ lúc đọc (xoá, sync khác) → 0 hàng khớp → ném lỗi →
 * rollback, nơi gọi KHÔNG xoá bản cũ.
 */
async function commitMove(
  db: Db,
  item: MediaRow,
  next: { provider: 'local' | 'r2'; url: string; storagePath: string },
  direction: 'to-r2' | 'to-local',
  adminUserId: number | null,
): Promise<number> {
  const rewrite: UrlRewrite = { oldUrl: item.url, newUrl: next.url }
  const outcome = await db.transaction(async (tx) => {
    const [updated] = await tx.update(media).set(next).where(and(
      eq(media.id, item.id),
      eq(media.provider, item.provider),
      eq(media.url, item.url),
      eq(media.storagePath, item.storagePath),
    ))
    if (affectedRowsOrZero(updated) !== 1) {
      throw new Error('Hàng media đã thay đổi trong lúc đồng bộ — bỏ qua, giữ bản cũ.')
    }
    const res = await applyUrlRewrite(tx, rewrite)
    await tx.insert(activityLogs).values({
      userId: adminUserId,
      action: 'update',
      resource: 'media',
      resourceId: item.id,
      meta: {
        sync: direction,
        oldUrl: item.url,
        newUrl: next.url,
        oldStoragePath: item.storagePath,
        newStoragePath: next.storagePath,
        rewritesApplied: true,
        rowsRewritten: res.rows,
        byTarget: res.byTarget,
      },
    })
    return res
  })
  // Sau commit: bộ đệm favicon/og:image không được giữ URL cũ đúng lúc bản cũ sắp bị xoá.
  afterSettingsRewritten(outcome.byTarget)
  return outcome.rows
}

/**
 * Bước (3): có được xoá bản cũ không. Chạy trên pool SAU commit (thấy cả hàng người
 * khác vừa ghi). Lỗi khi kiểm → KHÔNG xoá (đóng an toàn): tệp thừa rẻ hơn ảnh vỡ.
 */
async function oldCopyStillNeeded(db: Db, item: MediaRow): Promise<boolean> {
  try {
    const remaining = await findRemainingReferences(db, item.url)
    const shared = await otherRowOwns(db, item.id, item.provider === 'r2' ? 'r2' : 'local', item.storagePath, null)
    if (remaining.length === 0 && !shared) return false
    logWarn({
      event: 'media.sync_old_copy_kept_referenced',
      mediaId: item.id,
      filename: item.filename,
      oldUrl: item.url,
      remaining,
      sharedWithOtherRow: shared,
    })
    return true
  } catch (err: unknown) {
    logWarn({
      event: 'media.sync_old_copy_kept_referenced',
      mediaId: item.id,
      filename: item.filename,
      oldUrl: item.url,
      error: err instanceof Error ? err.message : String(err),
    })
    return true
  }
}

/**
 * Sync một hàng `media` từ local lên R2. Ném lỗi khi không làm được (nơi gọi
 * đếm vào `skipped`); khi ném, hàng + nội dung + file local đều còn nguyên.
 */
export async function syncOneToR2(
  db: Db,
  item: MediaRow,
  r2Config: R2Config,
  adminUserId: number | null,
  opts: SyncOneOptions = {},
): Promise<SyncOneResult> {
  // Một mốc thời gian cho cả phép kiểm chỗ đích lẫn lượt ghi: ranh giới tháng
  // không tách đôi hai việc đó.
  const now = new Date()
  const targetKey = r2ObjectKeyFor(item.filename, now)
  if (await otherRowOwns(db, item.id, 'r2', targetKey, null)) throw new TargetTaken(targetKey)

  // Đọc file local. storagePath là đường dẫn tuyệt đối.
  const buffer = await fs.readFile(item.storagePath)

  // Upload R2 — giữ filename gốc (không thêm timestamp) để URL ổn định.
  // Khoá trùng do chính hàng này để lại (lượt trước bị cắt) thì PUT ghi đè — idempotent.
  const { url: r2Url, storagePath: r2Key } = await uploadR2File(
    buffer,
    item.filename,
    item.mimeType,
    r2Config,
    now,
  )
  const oldStoragePath = item.storagePath
  assertRewritable({ oldUrl: item.url, newUrl: r2Url })

  // Xác nhận object R2 có thật (HeadObject) TRƯỚC khi chuyển hàng + nội dung sang
  // nó. R2 trả 200 mà object không thực sự ghi (hoặc bị xoá ngay) → không đổi gì:
  // hàng vẫn `local`, bài viết vẫn trỏ file local còn nguyên, lượt sau thử lại.
  // Trước đây hàng vẫn đổi sang URL R2 hỏng và chỉ giữ file local "làm fallback"
  // mà không còn ai trỏ tới.
  const r2Exists = await headR2Object(r2Key, r2Config)
  if (!r2Exists) {
    logWarn({
      event: 'media.sync_to_r2_local_kept',
      mediaId: item.id,
      filename: item.filename,
      r2Key,
      reason: 'R2 HeadObject 404 sau upload — không đổi hàng, giữ file local',
    })
    throw new Error('R2 không xác nhận object sau khi tải lên — giữ nguyên bản local.')
  }

  if (opts.stillOwner && !opts.stillOwner()) throw new SyncSuperseded()
  const rowsRewritten = await commitMove(db, item, { provider: 'r2', url: r2Url, storagePath: r2Key }, 'to-r2', adminUserId)

  // Chỉ tới đây — hàng + mọi tham chiếu đã trỏ R2 và đã commit — và lưới an toàn
  // không còn thấy tham chiếu nào, mới xoá local. Xoá hỏng không làm hỏng lượt
  // chuyển đã commit: chỉ còn một tệp thừa.
  const oldCopyKept = await oldCopyStillNeeded(db, item)
  if (!oldCopyKept) {
    try {
      await deleteLocalFile(oldStoragePath)
    } catch (err: unknown) {
      logOldCopyKept(item, err)
    }
  }

  return { rewrite: { oldUrl: item.url, newUrl: r2Url }, rowsRewritten, oldCopyKept }
}

/**
 * Sync một hàng `media` từ R2 về local. Cùng thứ tự: kiểm chỗ đích → ghi local →
 * transaction → lưới an toàn → xoá object R2.
 */
export async function syncOneToLocal(
  db: Db,
  item: MediaRow,
  r2Config: R2Config,
  adminUserId: number | null,
  opts: SyncOneOptions = {},
): Promise<SyncOneResult> {
  const now = new Date()
  const target = localUploadTargetFor(item.filename, now)
  if (await otherRowOwns(db, item.id, 'local', target.storagePath, target.url)) throw new TargetTaken(target.url)

  // Download R2 object — storagePath chính là R2 key.
  const buffer = await getR2Object(item.storagePath, r2Config)

  // Ghi local — uploadLocalFile tạo YYYY/MM/filename, trả url + storagePath tuyệt đối.
  const { url: localUrl, storagePath: localStoragePath } = await uploadLocalFile(buffer, item.filename, now)
  const oldR2Key = item.storagePath
  assertRewritable({ oldUrl: item.url, newUrl: localUrl })

  if (opts.stillOwner && !opts.stillOwner()) throw new SyncSuperseded()
  const rowsRewritten = await commitMove(db, item, { provider: 'local', url: localUrl, storagePath: localStoragePath }, 'to-local', adminUserId)

  // Xoá R2 object SAU khi hàng + nội dung đã trỏ bản local, và chỉ khi lưới an
  // toàn không còn thấy tham chiếu nào tới URL R2 cũ.
  const oldCopyKept = await oldCopyStillNeeded(db, item)
  if (!oldCopyKept) {
    try {
      await deleteR2File(oldR2Key, r2Config)
    } catch (err: unknown) {
      logOldCopyKept(item, err)
    }
  }

  return { rewrite: { oldUrl: item.url, newUrl: localUrl }, rowsRewritten, oldCopyKept }
}
