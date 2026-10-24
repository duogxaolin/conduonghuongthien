/**
 * Nhập MỘT tệp ảnh tìm thấy khi quét `public/uploads/` thành một hàng `media`
 * (wave2 D-SCAN). Lượt quét nền (`media-scan.ts`) gọi hàm này cho từng tệp chưa biết.
 *
 * Ba bảo đảm bản cũ thiếu:
 *
 *   1. **Không nhập lại.** Mọi hàng nhập ghi `scanned_source_path` = đường dẫn tệp
 *      TƯƠNG ĐỐI với gốc uploads, gạch xuôi (`2026/10/a.jpg`) — không phụ thuộc cwd
 *      của máy chủ hay container. Tập "đã biết" của lượt quét = cột đó của mọi hàng +
 *      `storage_path` của hàng LOCAL (`knownScanSources`). Bản cũ chỉ biết
 *      `storage_path`, mà bản nhập lên R2 có `storage_path` là khoá R2 — lượt sau
 *      nhập lại đúng tệp đó, mỗi lượt một hàng trùng.
 *   2. **Không ghi đè object của hàng khác.** Khoá R2 là `YYYY/MM/<tên tệp>` theo
 *      THỜI ĐIỂM tải lên, nên `2026/09/a.jpg` và `2026/10/a.jpg` ra cùng một khoá.
 *      Trước khi tải lên, hỏi `otherRowOwns` (cùng phép kiểm lượt đồng bộ local ↔ R2
 *      dùng): khoá đã thuộc một hàng → `conflict`, không tải, không ghi hàng, log
 *      `media.scan_conflict`. Một mốc `now` cho cả phép kiểm lẫn lượt tải.
 *   3. **Không để object mồ côi.** Ghi hàng hỏng sau khi đã tải lên → xoá object vừa
 *      tải, log `media.scan_insert_failed` (`objectDeleted`), rồi ném lỗi cho lượt
 *      quét đếm vào `errors`. Xoá cũng hỏng → `objectDeleted: false` kèm khoá để dọn tay.
 *
 * Hàng đã quét TRƯỚC bản vá không có `scanned_source_path` và không suy ngược được
 * chắc chắn — báo cáo trùng lặp (`media-duplicates.ts`) phủ chúng.
 */
import { promises as fs, type Stats } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

import type { getDb } from '../utils/db'
import { activityLogs, media } from '../db/schema'
import { detectImageMime, isSharpDecodable } from '../utils/image-mime'
import { logError, logWarn } from '../utils/logger'
import { deleteR2File, r2ObjectKeyFor, uploadR2File, type R2Config } from '../utils/media-r2'
import { otherRowOwns } from './media-sync-files'

type Db = ReturnType<typeof getDb>

/** Bỏ qua file lớn hơn ngưỡng này — không phải ảnh hợp lệ, khả năng cao là video/backup. */
export const MAX_SCAN_FILE_SIZE_BYTES = 50 * 1024 * 1024
/** Đọc tối đa 12 byte đầu cho magic-byte. */
const SNIFF_BYTES = 12

export type ScanImportOutcome =
  | { kind: 'imported'; mediaId: number; provider: 'local' | 'r2' }
  | { kind: 'skipped' }
  | { kind: 'conflict'; key: string }

/**
 * Đường dẫn nguồn của tệp quét: tương đối với `uploadsRoot`, gạch xuôi
 * (`2026/10/a.jpg`). `null` khi tệp không nằm dưới gốc.
 */
