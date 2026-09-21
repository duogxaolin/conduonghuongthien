/**
 * Quét thư mục `public/uploads/` và tự động nhập các tệp ảnh chưa có hàng CSDL.
 *
 * Ca sử dụng: ai đó copy tệp ảnh thẳng vào `public/uploads/YYYY/MM/` (qua SCP,
 * rsync, restore backup, migrate từ hệ thống cũ) thì những tệp đó tồn tại trên
 * đĩa nhưng không có hàng `media` — nên không hiện trên cổng, không chọn được
 * từ Media Library Modal, không xoá được qua admin. Nút này cứu lại chúng.
 *
 * Chỉ quét **local** (không R2 — list R2 chậm, tốn round-trip; local đủ cho ca
 * chính). Chỉ nhận **ảnh** (magic byte kiểm JPEG/PNG/GIF/WebP/ICO) — PDF/video
 * không nhận vì khét quá và không phải ca chính của file copy thẳng.
 *
 * Khoá MySQL `cdkt:media:scan` (timeout 0 — không xếp hàng) để hai lượt quét
 * không chạy chồng: quét đọc nhiều file + ghi nhiều hàng, chạy chồng là race.
 *
 * Mỗi file được nhập trong một transaction riêng (`tx.insert(media)` +
 * `tx.insert(activityLogs)`) — atomic như upload. Một file hỏng không sập cả lượt:
 * try/catch mỗi file, file hỏng thì `skipped += 1` + log, đi tiếp file kế. Không
 * có "một" transaction bao bọc cả đống — cùng pattern `housekeep_uploads`.
 */
import { promises as fs, type Dirent, type Stats } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

import { getDb, getPool } from '../../../utils/db'
import { media, activityLogs } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { withNamedLock } from '../../../utils/named-lock'
import { affectedRowsOrZero } from '../../../utils/affected-rows'
import {
  detectImageMime,
  isSharpDecodable,
  type DetectedImageMime,
} from '../../../utils/image-mime'
import { logInfo, logWarn } from '../../../utils/logger'

const LOCK_NAME = 'cdkt:media:scan'
const LOCK_TIMEOUT_SECONDS = 0

/** Trần số file mỗi lượt quét — chống treo nếu thư mục khổng lồ. */
const MAX_FILES_PER_SCAN = 5000
/** Bỏ qua file lớn hơn ngưỡng này — không phải ảnh hợp lệ, khả năng cao là video/backup. */
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
/** Đọc tối đa 12 byte đầu cho magic-byte — đủ cho mọi signature ảnh (WebP dài nhất, 12 byte). */
const SNIFF_BYTES = 12

/**
 * Thu thập đường dẫn tuyệt đối của mọi tệp đang có hàng `media` (provider=local).
 * Dùng `Set` để tra O(1) khi duyệt thư mục.
 */
async function collectKnownStoragePaths(db: ReturnType<typeof getDb>): Promise<Set<string>> {
  const rows = await db
    .select({ storagePath: media.storagePath })
    .from(media)
  // Chỉ giữ hàng local (R2 storagePath là key, không phải path trên đĩa máy chủ).
  // `provider` cột có default 'local' nhưng hàng cũ có thể null — coi null là local.
  const known = new Set<string>()
  for (const row of rows) {
    if (row.storagePath) known.add(path.resolve(row.storagePath))
  }
  return known
}

/**
 * Duyệt đệ quy **toàn bộ** `public/uploads/` và thu thập mọi tệp. Không giả định
 * cấu trúc `YYYY/MM/` — thực tế có `migrated/YYYY/MM/`, `migrated/media/`, và
 * những dạng migrate cũ khác. Chỉ bỏ qua thư mục ẩn + symlink (tránh trỏ ra
 * ngoài uploadsRoot). Magic byte ở bước sau sẽ lọc chỉ ảnh.
 */
async function walkUploadDir(uploadsRoot: string): Promise<string[]> {
  const files: string[] = []

  async function walk(dir: string) {
    if (files.length >= MAX_FILES_PER_SCAN) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isSymbolicLink?.()) continue // symlink có thể trỏ ra ngoài.
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        files.push(full)
        if (files.length >= MAX_FILES_PER_SCAN) return
      }
    }
  }

  await walk(uploadsRoot)
  return files
}

/**
 * Nhập một tệp mồ côi: đọc magic byte, dimensions, tạo hàng `media` + audit trong
 * một transaction. Trả `true` nếu thành công, `false` nếu bỏ qua/lỗi.
 */
