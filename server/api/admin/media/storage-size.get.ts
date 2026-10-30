/**
 * Dung lượng storage thực tế — dùng cho trang /admin/media.
 *
 * Ba số:
 *  - localDbBytes:  tổng sizeBytes các hàng media có provider='local' (DB).
 *  - localDiskBytes: tổng bytes file thực trên đĩa public/uploads/ (kể cả mồ côi
 *    không có hàng media — do SCP/rsync/backup chép thẳng vào).
 *  - r2Bytes:        tổng bytes các object trong bucket R2 (gọi ListObjectsV2).
 *
 * R2 chỉ đọc khi đã cấu hình credential (settings). Chưa cấu hình → r2Bytes =
 * null + r2Configured=false để UI hiện "chưa cấu hình" thay vì 0.
 *
 * Đĩa: thư mục gốc không có (ENOENT) là 0 thật; thư mục gốc KHÔNG ĐỌC ĐƯỢC (sai chủ
 * sở hữu volume — sự cố đã gặp) là `null` + log cảnh báo, để trang hiện "không đọc
 * được" thay vì "0 B, 0 tệp" như một cây rỗng (R8-5). Thư mục CON không đọc được vẫn
 * bị bỏ qua, phần còn lại được đếm (số thấp hơn thật — ghi nhận, chưa báo trên trang).
 *
 * Quét đĩa + R2 có thể chậm (nghìn file), nên endpoint này tách riêng không nằm
 * trong `counts.get.ts` (trang sync cần shape nhẹ nhanh).
 */
import { sql } from 'drizzle-orm'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getDb } from '../../../utils/db'
import { media } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { getR2BucketSize } from '../../../utils/media-r2'
import { loadR2Config } from '../../../services/media'
import { logWarn } from '../../../utils/logger'

/** `null`: the root itself could not be read (not "missing" — that is an empty tree). */
async function diskUsage(dir: string): Promise<{ count: number; totalBytes: number } | null> {
  let count = 0
  let totalBytes = 0
  const stack: string[] = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch (error: unknown) {
      if (cur !== dir) continue
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return { count: 0, totalBytes: 0 }
      logWarn({ event: 'media.storage_size_disk_unreadable', code: code ?? 'unknown' })
      return null
    }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        stack.push(full)
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(full)
          count++
          totalBytes += st.size
        } catch {
          // file bị xoá giữa quét — bỏ qua.
        }
      }
    }
  }
  return { count, totalBytes }
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'read')

  const db = getDb()

  // Tổng bytes + count theo provider từ DB.
  const dbRows = await db
    .select({
      provider: media.provider,
      count: sql<number>`COUNT(*)`,
      bytes: sql<number>`COALESCE(SUM(${media.sizeBytes}), 0)`,
    })
    .from(media)
    .groupBy(media.provider)
  const localDb = dbRows.find(r => r.provider === 'local')
  const r2Db = dbRows.find(r => r.provider === 'r2')

  // Quét đĩa local — public/uploads/.
  // `diskUsage` không ném: thiếu thư mục → 0, gốc không đọc được → null (đã log).
  const uploadsRoot = path.resolve(process.cwd(), 'public/uploads/')
  const localDisk = await diskUsage(uploadsRoot)

  // R2: chỉ đọc khi đã cấu hình. Secret Key lưu dạng envelope — `loadR2Config` là
  // nơi duy nhất giải mã nó (khoá không mở được → rỗng → "chưa cấu hình").
  const r2Config = await loadR2Config()
  const r2Configured = !!(
    r2Config.accountId &&
    r2Config.accessKeyId &&
    r2Config.secretAccessKey &&
    r2Config.bucket
  )

  let r2: { count: number; totalBytes: number } | null = null
  if (r2Configured) {
    try {
      r2 = await getR2BucketSize(r2Config)
    } catch {
      // R2 lỗi (network/credential hỏng) — trả null để UI phân biệt với "0 byte".
      r2 = null
    }
  }

  return {
    ok: true,
    local: {
      dbCount: Number(localDb?.count) || 0,
      dbBytes: Number(localDb?.bytes) || 0,
      diskCount: localDisk?.count ?? null,
      diskBytes: localDisk?.totalBytes ?? null,
    },
    r2: {
      configured: r2Configured,
      dbCount: Number(r2Db?.count) || 0,
      dbBytes: Number(r2Db?.bytes) || 0,
      bucketCount: r2?.count ?? null,
      bucketBytes: r2?.totalBytes ?? null,
    },
  }
})
