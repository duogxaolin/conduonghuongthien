/**
 * The write of `POST /api/admin/media/upload` — the `media` row and its audit row in one
 * transaction — moved out of the handler verbatim.
 *
 * Everything before it stays in the handler: the permission check, the multipart read, the 20 MB
 * cap, the magic-byte verdict and the stored extension (tests/cms-core-auth-media.test.ts and
 * tests/favicon-settings.test.ts read them there), sharp, the storage-provider read
 * (`readAllSettingRows`, admin-settings-values.ts) and writing the file to disk or R2. So does
 * removing that file again when this transaction fails: the handler chains it on this call and
 * still hands the ORIGINAL error to the caller.
 */
import { getDb } from '../utils/db'
import { media, activityLogs } from '../db/schema'

/** Insert the library row of a file already stored and its `create media` audit row; the new id. */
export async function insertUploadedMediaWithAudit(
  adminUser: { id: number },
  file: {
    uniqueFilename: string
    originalName: string
    effectiveMime: string
    sizeBytes: number
    provider: string
    url: string
    storagePath: string
    width: number | null
    height: number | null
  },
) {
  const { uniqueFilename, originalName, effectiveMime, provider, width, height } = file
  const db = getDb()

  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  const newMediaId = await db.transaction(async (tx) => {
    const [insertRes] = await tx.insert(media).values({
      filename:     uniqueFilename,
      originalName,
      mimeType:     effectiveMime,
      sizeBytes:    file.sizeBytes,
      provider,
      url:          file.url,
      storagePath:  file.storagePath,
      width,
      height,
      uploadedBy:   adminUser.id,
    })

    const created = insertRes.insertId

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'create',
      resource: 'media',
      resourceId: created,
      meta: { originalName, url: file.url, provider },
    })

    return created
  })

  return newMediaId
}
