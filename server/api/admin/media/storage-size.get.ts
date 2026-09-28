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
 * Quét đĩa + R2 có thể chậm (nghìn file), nên endpoint này tách riêng không nằm
 * trong `counts.get.ts` (trang sync cần shape nhẹ nhanh).
 */
import { sql } from 'drizzle-orm'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getDb } from '../../../utils/db'
import { media, settings } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { getR2BucketSize } from '../../../utils/media-r2'

async function diskUsage(dir: string): Promise<{ count: number; totalBytes: number }> {
  let count = 0
  let totalBytes = 0
  const stack: string[] = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch {
      continue
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
  const uploadsRoot = path.resolve(process.cwd(), 'public/uploads/')
  let localDisk = { count: 0, totalBytes: 0 }
  try {
    localDisk = await diskUsage(uploadsRoot)
  } catch {
    // thư mục chưa tồn tại — giữ 0.
  }

  // R2: chỉ đọc khi đã cấu hình.
  const settingRows = await db.select().from(settings)
  const sMap = new Map(settingRows.map(r => [r.key, r.value]))
  const r2Configured = !!(
    sMap.get('r2_account_id') &&
    sMap.get('r2_access_key') &&
    sMap.get('r2_secret_key') &&
    sMap.get('r2_bucket')
  )

  let r2: { count: number; totalBytes: number } | null = null
  if (r2Configured) {
    try {
      r2 = await getR2BucketSize({
        accountId: sMap.get('r2_account_id') || '',
        accessKeyId: sMap.get('r2_access_key') || '',
        secretAccessKey: sMap.get('r2_secret_key') || '',
        bucket: sMap.get('r2_bucket') || '',
        publicUrl: sMap.get('r2_public_url') || '',
      })
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
      diskCount: localDisk.count,
      diskBytes: localDisk.totalBytes,
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