async function importOne(
  db: ReturnType<typeof getDb>,
  absolutePath: string,
  uploadsRoot: string,
  adminUserId: number | null,
): Promise<boolean> {
  let stat: Stats
  try {
    // `lstat` không theo symlink — symlink đã bị bỏ ở walk, nhưng phòng file
    // đổi loại giữa walk và đây.
    stat = await fs.lstat(absolutePath)
  } catch {
    return false
  }
  if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES || stat.size === 0) return false

  // Đọc magic byte — chỉ 12 byte đầu, không đọc cả file vào memory.
  const handle = await fs.open(absolutePath, 'r').catch(() => null)
  if (!handle) return false
  try {
    const buf = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0)
    const detected = detectImageMime(buf.subarray(0, bytesRead))
    if (!detected) return false // không phải ảnh hợp lệ — bỏ qua.

    let width: number | null = null
    let height: number | null = null
    if (isSharpDecodable(detected)) {
      try {
        const meta = await sharp(absolutePath).metadata()
        width = meta.width || null
        height = meta.height || null
      } catch {
        // sharp không decode được — vẫn nhập, chỉ không có dimensions.
      }
    }

    const filename = path.basename(absolutePath)
    // URL theo format `uploadLocalFile`: `/uploads/YYYY/MM/filename`.
    const rel = path.relative(uploadsRoot, absolutePath).replace(/\\/g, '/')
    const url = `/uploads/${rel}`

    await db.transaction(async (tx) => {
      const [insertRes] = await tx.insert(media).values({
        filename,
        originalName: filename,
        mimeType: detected,
        sizeBytes: stat.size,
        provider: 'local',
        url,
        storagePath: absolutePath,
        width,
        height,
        uploadedBy: adminUserId,
      })
      const createdId = affectedRowsOrZero(insertRes) > 0
        ? (insertRes as { insertId?: number }).insertId ?? null
        : null
      await tx.insert(activityLogs).values({
        userId: adminUserId,
        action: 'create',
        resource: 'media',
        resourceId: createdId,
        meta: { originalName: filename, url, provider: 'local', scanned: true },
      })
    })
    return true
  } finally {
    await handle.close()
  }
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'create')

  const pool = getPool()
  if (!pool) {
    throw createError({ statusCode: 503, statusMessage: 'Cơ sở dữ liệu chưa sẵn sàng.' })
  }

  const uploadsRoot = path.resolve(process.cwd(), 'public', 'uploads')
  const db = getDb()

  const outcome = await withNamedLock(pool, LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
    const known = await collectKnownStoragePaths(db)
    const candidates = await walkUploadDir(uploadsRoot)

    let imported = 0
    let skipped = 0
    const errors: string[] = []

    for (const fileAbs of candidates) {
      if (imported + skipped >= MAX_FILES_PER_SCAN) {
        logWarn({ event: 'media.scan_truncated', reason: 'max_files', limit: MAX_FILES_PER_SCAN })
        break
      }
      // Đã có hàng → bỏ qua.
      if (known.has(path.resolve(fileAbs))) continue
      try {
        const ok = await importOne(db, fileAbs, uploadsRoot, adminUser.id ?? null)
        if (ok) imported += 1
        else skipped += 1
      } catch (err) {
        skipped += 1
        errors.push(path.basename(fileAbs))
        // Không throw — một file hỏng không sập cả lượt quét.
      }
    }

    return { imported, skipped, errors, truncated: imported + skipped >= MAX_FILES_PER_SCAN }
  })

  if (!outcome.acquired) {
    throw createError({ statusCode: 409, statusMessage: 'Một lượt quét khác đang chạy. Thử lại sau.' })
  }

  const result = outcome.value

  // Audit tổng — ngoài transaction (quét tạo nhiều hàng riêng, không có "một"
  // transaction bao bọc). Cùng pattern `housekeep_uploads`.
  if (result.imported > 0 || result.skipped > 0) {
    try {
      await db.insert(activityLogs).values({
        userId: adminUser.id ?? null,
        action: 'scan_uploads',
        resource: 'media',
        resourceId: null,
        meta: {
          imported: result.imported,
          skipped: result.skipped,
          truncated: result.truncated,
        },
      })
    } catch {
      // Audit hỏng không làm hỏng lượt quét đã thành công.
    }
    logInfo({ event: 'media.scan_complete', ...result })
  }

  return {
    ok: true,
    imported: result.imported,
    skipped: result.skipped,
    truncated: result.truncated,
    errors: result.errors,
  }
})
