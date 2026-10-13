/**
 * Đồng bộ MỘT hàng `media` giữa local và R2 (upload/tải về + cập nhật SQL + audit
 * trong transaction, xoá bản cũ SAU commit). Tách nguyên văn từ media-sync.ts.
 */
import { promises as fs } from 'node:fs'
import { eq } from 'drizzle-orm'

import type { getDb } from '../utils/db'
import { media, activityLogs } from '../db/schema'
import { uploadLocalFile, deleteLocalFile } from '../utils/media-local'
import { uploadR2File, deleteR2File, getR2Object, headR2Object, type R2Config } from '../utils/media-r2'
import { logWarn } from '../utils/logger'
import type { UrlRewrite } from './media-sync-rewrite'


export function hasR2Config(config: R2Config): boolean {
  return Boolean(config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket)
}

/**
 * Sync một hàng `media` từ local lên R2. Trả `{ newUrl, newStoragePath, rewrite }`
 * hoặc ném lỗi (caller bắt + bỏ qua).
 */
export async function syncOneToR2(
  db: ReturnType<typeof getDb>,
  item: typeof media.$inferSelect,
  r2Config: R2Config,
  adminUserId: number | null,
): Promise<{ rewrite: UrlRewrite }> {
  // Đọc file local. storagePath là đường dẫn tuyệt đối.
  const buffer = await fs.readFile(item.storagePath)

  // Upload R2 — giữ filename gốc (không thêm timestamp) để URL ổn định.
  // Nếu R2 key trùng (cùng YYYY/MM/filename) thì PUT ghi đè — idempotent.
  const { url: r2Url, storagePath: r2Key } = await uploadR2File(
    buffer,
    item.filename,
    item.mimeType,
    r2Config,
  )

  const oldUrl = item.url
  const oldStoragePath = item.storagePath

  await db.transaction(async (tx) => {
    await tx.update(media).set({
      provider: 'r2',
      url: r2Url,
      storagePath: r2Key,
    }).where(eq(media.id, item.id))
    await tx.insert(activityLogs).values({
      userId: adminUserId,
      action: 'update',
      resource: 'media',
      resourceId: item.id,
      meta: { sync: 'to-r2', oldUrl, newUrl: r2Url, oldStoragePath, newStoragePath: r2Key },
    })
  })

  // Xoá file local SAU khi SQL commit — rollback không lấy lại file đã xoá.
  // NHƯNG trước khi xoá, verify object R2 đã thực sự tồn tại (HeadObject). Nếu
  // upload im lặng fail (R2 trả 200 nhưng object không thực sự write, hoặc race
  // với ai đó xoá) thì KHÔNG xoá local — giữ file làm fallback, log warn. Self-heal
  // lần sau sẽ upload lại. Trước đây xoá local vô điều kiện → URL R2 + file local
  // gone = mất ảnh vĩnh viễn.
  const r2Exists = await headR2Object(r2Key, r2Config)
  if (r2Exists) {
    await deleteLocalFile(oldStoragePath)
  } else {
    logWarn({
      event: 'media.sync_to_r2_local_kept',
      mediaId: item.id,
      filename: item.filename,
      r2Key,
      reason: 'R2 HeadObject 404 sau upload — giữ file local làm fallback',
    })
  }

  return { rewrite: { oldUrl, newUrl: r2Url } }
}

/**
 * Sync một hàng `media` từ R2 về local. Trả `{ rewrite }` hoặc ném lỗi.
 */
export async function syncOneToLocal(
  db: ReturnType<typeof getDb>,
  item: typeof media.$inferSelect,
  r2Config: R2Config,
  adminUserId: number | null,
): Promise<{ rewrite: UrlRewrite }> {
  // Download R2 object — storagePath chính là R2 key.
  const buffer = await getR2Object(item.storagePath, r2Config)

  // Ghi local — uploadLocalFile tạo YYYY/MM/filename, trả url + storagePath tuyệt đối.
  const { url: localUrl, storagePath: localStoragePath } = await uploadLocalFile(buffer, item.filename)

  const oldUrl = item.url
  const oldR2Key = item.storagePath

  await db.transaction(async (tx) => {
    await tx.update(media).set({
      provider: 'local',
      url: localUrl,
      storagePath: localStoragePath,
    }).where(eq(media.id, item.id))
    await tx.insert(activityLogs).values({
      userId: adminUserId,
      action: 'update',
      resource: 'media',
      resourceId: item.id,
      meta: { sync: 'to-local', oldUrl, newUrl: localUrl, oldStoragePath: oldR2Key, newStoragePath: localStoragePath },
    })
  })

  // Xoá R2 object SAU khi SQL commit.
  await deleteR2File(oldR2Key, r2Config)

  return { rewrite: { oldUrl, newUrl: localUrl } }
}
