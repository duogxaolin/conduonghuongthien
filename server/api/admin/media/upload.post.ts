import { getDb } from '../../../utils/db'
import { media, settings, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { uploadLocalFile } from '../../../utils/media-local'
import { uploadR2File, R2Config } from '../../../utils/media-r2'
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

  const originalName = fileItem.filename || 'uploaded_file'
  const mimeType = fileItem.type || 'application/octet-stream'
  let buffer = fileItem.data

  // Validate mime type
  const isImage = mimeType.startsWith('image/')
  const isVideo = mimeType.startsWith('video/')
  const isPdf = mimeType === 'application/pdf'

  if (!isImage && !isVideo && !isPdf) {
    throw createError({ statusCode: 400, statusMessage: 'Chỉ chấp nhận file Ảnh, Video hoặc PDF.' })
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

  // Generate safe unique filename
  const ext = path.extname(originalName) || '.bin'
  const safeBasename = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_')
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
    uploadResult = await uploadR2File(buffer, uniqueFilename, mimeType, r2Config)
  } else {
    uploadResult = await uploadLocalFile(buffer, uniqueFilename)
  }

  // Save to DB
  const [insertRes] = await db.insert(media).values({
    filename:     uniqueFilename,
    originalName,
    mimeType,
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
      mimeType,
      sizeBytes: buffer.length,
      provider,
      url: uploadResult.url,
      width,
      height,
    }
  }
})