export function scanSourcePath(uploadsRoot: string, absolutePath: string): string | null {
  const rel = path.relative(path.resolve(uploadsRoot), path.resolve(absolutePath))
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

/**
 * Tập đường dẫn nguồn (dạng `scanSourcePath`) đã có hàng `media`:
 * `scanned_source_path` của MỌI hàng (bản nhập local lẫn R2), cộng `storage_path`
 * của hàng LOCAL nằm dưới gốc uploads (tải lên qua thư viện, hay quét trước bản vá).
 * `storage_path` của hàng R2 là khoá R2 — không bao giờ là đường dẫn tệp, nên không tính.
 */
export function knownScanSources(
  rows: ReadonlyArray<{ provider: string; storagePath: string | null; scannedSourcePath: string | null }>,
  uploadsRoot: string,
): Set<string> {
  const known = new Set<string>()
  for (const row of rows) {
    if (row.scannedSourcePath) known.add(row.scannedSourcePath)
    if (row.provider === 'local' && row.storagePath) {
      const rel = scanSourcePath(uploadsRoot, row.storagePath)
      if (rel) known.add(rel)
    }
  }
  return known
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Xoá object vừa tải lên khi hàng của nó không ghi được. Không bao giờ ném — kết quả
 * nằm trong log. `deleteR2File` trả `false` khi R2 lỗi và NÉM khi cấu hình đã lưu
 * không dùng được (`R2ConfigInvalidError`): cả hai đều là "object còn đó".
 */
async function deleteOrphanObject(key: string, r2Config: R2Config): Promise<{ deleted: boolean; error?: string }> {
  try {
    return { deleted: await deleteR2File(key, r2Config) }
  } catch (err: unknown) {
    return { deleted: false, error: describeError(err) }
  }
}

export interface ImportScannedFileOptions {
  /** Có → tải lên R2 rồi ghi hàng `provider='r2'` (giữ tệp local làm bản gốc). */
  r2Config?: R2Config | null
  /** Mốc thời gian cho khoá R2 — một mốc cho cả phép kiểm chỗ đích lẫn lượt tải. */
  now?: Date
}

/** Nhập một tệp. `skipped` = không phải ảnh / không đọc được / rỗng / quá lớn. Ném khi ghi hàng hỏng. */
export async function importScannedFile(
  db: Db,
  absolutePath: string,
  uploadsRoot: string,
  adminUserId: number | null,
  options: ImportScannedFileOptions = {},
): Promise<ScanImportOutcome> {
  const source = scanSourcePath(uploadsRoot, absolutePath)
  if (!source) return { kind: 'skipped' }

  let stat: Stats
  try { stat = await fs.lstat(absolutePath) } catch { return { kind: 'skipped' } }
  if (!stat.isFile() || stat.size > MAX_SCAN_FILE_SIZE_BYTES || stat.size === 0) return { kind: 'skipped' }

  const handle = await fs.open(absolutePath, 'r').catch(() => null)
  if (!handle) return { kind: 'skipped' }
  let detected: ReturnType<typeof detectImageMime>
  try {
    const buf = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0)
    detected = detectImageMime(buf.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
  if (!detected) return { kind: 'skipped' }

  let width: number | null = null
  let height: number | null = null
  if (isSharpDecodable(detected)) {
    try {
      const meta = await sharp(absolutePath).metadata()
      width = meta.width || null
      height = meta.height || null
    } catch { /* sharp fail — vẫn nhập, không dimensions */ }
  }

  const filename = path.basename(absolutePath)
  let provider: 'local' | 'r2' = 'local'
  let url = `/uploads/${source}`
  let storagePath = absolutePath
  let uploadedKey: string | null = null

  // R2: kiểm chỗ đích → tải lên. Tải lên hỏng → lùi về hàng local (tệp local là bản
  // gốc, R2 chỉ là bản sao), không sập lượt quét. Xung đột KHÔNG lùi về local: tệp
  // này mang tên của một ảnh khác đã ở R2, cán bộ phải quyết.
  const r2Config = options.r2Config ?? null
  if (r2Config) {
    const now = options.now ?? new Date()
    const key = r2ObjectKeyFor(filename, now)
    if (await otherRowOwns(db, 0, 'r2', key, null)) {
      logWarn({ event: 'media.scan_conflict', source, key })
      return { kind: 'conflict', key }
    }
    try {
      const buffer = await fs.readFile(absolutePath)
      const uploaded = await uploadR2File(buffer, filename, detected, r2Config, now)
      provider = 'r2'
      url = uploaded.url
      storagePath = uploaded.storagePath
      uploadedKey = uploaded.storagePath
    } catch (err: unknown) {
      logWarn({ event: 'media.scan_r2_upload_failed', filename, source, error: describeError(err) })
    }
  }

  try {
    const mediaId = await db.transaction(async (tx) => {
      const [header] = await tx.insert(media).values({
        filename,
        originalName: filename,
        mimeType: detected,
        sizeBytes: stat.size,
        provider,
        url,
        storagePath,
        width,
        height,
        uploadedBy: adminUserId,
        scannedSourcePath: source,
      })
      const createdId = Number(header?.insertId ?? 0)
      await tx.insert(activityLogs).values({
        userId: adminUserId,
        action: 'create',
        resource: 'media',
        resourceId: createdId || null,
        meta: { originalName: filename, url, provider, scanned: true, autoR2: provider === 'r2', source },
      })
      return createdId
    })
    return { kind: 'imported', mediaId, provider }
  } catch (err: unknown) {
    if (uploadedKey && r2Config) {
      const cleanup = await deleteOrphanObject(uploadedKey, r2Config)
      logError({
        event: 'media.scan_insert_failed',
        source,
        key: uploadedKey,
        objectDeleted: cleanup.deleted,
        error: describeError(err),
        ...(cleanup.error ? { deleteError: cleanup.error } : {}),
      })
    } else {
      logError({ event: 'media.scan_insert_failed', source, error: describeError(err) })
    }
    throw err
  }
}
