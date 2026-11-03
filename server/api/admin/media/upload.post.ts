import { getDb } from '../../../utils/db'
import { media, settings, activityLogs } from '../../../db/schema'
import { deleteLocalFile, uploadLocalFile } from '../../../utils/media-local'
import { deleteR2File, uploadR2File, type R2Config } from '../../../utils/media-r2'
import sharp from 'sharp'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { logWarn } from '../../../utils/logger'
import { requireResourcePermission } from '../../../utils/permissions'
import { loadR2Config } from '../../../services/media'
import {
  EXT_BY_IMAGE_MIME,
  detectImageMime,
  isSharpDecodable,
  type DetectedImageMime,
} from '../../../utils/image-mime'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'create')

  const form = await readMultipartFormData(event)
  if (!form || form.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Không tìm thấy file tải lên.' })
  }

  const fileItem = form.find(f => f.name === 'file') || form[0]
  if (!fileItem || !fileItem.data) {
    throw createError({ statusCode: 400, statusMessage: 'File không hợp lệ.' })
  }

  // Hard 20 MB size cap (before any processing)
  const MAX_SIZE = 20 * 1024 * 1024
  if (fileItem.data.length > MAX_SIZE) {
    throw createError({ statusCode: 413, statusMessage: 'File vượt quá giới hạn 20 MB.' })
  }

  const originalName = fileItem.filename || 'uploaded_file'
  const mimeType = fileItem.type || 'application/octet-stream'
  let buffer = fileItem.data

  // Validate mime type by magic bytes for image uploads
  const isImage = mimeType.startsWith('image/')
  const isVideo = mimeType.startsWith('video/')
  const isPdf = mimeType === 'application/pdf'

  if (!isImage && !isVideo && !isPdf) {
    throw createError({ statusCode: 400, statusMessage: 'Chỉ chấp nhận file Ảnh, Video hoặc PDF.' })
  }

  // `effectiveMime` is the MIME we TRUST: for images it comes from the magic
  // bytes (not the client-declared header), so the stored extension can never
  // disagree with the real content.
  let effectiveMime = mimeType
  /** Non-null only for images, and then it is the magic-byte verdict — which is
   *  what the sharp guard and the extension lookup below must both key off. */
  let detectedImageMime: DetectedImageMime | null = null
  if (isImage) {
    detectedImageMime = detectImageMime(buffer)
    if (!detectedImageMime) {
      throw createError({ statusCode: 415, statusMessage: 'File không phải là ảnh hợp lệ (JPEG/PNG/GIF/WebP/ICO).' })
    }
    effectiveMime = detectedImageMime
  }

  let width: number | null = null
  let height: number | null = null

  // Auto-resize / optimize image if > 2400px
  //
  // ICO is excluded because sharp cannot decode it (confirmed — `sharp.format.ico`
  // is undefined), and a favicon is never 2400px wide in practice. Without the
  // guard the call below still "succeeds" silently — the surrounding catch
  // swallows the decode failure — which is the kind of no-op that invites a future
  // refactor to move real logic into a branch that never runs.
  //
  // GIF is excluded for a different reason: sharp CAN decode it, but resizing
  // flattens an animated GIF to its first frame. Both exclusions now key off the
  // MAGIC-BYTE verdict rather than the client-declared header, which also closes a
  // gap: a real animated GIF uploaded with a `image/png` content-type used to pass
  // this condition and get flattened.
  if (detectedImageMime && isSharpDecodable(detectedImageMime) && detectedImageMime !== 'image/gif') {
    try {
      const metadata = await sharp(buffer).metadata()
      width = metadata.width || null
      height = metadata.height || null

      if (width && width > 2400) {
        buffer = await sharp(buffer)
          .resize({ width: 2400, withoutEnlargement: true })
          .toBuffer()
        const newMeta = await sharp(buffer).metadata()
        width = newMeta.width || null
        height = newMeta.height || null
      }
    } catch {
      // Ignore sharp errors for non-standard image formats
    }
  }

  // Convert PNG/JPG/JPEG → WebP q80 (GIF/WebP/ICO giữ nguyên).
  //
  // Chạy SAU khối resize>2400px ở trên để convert bản đã resize (không resize 2
  // lần). GIF bị loại trừ vì sharp flatten animated GIF về frame đầu; WebP gốc
  // giữ nguyên để tránh re-encode giảm chất lượng 2 lần; ICO vì sharp không decode.
  //
  // Cập nhật `effectiveMime` sang `image/webp` sau khi convert — đây là MIME thật
  // của buffer trên đĩa, dùng cho cả đuôi tệp (`EXT_BY_MIME[effectiveMime]`), DB
  // `mimeType`, và Content-Type R2. `effectiveMime` là biến "MIME lưu", tách biệt
  // với `mimeType` (MIME client khai, chỉ cho nhánh isImage/video/pdf ở trên).
  if (detectedImageMime && isSharpDecodable(detectedImageMime)
      && detectedImageMime !== 'image/gif'
      && detectedImageMime !== 'image/webp') {
    try {
      buffer = await sharp(buffer).webp({ quality: 80 }).toBuffer()
      effectiveMime = 'image/webp'
    } catch {
      // sharp fail → fallback giữ format gốc (không chặn upload). Lỗi hiếm:
      // magic-byte đã valid + sharp đã decode được ở khối resize trên.
    }
  }

  // Derive the stored extension from the VALIDATED MIME type, never from the
  // client-supplied filename. Otherwise a request declaring `application/pdf`
  // with the name `x.svg` would be stored as .svg and later served as
  // image/svg+xml — an executable document (stored XSS).
  // The image half comes from the shared table so this endpoint and
  // `/api/admin/settings/favicon` can never disagree about which formats exist.
  // PDF is added here only: it is not an image, so it has no place in a table the
  // favicon path reads.
  const EXT_BY_MIME: Record<string, string> = {
    ...EXT_BY_IMAGE_MIME,
    'application/pdf': '.pdf',
  }
  let ext = EXT_BY_MIME[effectiveMime]
  if (!ext) {
    if (isVideo) {
      // Videos are not magic-byte checked; accept a conservative extension allowlist.
      const raw = path.extname(originalName).toLowerCase()
      ext = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'].includes(raw) ? raw : '.mp4'
    } else {
      throw createError({ statusCode: 415, statusMessage: 'Định dạng tệp không được hỗ trợ.' })
    }
  }
  const safeBasename = path.basename(originalName, path.extname(originalName)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'file'
  // `Date.now()` alone collided: two uploads of one name in the same millisecond got ONE
  // filename — two rows sharing one file, and deleting either deleted the other's file too.
  // The random part keeps them apart; the local write is also exclusive (`wx`), so a
  // collision that still happens fails this upload instead of overwriting another row's file.
  const uniqueFilename = `${Date.now()}_${randomBytes(4).toString('hex')}_${safeBasename}${ext}`

  const db = getDb()

  // Get storage setting
  const dbSettings = await db.select().from(settings)
  const settingsMap = new Map(dbSettings.map(s => [s.key, s.value]))
  const provider = settingsMap.get('media_provider') || 'local'

  let uploadResult: { url: string; storagePath: string }
  let r2Config: R2Config | null = null

  if (provider === 'r2') {
    // Secret Key lưu dạng envelope — đọc qua `loadR2Config`, nơi duy nhất giải mã nó.
    r2Config = await loadR2Config()
    if (!r2Config.accountId || !r2Config.accessKeyId || !r2Config.secretAccessKey || !r2Config.bucket) {
      throw createError({ statusCode: 400, statusMessage: 'Cấu hình Cloudflare R2 chưa đầy đủ. Hãy kiểm tra lại Cài đặt.' })
    }
    uploadResult = await uploadR2File(buffer, uniqueFilename, effectiveMime, r2Config)
  } else {
    try {
      uploadResult = await uploadLocalFile(buffer, uniqueFilename, new Date(), { exclusive: true })
    } catch (err) {
      // Writing to the uploads volume fails as a bare 500 "Server error" when the
      // container runs as user `node` but the named volume still belongs to root
      // (a volume created by an older root-built image keeps root ownership). The
      // real root cause is permissions, not application logic — surface it so the
      // operator fixes the volume (chown) rather than chasing a phantom code bug.
      const msg = err instanceof Error ? err.message : String(err)
      if (/(EACCES|permission|EPERM)/i.test(msg)) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Không ghi được file vào thư mục uploads — kiểm tra quyền thư mục (chown node:node /app/public/uploads).',
        })
      }
      throw createError({
        statusCode: 500,
        statusMessage: 'Không lưu được file tải lên. Vui lòng thử lại.',
      })
    }
  }

  // Save to DB
  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   *
   * Tệp đã ghi TRƯỚC hàng (hàng lưu URL của nó), nên transaction hỏng từng để lại một tệp
   * trong thư mục công khai hay bucket mà không hàng `media` nào trỏ tới: không hiện trong
   * thư viện, không ai xoá được, vẫn được phục vụ. Nay gỡ nó trên đường ra (cố gắng hết sức
   * — lượt gỡ hỏng chỉ ghi log), và nơi gọi vẫn nhận lỗi GỐC.
   */
  const newMediaId = await db.transaction(async (tx) => {
    const [insertRes] = await tx.insert(media).values({
      filename:     uniqueFilename,
      originalName,
      mimeType:     effectiveMime,
      sizeBytes:    buffer.length,
      provider,
      url:          uploadResult.url,
      storagePath:  uploadResult.storagePath,
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
      meta: { originalName, url: uploadResult.url, provider },
    })

    return created
  }).catch(async (error: unknown) => {
    await removeUnrecordedUpload(provider, uploadResult.storagePath, r2Config)
    throw error
  })

  return {
    ok: true,
    media: {
      id: newMediaId,
      filename: uniqueFilename,
      originalName,
      mimeType: effectiveMime,
      sizeBytes: buffer.length,
      provider,
      url: uploadResult.url,
      width,
      height,
    }
  }
})

/**
 * Gỡ tệp vừa ghi mà không hàng `media` nào trỏ tới (transaction ghi hàng đã hỏng). Không bao
 * giờ ném: lỗi ở đây không được thay lỗi gốc mà nơi gọi phải nhận — chỉ ghi log, kèm đường
 * dẫn/khoá của tệp mồ côi để vận hành gỡ tay.
 */
async function removeUnrecordedUpload(provider: string, storagePath: string, r2Config: R2Config | null): Promise<void> {
  let removed: boolean
  let error: string | undefined
  try {
    removed = provider === 'r2' && r2Config ? await deleteR2File(storagePath, r2Config) : await deleteLocalFile(storagePath)
  } catch (cleanupError: unknown) {
    removed = false
    error = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
  }
  if (!removed) logWarn({ event: 'media.upload_orphan_cleanup_failed', provider, storagePath, ...(error ? { error } : {}) })
}
