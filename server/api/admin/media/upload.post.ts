import { getDb } from '../../../utils/db'
import { media, settings, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { uploadLocalFile } from '../../../utils/media-local'
import { uploadR2File, type R2Config } from '../../../utils/media-r2'
import sharp from 'sharp'
import path from 'node:path'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'media', 'create', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

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

  // Magic-byte MIME detection helper
  const detectMime = (buf: Buffer): string | null => {
    if (buf.length < 4) return null
    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg'
    // PNG: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png'
    // GIF: 47 49 46
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
    // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
    if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'
    return null
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
  if (isImage) {
    const detectedMime = detectMime(buffer)
    if (!detectedMime) {
      throw createError({ statusCode: 415, statusMessage: 'File không phải là ảnh hợp lệ (JPEG/PNG/GIF/WebP).' })
    }
    effectiveMime = detectedMime
  }

  let width: number | null = null
  let height: number | null = null

  // Auto-resize / optimize image if > 2400px
  if (isImage && !mimeType.includes('gif') && !mimeType.includes('svg')) {
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

  // Derive the stored extension from the VALIDATED MIME type, never from the
  // client-supplied filename. Otherwise a request declaring `application/pdf`
  // with the name `x.svg` would be stored as .svg and later served as
  // image/svg+xml — an executable document (stored XSS).
  const EXT_BY_MIME: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
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
  const uniqueFilename = `${Date.now()}_${safeBasename}${ext}`

  const db = getDb()

  // Get storage setting
  const dbSettings = await db.select().from(settings)
  const settingsMap = new Map(dbSettings.map(s => [s.key, s.value]))
  const provider = settingsMap.get('media_provider') || 'local'

  let uploadResult: { url: string; storagePath: string }

  if (provider === 'r2') {
    const r2Config: R2Config = {
      accountId:       settingsMap.get('r2_account_id') || '',
      accessKeyId:     settingsMap.get('r2_access_key') || '',
      secretAccessKey: settingsMap.get('r2_secret_key') || '',
      bucket:          settingsMap.get('r2_bucket') || '',
      publicUrl:       settingsMap.get('r2_public_url') || '',
    }
    if (!r2Config.accountId || !r2Config.accessKeyId || !r2Config.secretAccessKey || !r2Config.bucket) {
      throw createError({ statusCode: 400, statusMessage: 'Cấu hình Cloudflare R2 chưa đầy đủ. Hãy kiểm tra lại Cài đặt.' })
    }
    uploadResult = await uploadR2File(buffer, uniqueFilename, effectiveMime, r2Config)
  } else {
    uploadResult = await uploadLocalFile(buffer, uniqueFilename)
  }

  // Save to DB
  const [insertRes] = await db.insert(media).values({
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

  const newMediaId = insertRes.insertId

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'create',
    resource: 'media',
    resourceId: newMediaId,
    meta: { originalName, url: uploadResult.url, provider },
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
